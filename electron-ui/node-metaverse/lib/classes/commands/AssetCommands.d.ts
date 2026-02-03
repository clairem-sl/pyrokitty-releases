import { CommandsBase } from './CommandsBase';
import { UUID } from '../UUID';
import { TransferChannelType } from '../../enums/TransferChannelType';
import { TransferSourceType } from '../../enums/TransferSourceTypes';
import { AssetType } from '../../enums/AssetType';
import { Material } from '../public/Material';
import type { InventoryFolder } from '../InventoryFolder';
import type { InventoryItem } from '../InventoryItem';
export declare class AssetCommands extends CommandsBase {
    downloadAsset(type: AssetType, uuid: UUID | string): Promise<Buffer>;
    copyInventoryFromNotecard(notecardID: UUID, folder: InventoryFolder, itemID: UUID, objectID?: UUID): Promise<InventoryItem>;
    downloadInventoryAsset(itemID: UUID, ownerID: UUID, type: AssetType, priority: boolean, objectID?: UUID, assetID?: UUID, outAssetID?: {
        assetID: UUID;
    }, sourceType?: TransferSourceType, channelType?: TransferChannelType): Promise<Buffer>;
    getMaterials(uuids: Record<string, Material | null>): Promise<void>;
    private transfer;
    private getMaterialsLimited;
}
//# sourceMappingURL=AssetCommands.d.ts.map