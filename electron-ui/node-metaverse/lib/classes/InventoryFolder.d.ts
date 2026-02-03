import type { AssetType } from '../enums/AssetType';
import { FolderType } from '../enums/FolderType';
import { InventoryItemFlags } from '../enums/InventoryItemFlags';
import { InventoryLibrary } from '../enums/InventoryLibrary';
import { InventoryType } from '../enums/InventoryType';
import type { Agent } from './Agent';
import { InventoryItem } from './InventoryItem';
import { UUID } from './UUID';
export declare class InventoryFolder {
    typeDefault: FolderType;
    version: number;
    name: string;
    folderID: UUID;
    parentID: UUID;
    items: InventoryItem[];
    folders: InventoryFolder[];
    cacheDir: string;
    agent: Agent;
    library: InventoryLibrary;
    private callbackID;
    private readonly inventoryBase;
    constructor(lib: InventoryLibrary, invBase: {
        owner?: UUID;
        skeleton: Map<string, InventoryFolder>;
        root?: UUID;
    }, agent: Agent);
    getChildFolders(): InventoryFolder[];
    getChildFoldersRecursive(): InventoryFolder[];
    createFolder(name: string, type: FolderType): Promise<InventoryFolder>;
    delete(saveCache?: boolean): Promise<void>;
    removeItem(itemID: UUID, save?: boolean): Promise<void>;
    addItem(item: InventoryItem, save?: boolean): Promise<void>;
    populate(useCached?: boolean): Promise<void>;
    uploadAsset(type: AssetType, inventoryType: InventoryType, data: Buffer, name: string, description: string, flags?: InventoryItemFlags): Promise<InventoryItem>;
    checkCopyright(creatorID: UUID): void;
    findFolder(id: UUID): InventoryFolder | null;
    uploadMesh(name: string, description: string, mesh: Buffer, confirmCostCallback: (cost: number) => Promise<boolean>): Promise<InventoryItem>;
    private saveCache;
    private loadCache;
    private populateInternal;
    private uploadInventoryAssetLegacy;
    private uploadInventoryItem;
    /**
     * Handles the upload process for standard inventory types such as Notecard, Settings, Script, and LSL.
     * @param inventoryType The type of inventory item.
     * @param itemID The UUID of the created inventory item.
     * @param data The data buffer to upload.
     */
    private handleStandardInventoryUpload;
}
//# sourceMappingURL=InventoryFolder.d.ts.map