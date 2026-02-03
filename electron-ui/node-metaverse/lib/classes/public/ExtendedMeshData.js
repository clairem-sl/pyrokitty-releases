"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtendedMeshData = void 0;
class ExtendedMeshData {
    flags = 0;
    constructor(buf, pos, length) {
        if (buf !== undefined && pos !== undefined && length !== undefined) {
            if (buf.length - pos >= 4 && length >= 4) {
                this.flags = buf.readUInt32LE(pos);
            }
        }
    }
    writeToBuffer(buf, pos) {
        buf.writeUInt32LE(this.flags, pos);
    }
    getBuffer() {
        const buf = Buffer.allocUnsafe(4);
        this.writeToBuffer(buf, 0);
        return buf;
    }
}
exports.ExtendedMeshData = ExtendedMeshData;
//# sourceMappingURL=ExtendedMeshData.js.map