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
exports.LLGLTFMaterial = void 0;
const LLSD = __importStar(require("@caspertech/llsd"));
class LLGLTFMaterial {
    type;
    version;
    data;
    constructor(data) {
        if (data !== undefined) {
            const header = data.subarray(0, 18).toString('utf-8');
            if (header.length !== 18 || header !== '<? LLSD/Binary ?>\n') {
                throw new Error('Failed to parse LLGLTFMaterial');
            }
            const body = new LLSD.Binary(Array.from(data.subarray(18)), 'BINARY');
            const llsd = LLSD.LLSD.parseBinary(body);
            if (!llsd.result) {
                throw new Error('Failed to decode LLGLTFMaterial');
            }
            if (llsd.result.type) {
                this.type = String(llsd.result.type);
            }
            if (llsd.result.version) {
                this.version = String(llsd.result.version);
            }
            if (llsd.result.data) {
                const assetData = String(llsd.result.data);
                this.data = JSON.parse(assetData);
            }
        }
    }
}
exports.LLGLTFMaterial = LLGLTFMaterial;
//# sourceMappingURL=LLGLTFMaterial.js.map