"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RenderMaterialData = void 0;
const RenderMaterialParam_1 = require("./RenderMaterialParam");
const UUID_1 = require("../UUID");
class RenderMaterialData {
    params = [];
    constructor(buf, pos, length) {
        let localPos = 0;
        if (buf !== undefined && pos !== undefined && length !== undefined) {
            if (buf.length - pos >= 1 && length - localPos >= 1) {
                const count = buf.readUInt8(pos++);
                localPos++;
                for (let x = 0; x < count; x++) {
                    if (buf.length - pos >= 17 && length - localPos >= 17) {
                        const param = new RenderMaterialParam_1.RenderMaterialParam();
                        param.textureIndex = buf.readUInt8(pos++);
                        localPos++;
                        param.textureUUID = new UUID_1.UUID(buf, pos);
                        pos = pos + 16;
                        localPos = localPos + 16;
                        this.params.push(param);
                    }
                }
            }
        }
    }
    writeToBuffer(buf, pos) {
        buf.writeUInt8(this.params.length, pos++);
        for (const param of this.params) {
            buf.writeUInt8(param.textureIndex, pos++);
            param.textureUUID.writeToBuffer(buf, pos);
            pos = pos + 16;
        }
    }
    getBuffer() {
        const buf = Buffer.allocUnsafe(1 + (this.params.length * 17));
        this.writeToBuffer(buf, 0);
        return buf;
    }
}
exports.RenderMaterialData = RenderMaterialData;
//# sourceMappingURL=RenderMaterialData.js.map