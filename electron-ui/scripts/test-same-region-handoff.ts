/**
 * Test Same-Region Handoff via Port Reuse
 *
 * This script tests handoff without teleporting by having the viewer
 * bind to the same local UDP port the bot used.
 *
 * Flow:
 * 1. Bot logs in, circuit binds to local port P
 * 2. Get port P from bot
 * 3. Launch viewer with --set UserConnectionPort P
 * 4. Bot closes its UDP socket (freeing port P)
 * 5. Viewer binds to port P
 * 6. Send handoff to viewer
 * 7. Viewer connects to sim from same endpoint
 *
 * Usage: npx tsx scripts/test-same-region-handoff.ts
 */

import { Bot, BotOptionFlags, LoginParameters, Vector3 } from '../node-metaverse/dist/lib';
import WebSocket from 'ws';
import { spawn, ChildProcess } from 'child_process';
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
  inventory_root?: string;
  inventory_lib_root?: string;
  inventory_lib_owner?: string;
  inventory_skeleton?: InventorySkeletonFolder[];
  agent_appearance_service?: string;
  account_type?: string;
  account_level_benefits?: Record<string, any>;
  premium_packages?: Record<string, { benefits: Record<string, any> }>;
  // Session continuation fields
  session_continuation?: boolean;
  sequence_number?: number;
  // Items already attached on the bot - viewer should skip re-attaching these
  attached_items?: string[];
  // Attachment objects with local IDs - viewer can request these from sim
  attached_objects?: Array<{ localID: number; itemID: string }>;
  // Cached packets for replay
  cached_packets?: {
    layer_data: Array<{ type: number; data: string }>;
    region_handshake: any;
    parcel_overlay: Array<{ sequenceId: number; data: string }>;
    // Structured ObjectUpdate data for ALL region objects
    object_updates: Array<{
      regionHandle: string;
      timeDilation: number;
      type: 'ObjectUpdate' | 'ObjectUpdateCompressed';
      objects: Array<{
        updateFlags: number;
        data: string;  // base64 encoded
      }>;
    }>;
  };
}

