import { UUID } from './UUID';
import { InventoryFolder } from './InventoryFolder';
import type { Agent } from './Agent';
import { InventoryItem } from './InventoryItem';
import type { FolderType } from '../enums/FolderType';
export declare class Inventory {
    main: {
        skeleton: Map<string, InventoryFolder>;
        root?: UUID;
    };
    library: {
        owner?: UUID;
        skeleton: Map<string, InventoryFolder>;
        root?: UUID;
    };
    itemsByID: Map<string, InventoryItem>;
    private readonly agent;
    constructor(agent: Agent);
    getRootFolderLibrary(): InventoryFolder;
    getRootFolderMain(): InventoryFolder;
    findFolderForType(type: FolderType): UUID;
    findFolder(folderID: UUID): InventoryFolder | null;
    fetchInventoryItem(item: UUID): Promise<InventoryItem | null>;
}
//# sourceMappingURL=Inventory.d.ts.map