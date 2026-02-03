/**
 * Test Viewer Session Handoff
 *
 * This script:
 * 1. Launches the viewer in external login mode
 * 2. Logs in via node-metaverse
 * 3. Teleports to capture destination data
 * 4. Connects to the viewer's WebSocket
 * 5. Sends session handoff to the viewer
 * 6. Disconnects from source region
 *
 * Usage: npx tsx scripts/test-viewer-handoff.ts
 */

import { Bot, BotOptionFlags, LoginParameters, Vector3 } from '../node-metaverse/lib';
import WebSocket from 'ws';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { CONFIG } from './config';

interface InventorySkeletonFolder {
  folder_id: string;
  parent_id: string;
  name: string;
  type_default: number;
  version: number;
}

interface HandoffData {
  agent_id: string;
  session_id: string;
  secure_session_id: string;
  circuit_code: number;
  sim_ip: string;
  sim_port: number;
  seed_capability: string;
  region_handle: string;
  first_name: string;
  last_name: string;
  // Inventory data from login response
  inventory_root?: string;
  inventory_lib_root?: string;
  inventory_lib_owner?: string;
  inventory_skeleton?: InventorySkeletonFolder[];
  agent_appearance_service?: string;
  // Benefits data for account tier
  account_type?: string;
  account_level_benefits?: {
    animated_object_limit: number;
    animation_upload_cost: number;
    attachment_limit: number;
    create_group_cost: number;
    group_membership_limit: number;
    picks_limit: number;
    sound_upload_cost: number;
    texture_upload_cost: number;
    large_texture_upload_cost?: number[];
  };
  premium_packages?: Record<string, { benefits: Record<string, any> }>;
}

let viewerProcess: ChildProcess | null = null;

function launchViewer(): ChildProcess {
  console.log('[Viewer] Launching viewer in external login mode...');
  console.log(`[Viewer] Path: ${CONFIG.viewerPath}`);

  const args = [
    '--external-login',
    '--set', 'PKWebSocketPort', CONFIG.wsPort.toString(),
  ];

  console.log(`[Viewer] Args: ${args.join(' ')}`);

  const proc = spawn(CONFIG.viewerPath, args, {
    detached: true,
    stdio: 'ignore',
  });

  proc.unref(); // Allow the script to exit while viewer keeps running

  console.log(`[Viewer] Started with PID ${proc.pid}`);
  return proc;
}

async function waitForWebSocket(maxAttempts = 30, delayMs = 1000): Promise<WebSocket> {
  console.log(`[WS] Waiting for viewer WebSocket on port ${CONFIG.wsPort}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ws = await connectToViewer();
      return ws;
    } catch (err) {
      if (attempt < maxAttempts) {
        process.stdout.write(`\r[WS] Attempt ${attempt}/${maxAttempts} - waiting...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        console.log('');
        throw new Error(`Failed to connect after ${maxAttempts} attempts`);
      }
    }
  }
  throw new Error('Unreachable');
}

async function connectToViewer(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(CONFIG.viewerWebSocketUrl);

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 2000);

    ws.on('open', () => {
      clearTimeout(timeout);
      console.log('\n[WS] Connected to viewer WebSocket');
      resolve(ws);
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log('[WS] Received:', JSON.stringify(msg, null, 2));
      } catch (e) {
        console.log('[WS] Received raw:', data.toString());
      }
    });
  });
}

async function sendHandoff(ws: WebSocket, handoffData: HandoffData): Promise<void> {
  return new Promise((resolve, reject) => {
    const message = {
      pump: 'PKLoginHandoff',
      data: {
        op: 'session_handoff',
        ...handoffData,
      },
    };

    console.log('\n[WS] Sending session handoff...');
    console.log(JSON.stringify(message, null, 2));

    ws.send(JSON.stringify(message), (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('[WS] Handoff sent successfully');
        resolve();
      }
    });
  });
}

