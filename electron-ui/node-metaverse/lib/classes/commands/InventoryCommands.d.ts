import { CommandsBase } from './CommandsBase';
import type { InventoryFolder } from '../InventoryFolder';
import type { InventoryOfferedEvent } from '../../events/InventoryOfferedEvent';
import { UUID } from '../UUID';
import type { InventoryItem } from '../InventoryItem';
export declare class InventoryCommands extends CommandsBase {
    getInventoryRoot(): InventoryFolder;
    getLibraryRoot(): InventoryFolder;
    getInventoryItem(item: UUID | string): Promise<InventoryItem>;
    acceptInventoryOffer(event: InventoryOfferedEvent): Promise<void>;
    rejectInventoryOffer(event: InventoryOfferedEvent): Promise<void>;
    private respondToInventoryOffer;
}
//# sourceMappingURL=InventoryCommands.d.ts.map