/**
 * Inventory Utilities
 *
 * Helper functions for inventory management, including duplicate detection and cleanup.
 */

import { Bot, UUID, PacketFlags } from '../node-metaverse/lib';
import { InventoryFolder } from '../node-metaverse/lib/classes/InventoryFolder';
import { MoveInventoryFolderMessage } from '../node-metaverse/lib/classes/messages/MoveInventoryFolder';
import { PurgeInventoryDescendentsMessage } from '../node-metaverse/lib/classes/messages/PurgeInventoryDescendents';

// Folder type constants (from AssetType enum)
export const FolderTypes = {
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

// System folder types that should only have one instance
export const SYSTEM_FOLDER_TYPES: { type: number; name: string }[] = [
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

interface DuplicateInfo {
  type: number;
  name: string;
  keep: FolderInfo;
  duplicates: FolderInfo[];
}

/**
 * Detect duplicate system folders in the inventory
 * @returns Array of duplicate info, or empty array if no duplicates
 */
export function detectDuplicateSystemFolders(bot: Bot): DuplicateInfo[] {
  const inventory = bot.agent.inventory;
  if (!inventory || !inventory.main) {
    return [];
  }

  const rootFolderID = inventory.main.root;
  if (!rootFolderID) {
    return [];
  }

  const skeleton = inventory.main.skeleton;
  if (!skeleton) {
    return [];
  }

  // Group folders by type
  const foldersByType = new Map<number, FolderInfo[]>();

  for (const [, folder] of skeleton) {
    // Only look at direct children of root
    if (folder.parentID && folder.parentID.equals(rootFolderID)) {
      const folderType = folder.typeDefault;

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

  // Find duplicates
  const duplicates: DuplicateInfo[] = [];

  for (const systemType of SYSTEM_FOLDER_TYPES) {
    const folders = foldersByType.get(systemType.type) || [];
    if (folders.length > 1) {
      // Sort by version (desc) - highest version is the most used
      const sorted = [...folders].sort((a, b) => b.version - a.version);
      duplicates.push({
        type: systemType.type,
        name: systemType.name,
        keep: sorted[0],
        duplicates: sorted.slice(1),
      });
    }
  }

  return duplicates;
}

/**
 * Get total count of duplicate folders
 */
export function getDuplicateCount(duplicates: DuplicateInfo[]): number {
  return duplicates.reduce((sum, d) => sum + d.duplicates.length, 0);
}

/**
 * Move a folder to trash
 */
async function moveToTrash(bot: Bot, folderID: UUID, trashFolderID: UUID): Promise<void> {
  const msg = new MoveInventoryFolderMessage();
  msg.AgentData = {
    AgentID: bot.agent.agentID,
    SessionID: bot.agent.currentRegion.circuit.sessionID,
    Stamp: false,
  };
  msg.InventoryData = [
    { FolderID: folderID, ParentID: trashFolderID }
  ];

  const ack = bot.agent.currentRegion.circuit.sendMessage(msg, PacketFlags.Reliable);
  await bot.agent.currentRegion.circuit.waitForAck(ack, 10000);
}

/**
 * Purge trash folder contents
 */
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

/**
 * Fix duplicate system folders by moving them to trash and purging
 * @param bot Connected bot instance
 * @param onProgress Optional callback for progress updates
 * @returns Number of folders cleaned up
 */
export async function fixDuplicateSystemFolders(
  bot: Bot,
  onProgress?: (message: string) => void
): Promise<number> {
  const log = onProgress || console.log;

  const duplicates = detectDuplicateSystemFolders(bot);
  if (duplicates.length === 0) {
    log('No duplicate system folders found');
    return 0;
  }

  const totalDuplicates = getDuplicateCount(duplicates);
  log(`Found ${totalDuplicates} duplicate folders across ${duplicates.length} folder types`);

  // Find the trash folder to keep
  const trashDuplicate = duplicates.find(d => d.type === FolderTypes.Trash);
  let trashFolderID: UUID;

  if (trashDuplicate) {
    trashFolderID = trashDuplicate.keep.folder.folderID;
  } else {
    // Find existing trash folder
    const inventory = bot.agent.inventory;
    const skeleton = inventory?.main?.skeleton;
    const rootFolderID = inventory?.main?.root;

    if (!skeleton || !rootFolderID) {
      throw new Error('Cannot access inventory skeleton');
    }

    for (const [, folder] of skeleton) {
      if (folder.parentID?.equals(rootFolderID) && folder.typeDefault === FolderTypes.Trash) {
        trashFolderID = folder.folderID;
        break;
      }
    }
  }

  if (!trashFolderID!) {
    throw new Error('No Trash folder found');
  }

  log(`Using Trash folder: ${trashFolderID.toString()}`);

  // Move all duplicates to trash
  let cleanedCount = 0;
  for (const dup of duplicates) {
    for (const duplicate of dup.duplicates) {
      log(`Moving duplicate ${dup.name} (v${duplicate.version}) to Trash...`);
      try {
        await moveToTrash(bot, duplicate.folder.folderID, trashFolderID);
        cleanedCount++;
        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        log(`  Failed to move: ${err}`);
      }
    }
  }

  // Purge trash
  if (cleanedCount > 0) {
    log('Purging Trash...');
    try {
      await purgeTrash(bot, trashFolderID);
      log('Trash purged successfully');
    } catch (err) {
      log(`Failed to purge trash: ${err}`);
    }
  }

  log(`Cleaned up ${cleanedCount} duplicate folders`);
  return cleanedCount;
}

/**
 * Check and optionally fix inventory duplicates before handoff
 * @param bot Connected bot instance
 * @param autoFix If true, automatically fix duplicates. If false, just report.
 * @returns Object with duplicate count and whether fixes were applied
 */
export async function checkInventoryHealth(
  bot: Bot,
  autoFix: boolean = false,
  onProgress?: (message: string) => void
): Promise<{ duplicateCount: number; fixed: boolean }> {
  const duplicates = detectDuplicateSystemFolders(bot);
  const duplicateCount = getDuplicateCount(duplicates);

  if (duplicateCount === 0) {
    return { duplicateCount: 0, fixed: false };
  }

  if (autoFix) {
    await fixDuplicateSystemFolders(bot, onProgress);
    return { duplicateCount, fixed: true };
  }

  return { duplicateCount, fixed: false };
}
