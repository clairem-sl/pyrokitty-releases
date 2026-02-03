/**
 * Fix Inventory Duplicate System Folders
 *
 * This script identifies and consolidates duplicate system folders in the inventory.
 * It will:
 * 1. Find all system folders under root
 * 2. Identify duplicates by folder type
 * 3. Keep the folder with the highest version number
 * 4. Delete the duplicate folders using UDP messages
 *
 * Usage: npx tsx scripts/fix-inventory-duplicates.ts [--dry-run]
 */

import { Bot, BotOptionFlags, LoginParameters, UUID, PacketFlags } from '../node-metaverse/lib';
import { InventoryFolder } from '../node-metaverse/lib/classes/InventoryFolder';
import { MoveInventoryFolderMessage } from '../node-metaverse/lib/classes/messages/MoveInventoryFolder';
import { PurgeInventoryDescendentsMessage } from '../node-metaverse/lib/classes/messages/PurgeInventoryDescendents';
import { CONFIG } from './config';

// Folder type constants (from AssetType enum)
const FolderTypes = {
  Trash: 14,
  Favorites: 23,
  CurrentOutfit: 46,
  MyOutfits: 48,
  Inbox: 50,  // Received Items
  Settings: 56,
  Material: 57,
  CallingCard: 2,
  Landmark: 3,
  MarketplaceListings: 53,
};

// Folder types that should only have one instance
const SYSTEM_FOLDER_TYPES: { type: number; name: string }[] = [
  { type: FolderTypes.Trash, name: 'Trash' },
  { type: FolderTypes.Favorites, name: 'Favorites' },
  { type: FolderTypes.CurrentOutfit, name: 'Current Outfit' },
  { type: FolderTypes.MyOutfits, name: 'My Outfits' },
  { type: FolderTypes.Inbox, name: 'Received Items' },
  { type: FolderTypes.Settings, name: 'Settings' },
  { type: FolderTypes.Material, name: 'Materials' },
  { type: FolderTypes.CallingCard, name: 'Calling Cards' },
  { type: FolderTypes.Landmark, name: 'Landmarks' },
  { type: FolderTypes.MarketplaceListings, name: 'Marketplace Listings' },
];

interface FolderInfo {
  folder: InventoryFolder;
  version: number;
}

const isDryRun = process.argv.includes('--dry-run');

async function moveToTrash(bot: Bot, folderID: UUID, trashFolderID: UUID): Promise<void> {
  const msg = new MoveInventoryFolderMessage();
  msg.AgentData = {
    AgentID: bot.agent.agentID,
    SessionID: bot.agent.currentRegion.circuit.sessionID,
    Stamp: false, // Don't update timestamp
  };
  msg.InventoryData = [
    { FolderID: folderID, ParentID: trashFolderID }
  ];

  const ack = bot.agent.currentRegion.circuit.sendMessage(msg, PacketFlags.Reliable);
  await bot.agent.currentRegion.circuit.waitForAck(ack, 10000);
}

async function purgeTrash(bot: Bot, trashFolderID: UUID): Promise<void> {
  const msg = new PurgeInventoryDescendentsMessage();
  msg.AgentData = {
    AgentID: bot.agent.agentID,
    SessionID: bot.agent.currentRegion.circuit.sessionID,
  };
  msg.InventoryData = {
    FolderID: trashFolderID,
  };

  const ack = bot.agent.currentRegion.circuit.sendMessage(msg, PacketFlags.Reliable);
  await bot.agent.currentRegion.circuit.waitForAck(ack, 10000);
}

