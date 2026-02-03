import type { ParcelInfoFlags } from '../enums/ParcelInfoFlags';
import type { UUID } from '../classes/UUID';
import type { Vector3 } from '../classes/Vector3';
export declare class ParcelInfoReplyEvent {
    OwnerID: UUID;
    ParcelName: string;
    ParcelDescription: string;
    Area: number;
    BillableArea: number;
    Flags: ParcelInfoFlags;
    GlobalCoordinates: Vector3;
    RegionName: string;
    SnapshotID: UUID;
    Traffic: number;
    SalePrice: number;
    AuctionID: number;
}
//# sourceMappingURL=ParcelInfoReplyEvent.d.ts.map