async function main() {
  console.log('=== Viewer Session Handoff Test ===\n');

  // Step 0: Launch the viewer
  console.log('[0] Launching viewer...');
  viewerProcess = launchViewer();

  // Give viewer time to start up and initialize WebSocket server
  console.log('[0] Waiting for viewer to initialize...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Set up login
  const loginParams = new LoginParameters();
  loginParams.firstName = CONFIG.firstName;
  loginParams.lastName = CONFIG.lastName;
  loginParams.password = CONFIG.password;
  loginParams.start = CONFIG.startLocation;
  loginParams.url = CONFIG.loginUrl;

  const bot = new Bot(loginParams, BotOptionFlags.None);
  bot.teleportHandoffMode = true;

  let viewerWs: WebSocket | null = null;

  try {
    // Step 1: Login
    console.log(`[1] Logging in as ${CONFIG.firstName} ${CONFIG.lastName}...`);
    const loginResponse = await bot.login();
    console.log('    Login successful!');
    console.log(`    Account type: ${loginResponse.accountType || 'unknown'}`);
    if (loginResponse.accountLevelBenefits) {
      console.log(`    Benefits: attachment_limit=${loginResponse.accountLevelBenefits.attachment_limit}, group_limit=${loginResponse.accountLevelBenefits.group_membership_limit}`);
    }

    // Step 2: Connect to sim
    console.log('\n[2] Connecting to simulator...');
    await bot.connectToSim();
    console.log(`    Connected to ${bot.currentRegion.regionName}`);

    const circuit = bot.currentRegion.circuit;
    console.log(`    Circuit Code: ${circuit.circuitCode}`);

    // Step 3: Get destination region info from grid
    console.log(`\n[3] Looking up ${CONFIG.teleportDestination} region info...`);
    const destRegion = await bot.clientCommands.grid.getRegionByName(CONFIG.teleportDestination);
    console.log(`    Destination region: ${destRegion.name}`);
    console.log(`    Region handle from grid: ${destRegion.handle.toString()}`);

    // Step 4: Teleport to destination
    console.log(`\n[4] Teleporting to ${CONFIG.teleportDestination}...`);
    const position = new Vector3([128, 128, 30]);
    const lookAt = new Vector3([1, 0, 0]);

    const tpEvent = await bot.clientCommands.teleport.teleportTo(
      CONFIG.teleportDestination,
      position,
      lookAt
    );

    console.log('    Teleport complete (handoff mode - not connected to destination)');
    console.log(`    tpEvent.simIP: ${tpEvent.simIP}:${tpEvent.simPort}`);
    console.log(`    tpEvent.regionHandle: ${tpEvent.regionHandle?.toString()}`);
    console.log(`    tpEvent.seedCapability: ${tpEvent.seedCapability?.substring(0, 50)}...`);

    // Step 5: Connect to viewer WebSocket (with retries)
    viewerWs = await waitForWebSocket();

    // Wait a moment for the connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 6: Send handoff data - use grid lookup data for region handle
    console.log('\n[6] Preparing handoff data...');
    console.log(`    Using region handle from GRID LOOKUP: ${destRegion.handle.toString()}`);
    console.log(`    Using simIP/port from tpEvent: ${tpEvent.simIP}:${tpEvent.simPort}`);

    // Get inventory data from login response
    const inventoryRoot = bot.agent.inventory?.main?.root?.toString();
    const inventoryLibRoot = bot.agent.inventory?.library?.root?.toString();
    const inventoryLibOwner = bot.agent.inventory?.library?.owner?.toString();
    const agentAppearanceService = (bot.agent as any).agentAppearanceService;

    // Extract inventory skeleton from the Map
    const inventorySkeleton: InventorySkeletonFolder[] = [];
    if (bot.agent.inventory?.main?.skeleton) {
      for (const [, folder] of bot.agent.inventory.main.skeleton) {
        inventorySkeleton.push({
          folder_id: folder.folderID.toString(),
          parent_id: folder.parentID.toString(),
          name: folder.name,
          type_default: folder.typeDefault,
          version: folder.version,
        });
      }
    }

    console.log(`    inventory_root: ${inventoryRoot}`);
    console.log(`    inventory_lib_root: ${inventoryLibRoot}`);
    console.log(`    inventory_skeleton: ${inventorySkeleton.length} folders`);
    console.log(`    agent_appearance_service: ${agentAppearanceService}`);

    const handoffData: HandoffData = {
      agent_id: bot.agent.agentID.toString(),
      session_id: circuit.sessionID.toString(),
      secure_session_id: circuit.secureSessionID.toString(),
      circuit_code: circuit.circuitCode,
      sim_ip: tpEvent.simIP,
      sim_port: tpEvent.simPort,
      seed_capability: tpEvent.seedCapability,
      region_handle: destRegion.handle.toString(),  // Use grid lookup, not tpEvent!
      first_name: CONFIG.firstName,
      last_name: CONFIG.lastName,
      // Inventory data
      inventory_root: inventoryRoot,
      inventory_lib_root: inventoryLibRoot,
      inventory_lib_owner: inventoryLibOwner,
      inventory_skeleton: inventorySkeleton,
      agent_appearance_service: agentAppearanceService,
      // Benefits data
      account_type: loginResponse.accountType,
      account_level_benefits: loginResponse.accountLevelBenefits,
      premium_packages: loginResponse.premiumPackages,
    };
    console.log(`    Final region_handle: ${handoffData.region_handle}`);
    console.log(`    account_type: ${handoffData.account_type}`);

    await sendHandoff(viewerWs, handoffData);

    console.log('\n[7] Handoff sent! Disconnecting and exiting...');

  } catch (error) {
    console.error('\nError:', error);
  } finally {
    // Clean up quickly
    if (viewerWs) {
      viewerWs.close();
    }

    try {
      await bot.close();
    } catch (e) {
      // Ignore close errors
    }

    console.log('\n=== Handoff Complete - Exiting ===');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