async function main() {
  console.log('=== Inventory Duplicate Folder Fixer ===\n');
  if (isDryRun) {
    console.log('*** DRY RUN MODE - No changes will be made ***\n');
  }

  const loginParams = new LoginParameters();
  loginParams.firstName = CONFIG.firstName;
  loginParams.lastName = CONFIG.lastName;
  loginParams.password = CONFIG.password;
  loginParams.start = CONFIG.startLocation;
  loginParams.url = CONFIG.loginUrl;

  const bot = new Bot(loginParams, BotOptionFlags.None);

  try {
    // Login
    console.log(`[1] Logging in as ${CONFIG.firstName} ${CONFIG.lastName}...`);
    await bot.login();
    console.log('    Login successful!');

    // Connect to sim
    console.log('\n[2] Connecting to simulator...');
    await bot.connectToSim();
    console.log(`    Connected to ${bot.currentRegion.regionName}`);

    // Wait for inventory to load
    console.log('\n[3] Waiting for inventory to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const inventory = bot.agent.inventory;
    if (!inventory || !inventory.main) {
      throw new Error('Inventory not available');
    }

    const rootFolderID = inventory.main.root;
    if (!rootFolderID) {
      throw new Error('Root folder ID not found');
    }

    console.log(`    Root folder ID: ${rootFolderID.toString()}`);

    // Get all folders under root from skeleton
    console.log('\n[4] Scanning for duplicate system folders...');

    const foldersByType = new Map<number, FolderInfo[]>();
    const skeleton = inventory.main.skeleton;

    if (!skeleton) {
      throw new Error('Inventory skeleton not available');
    }

    console.log(`    Skeleton has ${skeleton.size} folders`);

    // Scan skeleton for folders under root
    for (const [, folder] of skeleton) {
      // Only look at direct children of root
      if (folder.parentID && folder.parentID.equals(rootFolderID)) {
        const folderType = folder.typeDefault;

        // Check if this is a system folder type we care about
        const systemType = SYSTEM_FOLDER_TYPES.find(st => st.type === folderType);
        if (systemType) {
          if (!foldersByType.has(folderType)) {
            foldersByType.set(folderType, []);
          }

          foldersByType.get(folderType)!.push({
            folder: folder,
            version: folder.version,
          });
        }
      }
    }

    // Report findings
    console.log('\n[5] Analysis of system folders:\n');

    const duplicates: { type: number; name: string; folders: FolderInfo[] }[] = [];

    for (const systemType of SYSTEM_FOLDER_TYPES) {
      const folders = foldersByType.get(systemType.type) || [];
      const status = folders.length > 1 ? `DUPLICATE (${folders.length} copies)` :
        folders.length === 1 ? 'OK' : 'MISSING';

      console.log(`    ${systemType.name} (type ${systemType.type}): ${status}`);

      if (folders.length > 1) {
        for (const info of folders) {
          console.log(`      - ${info.folder.name} (${info.folder.folderID.toString()}) v${info.version}`);
        }
        duplicates.push({ type: systemType.type, name: systemType.name, folders });
      }
    }

    if (duplicates.length === 0) {
      console.log('\n    No duplicate system folders found!');
      return;
    }

    // Determine which folder to keep for each type
    console.log('\n[6] Consolidation plan:\n');

    const moveQueue: { name: string; folderID: UUID }[] = [];
    let trashFolderID: UUID | null = null;

    for (const dup of duplicates) {
      // Sort by version (desc) - highest version is the most used
      const sorted = [...dup.folders].sort((a, b) => b.version - a.version);

      const keeper = sorted[0];
      const toDelete = sorted.slice(1);

      // Track the Trash folder we're keeping
      if (dup.type === FolderTypes.Trash) {
        trashFolderID = keeper.folder.folderID;
      }

      console.log(`    ${dup.name}:`);
      console.log(`      KEEP: ${keeper.folder.name} (v${keeper.version}) - ${keeper.folder.folderID.toString()}`);
      for (const del of toDelete) {
        console.log(`      MOVE TO TRASH: ${del.folder.name} (v${del.version}) - ${del.folder.folderID.toString()}`);
        moveQueue.push({ name: `${dup.name} (v${del.version})`, folderID: del.folder.folderID });
      }
    }

    // If no Trash duplicates, find the primary Trash folder
    if (!trashFolderID) {
      const trashFolders = foldersByType.get(FolderTypes.Trash);
      if (trashFolders && trashFolders.length > 0) {
        trashFolderID = trashFolders[0].folder.folderID;
        console.log(`\n    Using existing Trash folder: ${trashFolderID.toString()}`);
      }
    }

    if (!trashFolderID) {
      throw new Error('No Trash folder found - cannot proceed');
    }

    console.log(`\n    Total folders to move to trash: ${moveQueue.length}`);

    if (isDryRun) {
      console.log('\n*** DRY RUN - No changes made. Run without --dry-run to apply fixes. ***');
      return;
    }

    // Apply fixes - move to trash
    console.log('\n[7] Moving duplicate folders to Trash...\n');

    let successCount = 0;
    let failCount = 0;

    for (const item of moveQueue) {
      console.log(`    Moving ${item.name} to Trash...`);
      try {
        await moveToTrash(bot, item.folderID, trashFolderID);
        console.log(`      Success!`);
        successCount++;
      } catch (err) {
        console.log(`      Failed: ${err}`);
        failCount++;
      }

      // Small delay between moves
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n    Moved: ${successCount} folders`);
    console.log(`    Failed: ${failCount} folders`);

    // Purge trash to permanently delete moved folders
    console.log('\n[8] Purging Trash to permanently delete moved folders...');
    try {
      await purgeTrash(bot, trashFolderID);
      console.log('    Trash purged successfully!');
    } catch (err) {
      console.log(`    Failed to purge trash: ${err}`);
    }

    console.log(`\n=== Inventory cleanup complete! ===`);

  } catch (error) {
    console.error('\nError:', error);
  } finally {
    console.log('\nDisconnecting...');
    try {
      await bot.close();
    } catch (e) {
      // Ignore close errors
    }
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
