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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UUID = void 0;
const validator_1 = __importDefault(require("validator"));
const long_1 = __importDefault(require("long"));
const uuid = __importStar(require("uuid"));
class UUID {
    mUUID = '00000000-0000-0000-0000-000000000000';
    constructor(buf, pos) {
        if (buf !== undefined) {
            if (typeof buf === 'string') {
                this.setUUID(buf);
            }
            else if (pos !== undefined) {
                const uuidBuf = buf.subarray(pos, pos + 16);
                const hexString = uuidBuf.toString('hex');
                this.setUUID(hexString.substring(0, 8) + '-'
                    + hexString.substring(8, 12) + '-'
                    + hexString.substring(12, 16) + '-'
                    + hexString.substring(16, 20) + '-'
                    + hexString.substring(20, 32));
            }
            else if (typeof buf === 'object' && buf.toString !== undefined) {
                this.setUUID(buf.toString());
            }
            else {
                console.error('Can\'t accept UUIDs of type ' + typeof buf);
            }
        }
    }
    static zero() {
        return new UUID();
    }
    static random() {
        const newUUID = uuid.v4();
        return new UUID(newUUID);
    }
    static getString(u) {
        if (u === undefined) {
            return UUID.zero().toString();
        }
        else {
            return u.toString();
        }
    }
    static getXML(doc, u) {
        const str = UUID.getString(u);
        doc.ele('UUID', str);
    }
    static fromXMLJS(obj, param) {
        if (obj[param] === undefined) {
            return false;
        }
        if (Array.isArray(obj[param]) && obj[param].length > 0) {
            obj[param] = obj[param][0];
        }
        if (typeof obj[param] === 'string') {
            if (validator_1.default.isUUID(obj[param], 'loose')) {
                return new UUID(obj[param]);
            }
            return false;
        }
        if (typeof obj[param] === 'object') {
            if (obj[param].UUID !== undefined && Array.isArray(obj[param].UUID) && obj[param].UUID.length > 0) {
                const u = obj[param].UUID[0];
                if (typeof u === 'string') {
                    if (validator_1.default.isUUID(u, 'loose')) {
                        return new UUID(u);
                    }
                    return false;
                }
                return false;
            }
            return false;
        }
        return false;
    }
    setUUID(val) {
        const test = val.trim();
        if (validator_1.default.isUUID(test, 'loose')) {
            this.mUUID = test;
            return true;
        }
        else {
            console.log('Invalid UUID: ' + test + ' (length ' + val.length + ')');
        }
        return false;
    }
    toString = () => {
        return this.mUUID;
    };
    writeToBuffer(buf, pos) {
        const shortened = this.mUUID.substring(0, 8) + this.mUUID.substring(9, 13) + this.mUUID.substring(14, 18) + this.mUUID.substring(19, 23) + this.mUUID.substring(24, 36);
        const binary = Buffer.from(shortened, 'hex');
        binary.copy(buf, pos, 0);
    }
    isZero() {
        return (this.mUUID === '00000000-0000-0000-0000-000000000000');
    }
    equals(cmp) {
        if (typeof cmp === 'string') {
            return (cmp === this.mUUID);
        }
        else {
            if (cmp.equals === undefined) {
                throw new Error(cmp.constructor.name + ' is not a UUID');
            }
            return cmp.equals(this.mUUID);
        }
    }
    getBuffer() {
        const buf = Buffer.allocUnsafe(16);
        this.writeToBuffer(buf, 0);
        return buf;
    }
    getLong() {
        const buf = this.getBuffer();
        return new long_1.default(buf.readUInt32LE(7), buf.readUInt32LE(12));
    }
    bitwiseXor(w) {
        const buf1 = this.getBuffer();
        const buf2 = w.getBuffer();
        const buf3 = Buffer.allocUnsafe(16);
        for (let x = 0; x < 16; x++) {
            buf3[x] = buf1[x] ^ buf2[x];
        }
        return new UUID(buf3, 0);
    }
    CRC() {
        const bytes = this.getBuffer();
        const crcOne = ((bytes[3] << 24 >>> 0) + (bytes[2] << 16 >>> 0) + (bytes[1] << 8 >>> 0) + bytes[0]);
        const crcTwo = ((bytes[7] << 24 >>> 0) + (bytes[6] << 16 >>> 0) + (bytes[5] << 8 >>> 0) + bytes[4]);
        const crcThree = ((bytes[11] << 24 >>> 0) + (bytes[10] << 16 >>> 0) + (bytes[9] << 8 >>> 0) + bytes[8]);
        const crcFour = ((bytes[15] << 24 >>> 0) + (bytes[14] << 16 >>> 0) + (bytes[13] << 8 >>> 0) + bytes[12]);
        return crcOne + crcTwo + crcThree + crcFour >>> 0;
    }
}
exports.UUID = UUID;
//# sourceMappingURL=UUID.js.map