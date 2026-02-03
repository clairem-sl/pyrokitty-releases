"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReflectionProbeData = void 0;
class ReflectionProbeData {
    ambiance = 0.0;
    clipDistance = 0.0;
    flags = 0;
    constructor(buf, pos, length) {
        if (buf !== undefined && pos !== undefined && length !== undefined) {
            if (buf.length - pos >= 9 && length >= 9) {
                this.ambiance = buf.readFloatLE(pos);
                pos = pos + 4;
                this.clipDistance = buf.readFloatLE(pos);
                pos = pos + 4;
                this.flags = buf.readUInt8(pos);
            }
        }
    }
    writeToBuffer(buf, pos) {
        buf.writeFloatLE(this.ambiance, pos);
        pos = pos + 4;
        buf.writeFloatLE(this.clipDistance, pos);
        pos = pos + 4;
        buf.writeUInt8(this.flags, pos);
    }
    getBuffer() {
        const buf = Buffer.allocUnsafe(9);
        this.writeToBuffer(buf, 0);
        return buf;
    }
}
exports.ReflectionProbeData = ReflectionProbeData;
//# sourceMappingURL=ReflectionProbeData.js.map