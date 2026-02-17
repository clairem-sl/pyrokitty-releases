/**
 * Voice Test Script
 *
 * Logs in via node-metaverse, spawns the VoiceSidecar, connects voice,
 * and optionally plays a WAV file over voice chat.
 *
 * Usage:
 *   npx tsx scripts/test-voice.ts --play              # BonnieBelle81 plays scarlet-fire.wav
 *   npx tsx scripts/test-voice.ts --listen --account 2 # BonnieBelle82 listens
 */

import { Bot, BotOptionFlags, LoginParameters } from '../node-metaverse/lib';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

// ── Config ────────────────────────────────────────────────

const accountsPath = path.join(__dirname, '..', 'data', 'accounts.json');
const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));

const args = process.argv.slice(2);
const accountIndex = args.includes('--account') ? parseInt(args[args.indexOf('--account') + 1]) - 1 : 0;
const shouldPlay = args.includes('--play');
const wavPath = path.resolve(__dirname, '..', 'voice', 'scarlet-fire.wav');
const sidecarPath = path.resolve(__dirname, '..', 'voice', 'bin', 'Debug', 'net8.0', 'VoiceSidecar.exe');
const startLocation = 'uri:Helios&130&126&21';

const account = accounts[accountIndex];
if (!account) {
  console.error(`No account at index ${accountIndex}. Available: ${accounts.map((a: any, i: number) => `${i + 1}:${a.firstName}`).join(', ')}`);
  process.exit(1);
}

console.log(`=== Voice Test: ${account.firstName} ${account.lastName} ===`);
console.log(`Mode: ${shouldPlay ? 'PLAY' : 'LISTEN'}`);
if (shouldPlay) console.log(`WAV: ${wavPath}`);

// ── Sidecar IPC ───────────────────────────────────────────

let sidecar: ChildProcess | null = null;
let lineBuffer = '';

