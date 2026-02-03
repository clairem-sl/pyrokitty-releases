import type { GameObject } from './public/GameObject';
import { Vector3 } from './Vector3';
import type { AssetRegistry } from './AssetRegistry';
export declare class BuildMap {
    readonly assetMap: AssetRegistry;
    readonly callback: (registry: AssetRegistry) => Promise<void>;
    readonly costOnly: boolean;
    primsNeeded: number;
    primReservoir: GameObject[];
    rezLocation: Vector3;
    constructor(assetMap: AssetRegistry, callback: (registry: AssetRegistry) => Promise<void>, costOnly?: boolean);
}
//# sourceMappingURL=BuildMap.d.ts.map