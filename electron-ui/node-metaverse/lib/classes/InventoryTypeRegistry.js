"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryTypeRegistry = exports.RegisteredInventoryType = void 0;
const InventoryType_1 = require("../enums/InventoryType");
const AssetType_1 = require("../enums/AssetType");
class RegisteredInventoryType {
    type;
    typeName;
    humanName;
    assetTypes;
}
exports.RegisteredInventoryType = RegisteredInventoryType;
class InventoryTypeRegistry {
    static invTypeByType = new Map();
    static invTypeByName = new Map();
    static invTypeByHumanName = new Map();
    static registerInventoryType(type, typeName, humanName, assetTypes) {
        const t = new RegisteredInventoryType();
        t.type = type;
        t.typeName = typeName;
        t.humanName = humanName;
        t.assetTypes = assetTypes;
        this.invTypeByType.set(type, t);
        this.invTypeByName.set(typeName, t);
        this.invTypeByHumanName.set(humanName, t);
    }
    static getType(type) {
        return this.invTypeByType.get(type);
    }
    static getTypeName(type) {
        const t = this.getType(type);
        if (t === undefined) {
            return 'invalid';
        }
        return t.typeName;
    }
    static getHumanName(type) {
        const t = this.getType(type);
        if (t === undefined) {
            return 'Unknown';
        }
        return t.humanName;
    }
    static getTypeFromTypeName(type) {
        return this.invTypeByName.get(type);
    }
    static getTypeFromHumanName(type) {
        return this.invTypeByHumanName.get(type);
    }
}
exports.InventoryTypeRegistry = InventoryTypeRegistry;
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Texture, 'texture', 'texture', [AssetType_1.AssetType.Texture]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Sound, 'sound', 'sound', [AssetType_1.AssetType.Sound]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.CallingCard, 'callcard', 'calling card', [AssetType_1.AssetType.CallingCard]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Landmark, 'landmark', 'landmark', [AssetType_1.AssetType.Landmark]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Object, 'object', 'object', [AssetType_1.AssetType.Object]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Notecard, 'notecard', 'note card', [AssetType_1.AssetType.Notecard]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Category, 'category', 'folder', []);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.RootCategory, 'root', 'root', []);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.LSL, 'script', 'script', [AssetType_1.AssetType.LSLText, AssetType_1.AssetType.LSLBytecode]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Snapshot, 'snapshot', 'snapshot', [AssetType_1.AssetType.Texture]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Attachment, 'attach', 'attachment', [AssetType_1.AssetType.Object]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Wearable, 'wearable', 'wearable', [AssetType_1.AssetType.Clothing, AssetType_1.AssetType.Bodypart]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Animation, 'animation', 'animation', [AssetType_1.AssetType.Animation]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Gesture, 'gesture', 'gesture', [AssetType_1.AssetType.Gesture]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Mesh, 'mesh', 'mesh', [AssetType_1.AssetType.Mesh]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.GLTF, 'gltf', 'gltf', [AssetType_1.AssetType.GLTF]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.GLTFBin, 'glbin', 'glbin', [AssetType_1.AssetType.GLTFBin]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Widget, 'widget', 'widget', [AssetType_1.AssetType.Widget]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Person, 'person', 'person', [AssetType_1.AssetType.Person]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Settings, 'settings', 'settings', [AssetType_1.AssetType.Settings]);
InventoryTypeRegistry.registerInventoryType(InventoryType_1.InventoryType.Material, 'material', 'render material', [AssetType_1.AssetType.Material]);
//# sourceMappingURL=InventoryTypeRegistry.js.map