function startSidecar(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[sidecar] Starting: ${sidecarPath}`);
    sidecar = spawn(sidecarPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    sidecar.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) console.log(`[VoiceSidecar] ${line.trimEnd()}`);
      }
    });

    sidecar.stdout?.on('data', (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          handleSidecarEvent(event);
          if (event.event === 'ready') resolve();
        } catch { console.warn(`[sidecar] Parse error: ${line}`); }
      }
    });

    sidecar.on('error', (err) => { console.error(`[sidecar] Error:`, err); reject(err); });
    sidecar.on('exit', (code) => { console.log(`[sidecar] Exited: ${code}`); sidecar = null; });

    setTimeout(() => reject(new Error('Sidecar ready timeout')), 10000);
  });
}

function sendCmd(cmd: Record<string, unknown>) {
  if (!sidecar?.stdin?.writable) return;
  sidecar.stdin.write(JSON.stringify(cmd) + '\n');
}

let voiceConnected = false;

function handleSidecarEvent(event: any) {
  const ts = new Date().toISOString().substring(11, 23);
  switch (event.event) {
    case 'ready':
      console.log(`[${ts}] Sidecar ready`);
      break;
    case 'connected':
      voiceConnected = true;
      console.log(`[${ts}] Voice CONNECTED (channel=${event.channel})`);
      break;
    case 'disconnected':
      voiceConnected = false;
      console.log(`[${ts}] Voice disconnected: ${event.reason}`);
      break;
    case 'participantJoined':
      console.log(`[${ts}] ▶ Participant joined: ${event.agentId}`);
      break;
    case 'participantLeft':
      console.log(`[${ts}] ◀ Participant left: ${event.agentId}`);
      break;
    case 'participantSpeaking':
      console.log(`[${ts}] 🔊 Speaking: ${event.agentId} power=${event.power}`);
      break;
    case 'micLevel':
      // Throttle mic level output
      break;
    case 'error':
      console.error(`[${ts}] ERROR: ${event.message}`);
      break;
    default:
      console.log(`[${ts}] Event: ${event.event}`, event);
  }
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  // 1. Login
  const loginParams = new LoginParameters();
  loginParams.firstName = account.firstName;
  loginParams.lastName = account.lastName;
  loginParams.password = account.password;
  loginParams.start = startLocation;
  loginParams.url = 'https://login.agni.lindenlab.com/cgi-bin/login.cgi';

  const bot = new Bot(loginParams, BotOptionFlags.None);

  console.log(`\n[1] Logging in ${account.firstName}...`);
  await bot.login();
  console.log(`[2] Login OK, connecting to sim...`);
  await bot.connectToSim();
  console.log(`[3] Connected to ${bot.currentRegion?.regionName}`);

  // 2. Wait for position
  const agentId = bot.agent?.agentID?.toString() || '';
  let pos: any = null;
  for (let i = 0; i < 20; i++) {
    const self = bot.currentRegion?.agents?.get(agentId);
    if (self?.position && (self.position.x !== 0 || self.position.y !== 0)) {
      pos = self.position;
      break;
    }
    const lp = bot.agent?.localPosition;
    if (lp && (lp.x !== 0 || lp.y !== 0)) {
      pos = lp;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[4] Position: ${pos ? `(${pos.x?.toFixed(1)},${pos.y?.toFixed(1)},${pos.z?.toFixed(1)})` : 'N/A'}`);

  // 3. Get caps
  const region = bot.currentRegion;
  const caps: Record<string, string> = {};
  for (const capName of ['ProvisionVoiceAccountRequest', 'VoiceSignalingRequest', 'ParcelVoiceInfoRequest']) {
    try { caps[capName] = await region.caps.getCapability(capName); } catch { }
  }
  if (!caps.ProvisionVoiceAccountRequest) {
    console.error('No ProvisionVoiceAccountRequest cap!');
    await bot.close();
    process.exit(1);
  }
  console.log(`[5] Got voice caps`);

  // 4. Determine parcel voice mode: estate (-1) vs parcel-specific (local ID)
  let parcelLocalId = -1;
  // Wait for parcel map + parcels to populate
  for (let i = 0; i < 20; i++) {
    if (pos && region?.parcelMap) {
      const px = Math.floor(pos.x / 4);
      const py = Math.floor(pos.y / 4);
      if (py >= 0 && py < 64 && px >= 0 && px < 64) {
        const pid = region.parcelMap[py]?.[px];
        if (pid !== undefined && pid > 0) {
          const parcel = region.parcels?.[pid];
          const flags = parcel?.ParcelFlags ?? 0;
          const allowVoice = !!(flags & (1 << 29));       // AllowVoiceChat
          const useEstate  = !!(flags & (1 << 30));        // UseEstateVoiceChan
          console.log(`[4a] Parcel "${parcel?.Name}" localID=${pid}, flags=0x${flags.toString(16)}, allowVoice=${allowVoice}, useEstate=${useEstate}`);
          if (!allowVoice) {
            console.warn(`[!] Voice disabled on this parcel`);
          }
          if (useEstate) {
            parcelLocalId = -1; // estate voice channel
          } else {
            parcelLocalId = pid; // parcel-specific voice channel
          }
          break;
        }
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  const regionOffsetX = (region?.xCoordinate ?? 0) * 256;
  const regionOffsetY = (region?.yCoordinate ?? 0) * 256;
  const globalPos = pos ? [regionOffsetX + pos.x, regionOffsetY + pos.y, pos.z] : undefined;
  console.log(`[6] Parcel ID: ${parcelLocalId}, global: ${globalPos ? `(${globalPos[0].toFixed(0)},${globalPos[1].toFixed(0)},${globalPos[2].toFixed(0)})` : 'N/A'}`);

  // 5. Start sidecar
  await startSidecar();

  // 6. Connect voice
  sendCmd({
    cmd: 'connect',
    caps,
    agentId,
    sessionId: bot.agent?.sessionID?.toString() || '',
    regionName: region.regionName || '',
    parcelLocalId,
    position: globalPos,
  });

  // 7. Start position updates
  const posInterval = setInterval(() => {
    if (!sidecar) return;
    const self = bot.currentRegion?.agents?.get(agentId);
    if (!self?.position) return;
    const p = self.position;
    const r = self.rotation;
    let plid = -1;
    try {
      if (region?.parcelMap) {
        const px = Math.floor(p.x / 4);
        const py = Math.floor(p.y / 4);
        if (py >= 0 && py < 64 && px >= 0 && px < 64)
          plid = region.parcelMap[py]?.[px] ?? -1;
      }
    } catch { }
    sendCmd({
      cmd: 'updatePosition',
      position: [regionOffsetX + p.x, regionOffsetY + p.y, p.z],
      rotation: [r?.x || 0, r?.y || 0, r?.z || 0, r?.w || 1],
      regionName: region.regionName,
      parcelLocalId: plid,
    });
  }, 100);

  // 8. Wait for voice connection, then play file if requested
  console.log(`\n[7] Waiting for voice connection...`);
  for (let i = 0; i < 30; i++) {
    if (voiceConnected) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!voiceConnected) {
    console.error(`\n[!] Voice never connected. Check logs above for errors.`);
    clearInterval(posInterval);
    if (sidecar) { sendCmd({ cmd: 'disconnect' }); await new Promise(r => setTimeout(r, 500)); sidecar?.kill(); }
    await bot.close();
    process.exit(1);
  }

  if (shouldPlay) {
    console.log(`[8] Playing ${path.basename(wavPath)} (loop=true)...`);
    sendCmd({ cmd: 'playFile', path: wavPath, loop: true });
  } else {
    console.log(`[8] Listening for incoming voice...`);
  }

  // 9. Keep running until Ctrl+C
  console.log(`\nPress Ctrl+C to stop.\n`);

  const cleanup = async () => {
    console.log('\nShutting down...');
    clearInterval(posInterval);
    if (sidecar) {
      sendCmd({ cmd: 'disconnect' });
      await new Promise(r => setTimeout(r, 1000));
      sidecar?.kill();
    }
    try { await bot.close(); } catch { }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
