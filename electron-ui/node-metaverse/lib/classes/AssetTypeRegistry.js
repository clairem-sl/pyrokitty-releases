"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetTypeRegistry = exports.RegisteredAssetType = void 0;
const AssetType_1 = require("../enums/AssetType");
class RegisteredAssetType {
    type;
    description;
    typeName;
    humanName;
    canLink;
    canFetch;
    canKnow;
}
exports.RegisteredAssetType = RegisteredAssetType;
class AssetTypeRegistry {
    static assetTypeByType = new Map();
    static assetTypeByName = new Map();
    static assetTypeByHumanName = new Map();
    static registerAssetType(type, description, typeName, humanName, canLink, canFetch, canKnow) {
        const t = new RegisteredAssetType();
        t.type = type;
        t.description = description;
        t.typeName = typeName;
        t.humanName = humanName;
        t.canLink = canLink;
        t.canFetch = canFetch;
        t.canKnow = canKnow;
        this.assetTypeByType.set(type, t);
        this.assetTypeByName.set(typeName, t);
        this.assetTypeByHumanName.set(humanName, t);
    }
    static getType(type) {
        return this.assetTypeByType.get(type);
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
        return this.assetTypeByName.get(type);
    }
    static getTypeFromHumanName(type) {
        return this.assetTypeByHumanName.get(type);
    }
}
exports.AssetTypeRegistry = AssetTypeRegistry;
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Texture, 'TEXTURE', 'texture', 'texture', true, false, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Sound, 'SOUND', 'sound', 'sound', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.CallingCard, 'CALLINGCARD', 'callcard', 'calling card', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Landmark, 'LANDMARK', 'landmark', 'landmark', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Script, 'SCRIPT', 'script', 'legacy script', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Clothing, 'CLOTHING', 'clothing', 'clothing', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Object, 'OBJECT', 'object', 'object', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Notecard, 'NOTECARD', 'notecard', 'note card', true, false, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Category, 'CATEGORY', 'category', 'folder', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.LSLText, 'LSL_TEXT', 'lsltext', 'lsl2 script', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.LSLBytecode, 'LSL_BYTECODE', 'lslbyte', 'lsl bytecode', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.TextureTGA, 'TEXTURE_TGA', 'txtr_tga', 'tga texture', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Bodypart, 'BODYPART', 'bodypart', 'body part', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.SoundWAV, 'SOUND_WAV', 'snd_wav', 'sound', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.ImageTGA, 'IMAGE_TGA', 'img_tga', 'targa image', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.ImageJPEG, 'IMAGE_JPEG', 'jpeg', 'jpeg image', true, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Animation, 'ANIMATION', 'animatn', 'animation', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Gesture, 'GESTURE', 'gesture', 'gesture', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Simstate, 'SIMSTATE', 'simstate', 'simstate', false, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Link, 'LINK', 'link', 'sym link', false, false, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.LinkFolder, 'FOLDER_LINK', 'link_f', 'sym folder link', false, false, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Mesh, 'MESH', 'mesh', 'mesh', false, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Widget, 'WIDGET', 'widget', 'widget', false, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Person, 'PERSON', 'person', 'person', false, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Settings, 'SETTINGS', 'settings', 'settings blob', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Material, 'MATERIAL', 'material', 'render material', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.GLTF, 'GLTF', 'gltf', 'GLTF', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.GLTFBin, 'GLTF_BIN', 'glbin', 'GLTF binary', true, true, true);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.Unknown, 'UNKNOWN', 'invalid', 'Unknown', false, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.None, 'NONE', '-1', 'None', false, false, false);
AssetTypeRegistry.registerAssetType(AssetType_1.AssetType.LegacyMaterial, 'LEGACYMAT', 'legacymat', 'legacy material', false, false, false);
//# sourceMappingURL=AssetTypeRegistry.js.map