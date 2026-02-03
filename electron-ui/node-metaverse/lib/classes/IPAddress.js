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
exports.IPAddress = void 0;
const ipaddr = __importStar(require("ipaddr.js"));
class IPAddress {
    ip = null;
    constructor(buf, pos) {
        try {
            if (buf !== undefined && buf instanceof Buffer) {
                if (pos !== undefined) {
                    const bytes = buf.subarray(pos, 4);
                    this.ip = ipaddr.fromByteArray(Array.from(bytes));
                }
                else if (typeof buf === 'string') {
                    if (ipaddr.isValid(buf)) {
                        this.ip = ipaddr.parse(buf);
                    }
                    else {
                        throw new Error('Invalid IP address');
                    }
                }
            }
            else if (typeof buf === 'string') {
                if (ipaddr.isValid(buf)) {
                    this.ip = ipaddr.parse(buf);
                }
                else {
                    throw new Error('Invalid IP address');
                }
            }
        }
        catch (_ignore) {
            this.ip = ipaddr.parse('0.0.0.0');
        }
    }
    static zero() {
        return new IPAddress('0.0.0.0');
    }
    toString = () => {
        if (!this.ip) {
            return '';
        }
        return this.ip.toString();
    };
    writeToBuffer(buf, pos) {
        if (!this.ip) {
            throw new Error('Invalid IP');
        }
        const bytes = this.ip.toByteArray();
        buf.writeUInt8(bytes[0], pos++);
        buf.writeUInt8(bytes[1], pos++);
        buf.writeUInt8(bytes[2], pos++);
        buf.writeUInt8(bytes[3], pos);
    }
}
exports.IPAddress = IPAddress;
//# sourceMappingURL=IPAddress.js.map