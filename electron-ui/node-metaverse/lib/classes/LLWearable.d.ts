import { UUID } from './UUID';
import type { WearableType } from '../enums/WearableType';
import type { SaleType } from '../enums/SaleType';
export declare class LLWearable {
    name: string;
    type: WearableType;
    parameters: Record<number, number>;
    textures: Record<number, UUID>;
    permission: {
        baseMask: number;
        ownerMask: number;
        groupMask: number;
        everyoneMask: number;
        nextOwnerMask: number;
        creatorID: UUID;
        ownerID: UUID;
        lastOwnerID: UUID;
        groupID: UUID;
    };
    saleType: SaleType;
    salePrice: number;
    constructor(data?: string);
    toAsset(): string;
}
//# sourceMappingURL=LLWearable.d.ts.map