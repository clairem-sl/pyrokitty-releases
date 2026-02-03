"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetRegistry = void 0;
const AssetMap_1 = require("./AssetMap");
class AssetRegistry {
    mesh = new AssetMap_1.AssetMap();
    textures = new AssetMap_1.AssetMap();
    materials = new AssetMap_1.AssetMap();
    gltfMaterials = new AssetMap_1.AssetMap();
    animations = new AssetMap_1.AssetMap();
    sounds = new AssetMap_1.AssetMap();
    gestures = new AssetMap_1.AssetMap();
    callingcards = new AssetMap_1.AssetMap();
    scripts = new AssetMap_1.AssetMap();
    settings = new AssetMap_1.AssetMap();
    notecards = new AssetMap_1.AssetMap();
    wearables = new AssetMap_1.AssetMap();
    objects = new AssetMap_1.AssetMap();
    scriptsToCompile = new Map;
    temporaryInventory = new Map();
    byUUID = new Map();
}
exports.AssetRegistry = AssetRegistry;
//# sourceMappingURL=AssetRegistry.js.map