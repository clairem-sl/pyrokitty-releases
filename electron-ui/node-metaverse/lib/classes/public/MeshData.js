"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeshData = void 0;
const UUID_1 = require("../UUID");
const SculptType_1 = require("../../enums/SculptType");
class MeshData {
    meshData = UUID_1.UUID.zero();
    type = SculptType_1.SculptType.None;
    constructor(buf, pos, length) {
        if (buf !== undefined && pos !== undefined && length !== undefined) {
            if (length >= 17) {
                this.meshData = new UUID_1.UUID(buf, pos);
                pos += 16;
                this.type = buf.readUInt8(pos);
            }
        }
    }
    writeToBuffer(buf, pos) {
        this.meshData.writeToBuffer(buf, pos);
        pos = pos + 16;
        buf.writeUInt8(this.type, pos);
    }
    getBuffer() {
        const buf = Buffer.allocUnsafe(17);
        this.writeToBuffer(buf, 0);
        return buf;
    }
}
exports.MeshData = MeshData;
//# sourceMappingURL=MeshData.js.map