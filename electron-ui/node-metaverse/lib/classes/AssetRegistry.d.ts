import type { InventoryItem } from './InventoryItem';
import type { Material } from './public/Material';
import type { GameObject } from './public/GameObject';
import type { UUID } from './UUID';
import { AssetMap } from './AssetMap';
export declare class AssetRegistry {
    readonly mesh: AssetMap<InventoryItem>;
    readonly textures: AssetMap<InventoryItem>;
    readonly materials: AssetMap<Material>;
    readonly gltfMaterials: AssetMap<InventoryItem>;
    readonly animations: AssetMap<InventoryItem>;
    readonly sounds: AssetMap<InventoryItem>;
    readonly gestures: AssetMap<InventoryItem>;
    readonly callingcards: AssetMap<InventoryItem>;
    readonly scripts: AssetMap<InventoryItem>;
    readonly settings: AssetMap<InventoryItem>;
    readonly notecards: AssetMap<InventoryItem>;
    readonly wearables: AssetMap<InventoryItem>;
    readonly objects: AssetMap<InventoryItem>;
    scriptsToCompile: Map<string, {
        gameObject: GameObject;
        scripts: {
            item: InventoryItem;
            oldAssetID: UUID;
            mono: boolean;
            shouldStart: boolean;
        }[];
    }>;
    temporaryInventory: Map<string, InventoryItem>;
    byUUID: Map<string, InventoryItem>;
}
//# sourceMappingURL=AssetRegistry.d.ts.map