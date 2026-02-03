"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LightImageData = void 0;
const UUID_1 = require("../UUID");
const Vector3_1 = require("../Vector3");
class LightImageData {
    texture = UUID_1.UUID.zero();
    params = Vector3_1.Vector3.getZero();
    constructor(buf, pos, length) {
        if (length >= 28) {
            this.texture = new UUID_1.UUID(buf, pos);
            pos += 16;
            this.params = new Vector3_1.Vector3(buf, pos);
        }
    }
    writeToBuffer(buf, pos) {
        this.texture.writeToBuffer(buf, pos);
        pos = pos + 16;
        this.params.writeToBuffer(buf, pos, false);
    }
    getBuffer() {
        const buf = Buffer.allocUnsafe(28);
        this.writeToBuffer(buf, 0);
        return buf;
    }
}
exports.LightImageData = LightImageData;
//# sourceMappingURL=LightImageData.js.map