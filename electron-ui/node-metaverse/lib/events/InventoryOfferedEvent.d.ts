import type { UUID } from '../classes/UUID';
import type { ChatSourceType } from '../enums/ChatSourceType';
import type { AssetType } from '../enums/AssetType';
export declare class InventoryOfferedEvent {
    from: UUID;
    fromName: string;
    requestID: UUID;
    message: string;
    source: ChatSourceType;
    type: AssetType;
}
//# sourceMappingURL=InventoryOfferedEvent.d.ts.map