function launchViewer(localPort: number): ChildProcess {
  console.log('[Viewer] Launching viewer in external login mode...');
  console.log(`[Viewer] Path: ${CONFIG.viewerPath}`);
  console.log(`[Viewer] Binding to local UDP port: ${localPort}`);

  const args = [
    '--external-login',
    '--set', 'PKWebSocketPort', CONFIG.wsPort.toString(),
    '--set', 'UserConnectionPort', localPort.toString(),
  ];

  console.log(`[Viewer] Args: ${args.join(' ')}`);

  const proc = spawn(CONFIG.viewerPath, args, {
    detached: true,
    stdio: 'ignore',
  });

  proc.unref();

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
  console.log('=== Same-Region Handoff Test (Port Reuse) ===\n');

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

    // Step 2: Connect to sim
    console.log('\n[2] Connecting to simulator...');
    await bot.connectToSim();
    const currentRegionName = bot.currentRegion.regionName;
    console.log(`    Connected to ${currentRegionName}`);

    const circuit = bot.currentRegion.circuit;
    console.log(`    Circuit Code: ${circuit.circuitCode}`);
    console.log(`    Remote: ${circuit.ipAddress}:${circuit.port}`);

    // Wait for terrain to be received so we can cache it for handoff
    console.log('\n[2.5] Waiting for terrain data to be received...');
    try {
      await bot.currentRegion.waitForTerrain();
      console.log('    Terrain received!');
    } catch (e) {
      console.log('    Terrain timeout - proceeding anyway');
    }
    console.log(`    Sequence number after terrain: ${circuit.getSequenceNumber()}`);

    // Step 3: Get local UDP port and sequence number
    const localPort = circuit.getLocalPort();
    const sequenceNumber = circuit.getSequenceNumber();
    console.log(`\n[3] Bot's local UDP port: ${localPort}`);
    console.log(`    Bot's sequence number: ${sequenceNumber}`);

    if (localPort === 0) {
      throw new Error('Failed to get local UDP port - socket may not be bound yet');
    }

    // Step 4: Get region info
    console.log(`\n[4] Looking up region ${currentRegionName}...`);
    const regionInfo = await bot.clientCommands.grid.getRegionByName(currentRegionName);
    console.log(`    Region handle: ${regionInfo.handle.toString()}`);

    // Sleep 5 seconds to make the test more similar to a real world example.
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 5: Close bot's UDP socket to free the port
    console.log('\n[5] Closing bot UDP socket to free port...');
    bot.shutdownForHandoff();
    console.log('    UDP socket closed');

    // Delay to ensure OS releases the port and sim notices disconnection
    console.log('    Waiting 2 seconds for sim to notice disconnection...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 6: Launch viewer with the same local port
    console.log('\n[6] Launching viewer with same local port...');
    launchViewer(localPort);

    // Give viewer time to start
    console.log('[6] Waiting for viewer to initialize...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 7: Connect to viewer WebSocket
    viewerWs = await waitForWebSocket();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 8: Prepare and send handoff data
    console.log('\n[8] Preparing handoff data...');

    // Use current region's connection data (no teleport)
    const simIP = circuit.ipAddress;
    const simPort = circuit.port;
    const seedCapability = bot.currentRegion.seedCapabilityURL;

    console.log(`    sim_ip: ${simIP}:${simPort}`);
    console.log(`    seed_capability: ${seedCapability?.substring(0, 50)}...`);
    console.log(`    region_handle: ${regionInfo.handle.toString()}`);

    // Get inventory data
    const inventoryRoot = bot.agent.inventory?.main?.root?.toString();
    const inventoryLibRoot = bot.agent.inventory?.library?.root?.toString();
    const inventoryLibOwner = bot.agent.inventory?.library?.owner?.toString();
    const agentAppearanceService = (bot.agent as any).agentAppearanceService;

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

    console.log(`    sequence_number: ${sequenceNumber} (for session continuation)`);

    // Get cached packets for handoff (terrain, region handshake, parcel overlay, attachment objects)
    const cachedPackets = bot.currentRegion.getCachedPacketsForHandoff();
    console.log(`    Cached packets - LayerData: ${cachedPackets.layerData.length}, ParcelOverlay: ${cachedPackets.parcelOverlay.length}, ObjectUpdates: ${cachedPackets.objectUpdates.length}, RegionHandshake: ${cachedPackets.regionHandshake ? 'yes' : 'no'}`);

    // Calculate total cached data size
    let totalLayerDataSize = 0;
    for (const ld of cachedPackets.layerData) {
      totalLayerDataSize += Buffer.from(ld.data, 'base64').length;
    }
    let totalParcelOverlaySize = 0;
    for (const po of cachedPackets.parcelOverlay) {
      totalParcelOverlaySize += Buffer.from(po.data, 'base64').length;
    }
    console.log(`    Cached data sizes - LayerData: ${totalLayerDataSize} bytes, ParcelOverlay: ${totalParcelOverlaySize} bytes`);

    // Get list of items already attached on the bot
    const attachedItems = bot.agent.getAttachedItemIDs();
    const attachedObjects = bot.agent.getAttachedObjectInfo();
    console.log(`    Currently attached items: ${attachedItems.length}`);
    if (attachedItems.length > 0) {
      console.log(`    Attached item IDs: ${attachedItems.join(', ')}`);
    }
    if (attachedObjects.length > 0) {
      console.log(`    Attached object local IDs: ${attachedObjects.map(o => o.localID).join(', ')}`);
    }

    const handoffData: HandoffData = {
      agent_id: bot.agent.agentID.toString(),
      session_id: circuit.sessionID.toString(),
      secure_session_id: circuit.secureSessionID.toString(),
      circuit_code: circuit.circuitCode,
      sim_ip: simIP,
      sim_port: simPort,
      seed_capability: seedCapability,
      region_handle: regionInfo.handle.toString(),
      first_name: CONFIG.firstName,
      last_name: CONFIG.lastName,
      inventory_root: inventoryRoot,
      inventory_lib_root: inventoryLibRoot,
      inventory_lib_owner: inventoryLibOwner,
      inventory_skeleton: inventorySkeleton,
      agent_appearance_service: agentAppearanceService,
      account_type: loginResponse.accountType,
      account_level_benefits: loginResponse.accountLevelBenefits,
      premium_packages: loginResponse.premiumPackages,
      // Session continuation mode - skip UseCircuitCode, continue from bot's sequence
      session_continuation: true,
      sequence_number: sequenceNumber,
      // Items already attached - viewer should skip re-attaching these
      attached_items: attachedItems,
      // Attachment objects with local IDs - viewer can request these from sim
      attached_objects: attachedObjects,
      // Cached packets for replay to viewer
      cached_packets: {
        layer_data: cachedPackets.layerData,
        region_handshake: cachedPackets.regionHandshake,
        parcel_overlay: cachedPackets.parcelOverlay,
        object_updates: cachedPackets.objectUpdates,
      },
    };

    await sendHandoff(viewerWs, handoffData);

    console.log('\n[9] Handoff complete!');
    console.log('    The viewer should now connect to the sim using the same UDP endpoint.');


    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('\nComplete!');
  } catch (error) {
    console.error('\nError:', error);
  } finally {
    if (viewerWs) {
      viewerWs.close();
    }

    console.log('\n=== Exiting ===');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
