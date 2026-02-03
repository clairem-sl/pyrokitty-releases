"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Material = void 0;
const UUID_1 = require("../UUID");
const Color4_1 = require("../Color4");
const LLSD = __importStar(require("@caspertech/llsd"));
const Utils_1 = require("../Utils");
class Material {
    alphaMaskCutoff;
    diffuseAlphaMode;
    envIntensity;
    normMap;
    normOffsetX;
    normOffsetY;
    normRepeatX;
    normRepeatY;
    normRotation;
    specColor;
    specExp;
    specMap;
    specOffsetX;
    specOffsetY;
    specRepeatX;
    specRepeatY;
    specRotation;
    static fromLLSD(llsd) {
        const parsed = LLSD.LLSD.parseXML(llsd);
        return this.fromLLSDObject(parsed);
    }
    static fromLLSDObject(parsed) {
        const material = new Material();
        if (parsed.AlphaMaskCutoff !== undefined) {
            material.alphaMaskCutoff = parsed.AlphaMaskCutoff;
        }
        if (parsed.DiffuseAlphaMode !== undefined) {
            material.diffuseAlphaMode = parsed.DiffuseAlphaMode;
        }
        if (parsed.EnvIntensity !== undefined) {
            material.envIntensity = parsed.EnvIntensity;
        }
        if (parsed.NormMap !== undefined) {
            material.normMap = new UUID_1.UUID(parsed.NormMap.toString());
        }
        if (parsed.NormOffsetX !== undefined) {
            material.normOffsetX = parsed.NormOffsetX;
        }
        if (parsed.NormOffsetY !== undefined) {
            material.normOffsetY = parsed.NormOffsetY;
        }
        if (parsed.NormRepeatX !== undefined) {
            material.normRepeatX = parsed.NormRepeatX;
        }
        if (parsed.NormRepeatY !== undefined) {
            material.normRepeatY = parsed.NormRepeatY;
        }
        if (parsed.NormRotation !== undefined) {
            material.normRotation = parsed.NormRotation;
        }
        if (parsed.SpecColor !== undefined && Array.isArray(parsed.SpecColor) && parsed.SpecColor.length > 3) {
            material.specColor = new Color4_1.Color4([
                parsed.SpecColor[0],
                parsed.SpecColor[1],
                parsed.SpecColor[2],
                parsed.SpecColor[3]
            ]);
        }
        if (parsed.SpecExp !== undefined) {
            material.specExp = parsed.SpecExp;
        }
        if (parsed.SpecMap !== undefined) {
            material.specMap = new UUID_1.UUID(parsed.SpecMap.toString());
        }
        if (parsed.SpecOffsetX !== undefined) {
            material.specOffsetX = parsed.SpecOffsetX;
        }
        if (parsed.SpecOffsetY !== undefined) {
            material.specOffsetY = parsed.SpecOffsetY;
        }
        if (parsed.SpecRepeatX !== undefined) {
            material.specRepeatX = parsed.SpecRepeatX;
        }
        if (parsed.SpecRepeatY !== undefined) {
            material.specRepeatY = parsed.SpecRepeatY;
        }
        if (parsed.SpecRotation !== undefined) {
            material.specRotation = parsed.SpecRotation;
        }
        return material;
    }
    toLLSDObject() {
        return {
            'AlphaMaskCutoff': this.alphaMaskCutoff,
            'DiffuseAlphaMode': this.diffuseAlphaMode,
            'EnvIntensity': this.envIntensity,
            'NormMap': new LLSD.UUID(this.normMap.toString()),
            'NormOffsetX': this.normOffsetX,
            'NormOffsetY': this.normOffsetY,
            'NormRepeatX': this.normRepeatX,
            'NormRepeatY': this.normRepeatY,
            'NormRotation': this.normRotation,
            'SpecColor': [
                this.specColor.getRed(),
                this.specColor.getGreen(),
                this.specColor.getBlue(),
                this.specColor.getAlpha()
            ],
            'SpecExp': this.specExp,
            'SpecMap': new LLSD.UUID(this.specMap.toString()),
            'SpecOffsetX': this.specOffsetX,
            'SpecOffsetY': this.specOffsetY,
            'SpecRepeatX': this.specRepeatX,
            'SpecRepeatY': this.specRepeatY,
            'SpecRotation': this.specRotation,
        };
    }
    toLLSD() {
        return String(LLSD.LLSD.formatXML(this.toLLSDObject()));
    }
    async toAsset(uuid) {
        const asset = {
            'ID': new LLSD.UUID(uuid.toString()),
            'Material': this.toLLSD()
        };
        const binary = LLSD.LLSD.formatBinary(asset);
        return Utils_1.Utils.deflate(Buffer.from(binary.toArray()));
    }
}
exports.Material = Material;
//# sourceMappingURL=Material.js.map