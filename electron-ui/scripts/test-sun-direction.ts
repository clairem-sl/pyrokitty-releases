/**
 * Sun Direction / Day Offset Test Script
 *
 * Logs in via node-metaverse, fetches the current parcel/region environment,
 * then PUTs an updated day_offset to ExtEnvironment (same flow as the
 * Firestorm "About Land → Environment" panel slider).
 *
 * Usage:
 *   npx tsx scripts/test-sun-direction.ts
 *   npx tsx scripts/test-sun-direction.ts --account 2
 *   npx tsx scripts/test-sun-direction.ts --offset 4     # set day offset to 4 hours
 *   npx tsx scripts/test-sun-direction.ts --offset -6.5  # set day offset to -6.5 hours
 *   npx tsx scripts/test-sun-direction.ts --offset 4 --region  # set on region (not parcel)
 *   npx tsx scripts/test-sun-direction.ts --offset 4 --parcel 4  # target specific parcel
 */

import { Bot, BotOptionFlags, LoginParameters } from '../node-metaverse/lib';
import { RegionEnvironment } from '../node-metaverse/lib/classes/public/RegionEnvironment';
import { LLSD } from '../node-metaverse/lib/classes/llsd/LLSD';
import { LLSDInteger } from '../node-metaverse/lib/classes/llsd/LLSDInteger';
import { LLSDMap } from '../node-metaverse/lib/classes/llsd/LLSDMap';
import * as path from 'path';
import * as fs from 'fs';

const accountsPath = path.join(__dirname, '..', 'data', 'accounts.json');
const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));

const args = process.argv.slice(2);
const accountIndex = args.includes('--account') ? parseInt(args[args.indexOf('--account') + 1]) - 1 : 0;
const account = accounts[accountIndex];
if (!account) {
  console.error(`No account at index ${accountIndex}`);
  process.exit(1);
}

const offsetHoursArg = args.includes('--offset') ? parseFloat(args[args.indexOf('--offset') + 1]) : null;
const useRegion = args.includes('--region');
const parcelIdOverride = args.includes('--parcel') ? parseInt(args[args.indexOf('--parcel') + 1]) : null;

