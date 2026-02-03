"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SculptData = void 0;
const UUID_1 = require("../UUID");
const SculptType_1 = require("../../enums/SculptType");
class SculptData {
    texture = UUID_1.UUID.zero();
    type = SculptType_1.SculptType.None;
    constructor(buf, pos, length) {
        if (buf !== undefined && pos !== undefined && length !== undefined) {
            if (length >= 17) {
                this.texture = new UUID_1.UUID(buf, pos);
                pos += 16;
                this.type = buf.readUInt8(pos);
            }
        }
    }
    writeToBuffer(buf, pos) {
        this.texture.writeToBuffer(buf, pos);
        pos = pos + 16;
        buf.writeUInt8(this.type, pos);
    }
    getBuffer() {
        const buf = Buffer.allocUnsafe(17);
        this.writeToBuffer(buf, 0);
        return buf;
    }
}
exports.SculptData = SculptData;
//# sourceMappingURL=SculptData.js.map