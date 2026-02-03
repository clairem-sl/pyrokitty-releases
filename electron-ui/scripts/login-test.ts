/**
 * Simple Login Test
 *
 * Tests basic login with node_metaverse and extracts session data.
 * This is the simpler "no-teleport" handoff approach.
 *
 * Usage: npx ts-node scripts/login-test.ts
 */

import { Bot, BotOptionFlags, LoginParameters } from '../node-metaverse/lib';
import { CONFIG } from './config';

// Configuration - update these for testing


async function main() {
  console.log('=== Login Test ===\n');

  // Set up login parameters
  const loginParams = new LoginParameters();
  loginParams.firstName = CONFIG.firstName;
  loginParams.lastName = CONFIG.lastName;
  loginParams.password = CONFIG.password;
  loginParams.start = CONFIG.startLocation;
  loginParams.url = CONFIG.loginUrl;

  // Create bot with minimal options
  const bot = new Bot(loginParams, BotOptionFlags.None);

  try {
    // Step 1: Login only (no connectToSim)
    console.log(`[1] Logging in as ${CONFIG.firstName} ${CONFIG.lastName}...`);
    console.log(`    URL: ${CONFIG.loginUrl}`);
    console.log(`    Start: ${CONFIG.startLocation}`);

    const loginResponse = await bot.login();

    console.log(`\n[2] ✓ Login successful!`);
    console.log(`    Message: ${loginResponse.loginMessage}`);

    // Extract all session data
    const agent = loginResponse.agent;
    const region = loginResponse.region;

    console.log(`\n[3] === AGENT DATA ===`);
    console.log(`    Agent ID: ${agent.agentID}`);
    console.log(`    Name: ${agent.firstName} ${agent.lastName}`);
    console.log(`    Start Location: ${agent.startLocation}`);
    console.log(`    Access Max: ${agent.accessMax}`);
    console.log(`    Max Groups: ${agent.maxGroups}`);

    console.log(`\n[4] === REGION DATA ===`);
    console.log(`    Region Name: ${region.regionName}`);
    console.log(`    Region ID: ${region.regionID}`);
    console.log(`    Region Handle: ${region.regionHandle}`);
    console.log(`    Size: ${region.regionSizeX}x${region.regionSizeY}`);

    console.log(`\n[5] === CIRCUIT DATA ===`);
    const circuit = region.circuit;
    console.log(`    Session ID: ${circuit?.sessionID ?? 'N/A'}`);
    console.log(`    Secure Session ID: ${circuit?.secureSessionID ?? 'N/A'}`);
    console.log(`    Circuit Code: ${circuit?.circuitCode ?? 'N/A'}`);
    console.log(`    Sim IP: ${circuit?.ipAddress ?? 'N/A'}`);
    console.log(`    Sim Port: ${circuit?.port ?? 'N/A'}`);

    console.log(`\n[6] === CAPABILITIES ===`);
    // Caps might not be fully populated until connectToSim
    console.log(`    Caps object exists: ${!!region.caps}`);

    // Step 6b: Try connecting to see if we get more data
    console.log(`\n[6b] Calling connectToSim() to get full circuit data...`);
    await bot.connectToSim();
    console.log(`    ✓ Connected!`);

    // Re-extract circuit data after connection
    const connectedCircuit = bot.currentRegion.circuit;
    console.log(`\n[6c] === CIRCUIT DATA (after connect) ===`);
    console.log(`    Session ID: ${connectedCircuit?.sessionID ?? 'N/A'}`);
    console.log(`    Secure Session ID: ${connectedCircuit?.secureSessionID ?? 'N/A'}`);
    console.log(`    Circuit Code: ${connectedCircuit?.circuitCode ?? 'N/A'}`);
    console.log(`    Sim IP: ${connectedCircuit?.ipAddress ?? 'N/A'}`);
    console.log(`    Sim Port: ${connectedCircuit?.port ?? 'N/A'}`);

    // Build handoff JSON (using connected circuit data)
    const currentRegion = bot.currentRegion;
    const currentCircuit = currentRegion.circuit;
    const handoffData = {
      agent: {
        id: bot.agent.agentID?.toString() ?? null,
        firstName: bot.agent.firstName,
        lastName: bot.agent.lastName,
        startLocation: bot.agent.startLocation,
      },
      session: {
        sessionID: currentCircuit?.sessionID?.toString() ?? null,
        secureSessionID: currentCircuit?.secureSessionID?.toString() ?? null,
        circuitCode: currentCircuit?.circuitCode ?? null,
      },
      region: {
        name: currentRegion.regionName,
        id: currentRegion.regionID?.toString() ?? null,
        handle: currentRegion.regionHandle?.toString() ?? null,
        ip: currentCircuit?.ipAddress ?? null,
        port: currentCircuit?.port ?? null,
      },
      timestamp: Date.now(),
    };

    console.log(`\n[7] === HANDOFF JSON ===`);
    console.log(JSON.stringify(handoffData, null, 2));

    console.log(`\n[8] Note: node_metaverse is now connected.`);
    console.log(`    For handoff, we would disconnect and pass session data to viewer.`);
    console.log(`    The viewer would reconnect using the same session credentials.`);

  } catch (error: any) {
    console.error('\n✗ Login failed:', error.message || error);
    if (error.message?.includes('presence')) {
      console.log('\n    Hint: "presence" error usually means already logged in elsewhere.');
    }
  } finally {
    // Clean up
    console.log(`\n[9] Closing...`);
    try {
      await bot.close();
    } catch (e) {
      // Ignore
    }
    console.log(`    Done.`);
  }
}

main().catch(console.error);
