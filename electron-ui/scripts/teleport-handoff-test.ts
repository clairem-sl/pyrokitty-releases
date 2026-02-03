/**
 * Teleport Handoff Prototype
 *
 * Tests the concept of logging in with node_metaverse, initiating a teleport,
 * and capturing the destination region data that could be handed off to a viewer.
 *
 * Uses the custom `teleportHandoffMode` flag to prevent node_metaverse from
 * auto-connecting to the teleport destination, allowing us to capture the
 * connection data and pass it to an external viewer instead.
 *
 * Usage: npx tsx scripts/teleport-handoff-test.ts
 */

import { Bot, BotOptionFlags, LoginParameters, Vector3 } from '../node-metaverse/lib';
import { CONFIG } from './config';

// Configuration - update these for testing


interface HandoffData {
  // From login
  agentID: string;
  sessionID: string;
  secureSessionID: string;
  circuitCode: number;

  // From teleport destination
  simIP: string;
  simPort: number;
  seedCapability: string;
  regionHandle: string;  // 64-bit region handle as string (for JSON compatibility)

  // Additional context
  sourceRegion?: string;
  destinationRegion?: string;
  loginTime: number;
  teleportTime?: number;
}

async function main() {
  console.log('=== Teleport Handoff Prototype ===\n');

  // Set up login parameters
  const loginParams = new LoginParameters();
  loginParams.firstName = CONFIG.firstName;
  loginParams.lastName = CONFIG.lastName;
  loginParams.password = CONFIG.password;
  loginParams.start = CONFIG.startLocation;
  loginParams.url = CONFIG.loginUrl;

  // Create bot with minimal options - we don't need full functionality
  const bot = new Bot(loginParams, BotOptionFlags.None);

  // Enable handoff mode - this prevents auto-connect to teleport destination
  bot.teleportHandoffMode = true;

  const handoffData: Partial<HandoffData> = {
    loginTime: Date.now(),
  };

  try {
    // Step 1: Login
    console.log(`[1] Logging in as ${CONFIG.firstName} ${CONFIG.lastName}...`);
    const loginResponse = await bot.login();
    console.log(`    ✓ Login successful!`);
    console.log(`    Message: ${loginResponse.loginMessage}`);

    // Extract session data from login
    handoffData.agentID = bot.agent.agentID.toString();
    console.log(`    Agent ID: ${handoffData.agentID}`);

    // Step 2: Connect to sim (we need to be connected to teleport)
    console.log(`\n[2] Connecting to simulator...`);
    await bot.connectToSim();
    console.log(`    ✓ Connected to ${bot.currentRegion.regionName}`);

    // Extract circuit data after connection
    const circuit = bot.currentRegion.circuit;
    handoffData.sessionID = circuit.sessionID.toString();
    handoffData.secureSessionID = circuit.secureSessionID.toString();
    handoffData.circuitCode = circuit.circuitCode;
    handoffData.sourceRegion = bot.currentRegion.regionName;

    console.log(`    Session ID: ${handoffData.sessionID}`);
    console.log(`    Secure Session ID: ${handoffData.secureSessionID}`);
    console.log(`    Circuit Code: ${handoffData.circuitCode}`);
    console.log(`    Sim IP: ${circuit.ipAddress}:${circuit.port}`);

    // Step 3: Initiate teleport (handoff mode prevents auto-connect to destination)
    console.log(`\n[3] Initiating teleport to "${CONFIG.teleportDestination}"...`);
    console.log(`    (teleportHandoffMode = ${bot.teleportHandoffMode})`);

    // Default position (center of region) and look direction
    const position = new Vector3([128, 128, 30]);
    const lookAt = new Vector3([1, 0, 0]);

    // With handoff mode enabled, this returns the TeleportEvent without connecting
    const tpEvent = await bot.clientCommands.teleport.teleportTo(CONFIG.teleportDestination, position, lookAt);

    console.log(`\n[4] ✓ TeleportCompleted (handoff mode - did NOT connect to destination)`);
    console.log(`    Destination IP: ${tpEvent.simIP}`);
    console.log(`    Destination Port: ${tpEvent.simPort}`);
    console.log(`    Region Handle: ${tpEvent.regionHandle?.toString()}`);
    console.log(`    Seed Capability: ${tpEvent.seedCapability?.substring(0, 80)}...`);

    // Capture handoff data
    handoffData.simIP = tpEvent.simIP;
    handoffData.simPort = tpEvent.simPort;
    handoffData.seedCapability = tpEvent.seedCapability;
    handoffData.regionHandle = tpEvent.regionHandle?.toString();
    handoffData.teleportTime = Date.now();
    handoffData.destinationRegion = CONFIG.teleportDestination;

    // Step 5: Output complete handoff data
    console.log(`\n[5] === HANDOFF DATA ===`);
    console.log(JSON.stringify(handoffData, null, 2));

    console.log(`\n[6] This data would be passed to the viewer to connect directly.`);
    console.log(`    The viewer would:`);
    console.log(`    1. Skip login UI`);
    console.log(`    2. Use agent_id, session_id, secure_session_id, circuit_code`);
    console.log(`    3. Connect UDP to ${handoffData.simIP}:${handoffData.simPort}`);
    console.log(`    4. Send UseCircuitCode message with circuit_code=${handoffData.circuitCode}`);
    console.log(`    5. Bootstrap capabilities from seed: ${handoffData.seedCapability?.substring(0, 50)}...`);

    console.log(`\n    Note: We are still connected to ${handoffData.sourceRegion}, NOT ${handoffData.destinationRegion}`);
    console.log(`    The destination sim is expecting a connection from this session.`);

  } catch (error) {
    console.error('\n✗ Error:', error);
  } finally {
    // Clean up - disconnect from source region
    console.log(`\n[7] Disconnecting from source region...`);
    try {
      await bot.close();
      console.log(`    ✓ Disconnected from source region`);
      console.log(`    (Destination sim may still be waiting for connection)`);
    } catch (e) {
      // Ignore close errors
    }
  }
}

main().catch(console.error);
