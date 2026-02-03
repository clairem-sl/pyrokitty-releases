"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextureAnim = void 0;
const TextureAnimFlags_1 = require("../../enums/TextureAnimFlags");
const Vector2_1 = require("../Vector2");
class TextureAnim {
    textureAnimFlags = 0;
    textureAnimFace = 0;
    textureAnimSize = Vector2_1.Vector2.getZero();
    textureAnimStart = 0;
    textureAnimLength = 0;
    textureAnimRate = 0;
    static from(buf) {
        const obj = new TextureAnim();
        let animPos = 0;
        if (buf.length >= 16) {
            obj.textureAnimFlags = buf.readUInt8(animPos++);
            obj.textureAnimFace = buf.readUInt8(animPos++);
            obj.textureAnimSize = new Vector2_1.Vector2([
                buf.readUInt8(animPos++),
                buf.readUInt8(animPos++)
            ]);
            obj.textureAnimStart = buf.readFloatLE(animPos);
            animPos = animPos + 4;
            obj.textureAnimLength = buf.readFloatLE(animPos);
            animPos = animPos + 4;
            obj.textureAnimRate = buf.readFloatLE(animPos);
        }
        return obj;
    }
    toBuffer() {
        if (this.textureAnimFlags === TextureAnimFlags_1.TextureAnimFlags.ANIM_OFF && this.textureAnimFace === 0 && this.textureAnimStart === 0 && this.textureAnimLength === 0 && this.textureAnimRate === 0) {
            return Buffer.allocUnsafe(0);
        }
        const buf = Buffer.allocUnsafe(16);
        let animPos = 0;
        buf.writeUInt8(this.textureAnimFlags, animPos++);
        buf.writeUInt8(this.textureAnimFace, animPos++);
        buf.writeUInt8(this.textureAnimSize.x, animPos++);
        buf.writeUInt8(this.textureAnimSize.y, animPos++);
        buf.writeFloatLE(this.textureAnimStart, animPos);
        animPos = animPos + 4;
        buf.writeFloatLE(this.textureAnimLength, animPos);
        animPos = animPos + 4;
        buf.writeFloatLE(this.textureAnimRate, animPos);
        return buf;
    }
    toBase64() {
        const bin = this.toBuffer();
        return bin.toString('base64');
    }
}
exports.TextureAnim = TextureAnim;
//# sourceMappingURL=TextureAnim.js.map