async function main() {
  console.log(`=== Sun Direction / Day Offset Test: ${account.firstName} ${account.lastName} ===\n`);

  const loginParams = new LoginParameters();
  loginParams.firstName = account.firstName;
  loginParams.lastName = account.lastName;
  loginParams.password = account.password;

  const bot = new Bot(loginParams, BotOptionFlags.None);
  loginParams.start = 'last';
  await bot.login();
  console.log('Logged in. Connecting to sim...');
  await bot.connectToSim();
  console.log('Connected. Waiting for environment...\n');

  // Wait for region environment
  await new Promise<void>((resolve) => {
    let elapsed = 0;
    const check = () => {
      elapsed += 500;
      if (bot.currentRegion?.environment) {
        resolve();
      } else if (elapsed > 20000) {
        console.log('Timeout waiting for environment.');
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });

  const region = bot.currentRegion;
  console.log(`Region: ${region.regionName}`);

  // Find our parcel
  await new Promise<void>((resolve) => {
    let elapsed = 0;
    const check = () => {
      elapsed += 500;
      if (region.parcelOverlay?.length > 0) resolve();
      else if (elapsed > 10000) { console.log('Parcel overlay timeout'); resolve(); }
      else setTimeout(check, 500);
    };
    check();
  });

  const selfId = bot.agent?.agentID?.toString();
  const avatar = selfId ? region.agents.get(selfId) : null;
  let parcelId = -1;
  if (avatar) {
    const pos = avatar.position;
    try {
      parcelId = await region.getParcelLocalId(pos.x, pos.y);
      console.log(`Agent at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}) → parcel ${parcelId}`);
    } catch (e: any) {
      console.log(`Failed to get parcel ID: ${e.message}`);
    }
  }
  if (parcelIdOverride !== null) {
    parcelId = parcelIdOverride;
    console.log(`Overriding parcel ID to ${parcelId}`);
  }

  // GET current environment (parcel if available, else region)
  const useParcel = parcelId > 0 && !useRegion;
  const getCap: string | [string, Record<string, string>] = useParcel
    ? ['ExtEnvironment', { parcelid: String(parcelId) }]
    : 'ExtEnvironment';
  const label = useParcel ? `parcel ${parcelId}` : 'region';

  console.log(`\nFetching ${label} environment via GET ExtEnvironment...`);
  const xml = await region.caps.capsGetString(getCap);
  const parsed = LLSD.parseXML(xml);
  const env = new RegionEnvironment(parsed);

  console.log(`  dayLength: ${env.dayLength}s (${(env.dayLength! / 3600).toFixed(1)}h)`);
  console.log(`  dayOffset: ${env.dayOffset}s (${((env.dayOffset ?? 0) / 3600).toFixed(1)}h)`);
  console.log(`  envVersion: ${env.envVersion}`);
  console.log(`  isDefault: ${env.isDefault}`);

  if (offsetHoursArg === null) {
    console.log(`\nNo --offset specified. Use --offset <hours> to change the day offset.`);
    console.log(`Example: npx tsx scripts/test-sun-direction.ts --offset -8`);
    console.log(`\nDone.`);
    await bot.close();
    process.exit(0);
  }

  // Activate parcel group (group-owned parcels require matching active group for env edits)
  if (useParcel) {
    const petAdoptionGroupId = 'e4360c05-10c9-6538-c5b3-4b6c92c272f4';
    console.log(`\nCurrent active group: ${bot.agent?.activeGroupID?.toString() ?? 'none'}`);
    console.log(`Activating Pet Adoption Center group (${petAdoptionGroupId})...`);
    try {
      const { ActivateGroupMessage } = await import('../node-metaverse/lib/classes/messages/ActivateGroup');
      const { UUID: UUIDClass } = await import('../node-metaverse/lib/classes/UUID');
      const msg = new ActivateGroupMessage();
      msg.AgentData = {
        AgentID: bot.agent.agentID,
        SessionID: region.circuit.sessionID,
        GroupID: new UUIDClass(petAdoptionGroupId),
      };
      region.circuit.sendMessage(msg, true);
      await new Promise(r => setTimeout(r, 2000));
      console.log(`Active group now: ${bot.agent?.activeGroupID?.toString()}`);
    } catch (e: any) {
      console.log(`Group activation failed: ${e.message}`);
    }
  }

  // Convert slider hours to server seconds (same logic as Firestorm's onSldDayOffsetChanged)
  // Slider range: -12 to 12 hours. Negative values get wrapped by adding 24h.
  let offsetHours = offsetHoursArg;
  if (offsetHours <= 0) {
    offsetHours += 24;
  }
  const offsetSeconds = Math.round(offsetHours * 3600);

  // Use current dayLength from environment (or default 14400 = 4h)
  const dayLengthSeconds = env.dayLength ?? 14400;

  // Build the same body Firestorm sends:
  //   { environment: { day_length: <S32>, day_offset: <S32>, flags: 0 } }
  const envMap = new LLSDMap({
    'day_length': new LLSDInteger(dayLengthSeconds),
    'day_offset': new LLSDInteger(offsetSeconds),
    'flags': new LLSDInteger(0),
  });
  const body = new LLSDMap({
    'environment': envMap,
  });

  console.log(`\nPUT ExtEnvironment (${label}):`);
  console.log(`  day_length: ${dayLengthSeconds} (${(dayLengthSeconds / 3600).toFixed(1)}h)`);
  console.log(`  day_offset: ${offsetSeconds} (${(offsetSeconds / 3600).toFixed(1)}h, slider value: ${offsetHoursArg}h)`);
  console.log(`  flags: 0`);

  const putCap: string | [string, Record<string, string>] = useParcel
    ? ['ExtEnvironment', { parcelid: String(parcelId) }]
    : 'ExtEnvironment';

  try {
    // Do a raw PUT to see the full response including error bodies
    const capsUrl = await region.caps.getCapability('ExtEnvironment');
    let putUrl = capsUrl;
    if (useParcel) {
      putUrl += `?parcelid=${parcelId}`;
    }
    const xmlBody = LLSD.toXML(body);
    console.log(`\nCap URL: ${putUrl}`);
    console.log(`Request XML:\n${xmlBody.substring(0, 500)}\n`);

    const https = await import('https');
    const url = await import('url');
    const parsed = new URL(putUrl);
    const rawResp = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = https.request(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/llsd+xml', 'Content-Length': Buffer.byteLength(xmlBody) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode!, body: data }));
      });
      req.on('error', reject);
      req.write(xmlBody);
      req.end();
    });
    console.log(`PUT response status: ${rawResp.status}`);
    console.log(`PUT response body:\n${rawResp.body}\n`);

    if (rawResp.status === 200) {
      const respParsed = LLSD.parseXML(rawResp.body);
      const respEnv = respParsed?.environment;
      if (respEnv) {
        const updated = new RegionEnvironment(respEnv);
        console.log(`Updated environment:`);
        console.log(`  dayOffset: ${updated.dayOffset}s (${((updated.dayOffset ?? 0) / 3600).toFixed(1)}h)`);
        console.log(`  dayLength: ${updated.dayLength}s`);
        console.log(`  envVersion: ${updated.envVersion}`);
      }
    }
  } catch (e: any) {
    console.error(`\nPUT failed: ${e.message}`);
  }

  // Verify by re-fetching
  console.log(`\nVerifying: re-fetching ${label} environment...`);
  await new Promise(r => setTimeout(r, 1000));
  const xml2 = await region.caps.capsGetString(getCap);
  const parsed2 = LLSD.parseXML(xml2);
  const env2 = new RegionEnvironment(parsed2);
  console.log(`  dayOffset: ${env2.dayOffset}s (${((env2.dayOffset ?? 0) / 3600).toFixed(1)}h)`);
  console.log(`  dayLength: ${env2.dayLength}s`);
  console.log(`  envVersion: ${env2.envVersion}`);

  console.log('\nDone. Logging out...');
  await bot.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
