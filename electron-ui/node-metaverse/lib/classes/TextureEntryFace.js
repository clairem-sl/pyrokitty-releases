"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextureEntryFace = void 0;
const TextureFlags_1 = require("../enums/TextureFlags");
const Bumpiness_1 = require("../enums/Bumpiness");
const Shininess_1 = require("../enums/Shininess");
const MappingType_1 = require("../enums/MappingType");
class TextureEntryFace {
    static BUMP_MASK = 0x1F;
    static FULLBRIGHT_MASK = 0x20;
    static SHINY_MASK = 0xC0;
    static MEDIA_MASK = 0x01;
    static TEX_MAP_MASK = 0x06;
    _textureID;
    _rgba;
    _repeatU;
    _repeatV;
    _offsetU;
    _offsetV;
    _rotation;
    _glow;
    _materialID;
    _bumpiness = Bumpiness_1.Bumpiness.None;
    _shininess = Shininess_1.Shininess.None;
    _mappingType = MappingType_1.MappingType.Default;
    _fullBright = false;
    _mediaFlags = false;
    _material;
    _media;
    hasAttribute;
    defaultTexture;
    constructor(def) {
        this.defaultTexture = def;
        if (this.defaultTexture == null) {
            this.hasAttribute = TextureFlags_1.TextureFlags.All;
        }
        else {
            this.hasAttribute = TextureFlags_1.TextureFlags.None;
        }
    }
    get rgba() {
        if (this._rgba === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.rgba;
        }
        return this._rgba;
    }
    set rgba(value) {
        this._rgba = value;
    }
    get repeatU() {
        if (this._repeatU === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.repeatU;
        }
        return this._repeatU;
    }
    set repeatU(value) {
        this._repeatU = value;
    }
    get repeatV() {
        if (this._repeatV === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.repeatV;
        }
        return this._repeatV;
    }
    set repeatV(value) {
        this._repeatV = value;
    }
    get offsetU() {
        if (this._offsetU === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.offsetU;
        }
        return this._offsetU;
    }
    set offsetU(value) {
        this._offsetU = value;
    }
    get offsetV() {
        if (this._offsetV === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.offsetV;
        }
        return this._offsetV;
    }
    set offsetV(value) {
        this._offsetV = value;
    }
    get rotation() {
        if (this._rotation === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.rotation;
        }
        return this._rotation;
    }
    set rotation(value) {
        this._rotation = value;
    }
    get glow() {
        if (this._glow === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.glow;
        }
        return this._glow;
    }
    set glow(value) {
        this._glow = value;
    }
    get textureID() {
        if (this._textureID === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.textureID;
        }
        return this._textureID;
    }
    set textureID(value) {
        this._textureID = value;
    }
    get materialID() {
        if (this._materialID === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.materialID;
        }
        return this._materialID;
    }
    set materialID(value) {
        this._materialID = value;
    }
    get material() {
        if (this._material === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.material;
        }
        return this._material;
    }
    set material(material) {
        this._material = material;
        if ((this.hasAttribute & TextureFlags_1.TextureFlags.Material) !== 0) {
            this._bumpiness = this._material & TextureEntryFace.BUMP_MASK;
            this._shininess = this._material & TextureEntryFace.SHINY_MASK;
            this._fullBright = ((this._material & TextureEntryFace.FULLBRIGHT_MASK) !== 0);
        }
        else if (this.defaultTexture !== null) {
            this._bumpiness = this.defaultTexture._bumpiness;
            this._shininess = this.defaultTexture._shininess;
            this._fullBright = this.defaultTexture._fullBright;
        }
    }
    get media() {
        if (this._media === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.media;
        }
        return this._media;
    }
    set media(media) {
        this._media = media;
        if ((this.hasAttribute & TextureFlags_1.TextureFlags.Media) !== 0) {
            this._mappingType = media & TextureEntryFace.TEX_MAP_MASK;
            this._mediaFlags = ((media & TextureEntryFace.MEDIA_MASK) !== 0);
        }
        else if (this.defaultTexture !== null) {
            this._mappingType = this.defaultTexture.mappingType;
            this._mediaFlags = this.defaultTexture.mediaFlags;
        }
        else {
            throw new Error('No media attribute and default texture is null');
        }
    }
    get mappingType() {
        if (this._mappingType === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.mappingType;
        }
        return this._mappingType;
    }
    set mappingType(value) {
        this._mappingType = value;
    }
    get mediaFlags() {
        if (this._mediaFlags === undefined && this.defaultTexture !== null) {
            return this.defaultTexture.mediaFlags;
        }
        return this._mediaFlags;
    }
    set mediaFlags(value) {
        this._mediaFlags = value;
    }
}
exports.TextureEntryFace = TextureEntryFace;
//# sourceMappingURL=TextureEntryFace.js.map