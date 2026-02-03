"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Color4 = void 0;
const Utils_1 = require("./Utils");
class Color4 {
    red;
    green;
    blue;
    alpha;
    static black = new Color4(0.0, 0.0, 0.0, 1.0);
    static white = new Color4(1.0, 1.0, 1.0, 1.0);
    // eslint-disable-next-line @typescript-eslint/parameter-properties
    constructor(red, green = 0, blue = 0, alpha = 0) {
        this.red = red;
        this.green = green;
        this.blue = blue;
        this.alpha = alpha;
        if (red instanceof Buffer && typeof blue === 'boolean') {
            const buf = red;
            const pos = green;
            const inverted = blue;
            let alphaInverted = false;
            if (typeof alpha === 'boolean' && alpha) {
                alphaInverted = true;
            }
            this.red = 0.0;
            this.green = 0.0;
            this.blue = 0.0;
            this.alpha = 0.0;
            const quanta = 1.0 / 255.0;
            if (inverted) {
                this.red = (255 - buf[pos]) * quanta;
                this.green = (255 - buf[pos + 1]) * quanta;
                this.blue = (255 - buf[pos + 2]) * quanta;
                this.alpha = (255 - buf[pos + 3]) * quanta;
            }
            else {
                this.red = buf[pos] * quanta;
                this.green = buf[pos + 1] * quanta;
                this.blue = buf[pos + 2] * quanta;
                this.alpha = buf[pos + 3] * quanta;
            }
            if (alphaInverted) {
                this.alpha = 1.0 - this.alpha;
            }
        }
        if (Array.isArray(red)) {
            this.green = red[1];
            this.blue = red[2];
            this.alpha = red[3];
            this.red = red[0];
        }
    }
    static getXML(doc, c) {
        if (c === undefined) {
            c = Color4.white;
        }
        doc.ele('R', c.red);
        doc.ele('G', c.green);
        doc.ele('B', c.blue);
        doc.ele('A', c.alpha);
    }
    static fromXMLJS(obj, param) {
        if (!obj[param]) {
            return false;
        }
        let value = obj[param];
        if (Array.isArray(value) && value.length > 0) {
            value = value[0];
        }
        if (typeof value === 'object') {
            if (value.R !== undefined && value.G !== undefined && value.B !== undefined && value.A !== undefined) {
                let red = value.R;
                let green = value.G;
                let blue = value.B;
                let alpha = value.A;
                if (Array.isArray(red) && red.length > 0) {
                    red = red[0];
                }
                if (Array.isArray(green) && green.length > 0) {
                    green = green[0];
                }
                if (Array.isArray(blue) && blue.length > 0) {
                    blue = blue[0];
                }
                if (Array.isArray(alpha) && alpha.length > 0) {
                    alpha = alpha[0];
                }
                return new Color4(Number(red), Number(green), Number(blue), Number(alpha));
            }
            return false;
        }
        return false;
    }
    getRed() {
        if (typeof this.red === 'number') {
            return this.red;
        }
        return 0;
    }
    getGreen() {
        if (typeof this.green === 'number') {
            return this.green;
        }
        return 0;
    }
    getBlue() {
        if (typeof this.blue === 'number') {
            return this.blue;
        }
        return 0;
    }
    getAlpha() {
        if (typeof this.alpha === 'number') {
            return this.alpha;
        }
        return 0;
    }
    writeToBuffer(buf, pos, inverted = false) {
        buf.writeUInt8(Utils_1.Utils.FloatToByte(this.getRed(), 0, 1.0), pos);
        buf.writeUInt8(Utils_1.Utils.FloatToByte(this.getGreen(), 0, 1.0), pos + 1);
        buf.writeUInt8(Utils_1.Utils.FloatToByte(this.getBlue(), 0, 1.0), pos + 2);
        buf.writeUInt8(Utils_1.Utils.FloatToByte(this.getAlpha(), 0, 1.0), pos + 3);
        if (inverted) {
            buf[pos] = (255 - buf[pos]);
            buf[pos + 1] = (255 - buf[pos + 1]);
            buf[pos + 2] = (255 - buf[pos + 2]);
            buf[pos + 3] = (255 - buf[pos + 3]);
        }
    }
    getBuffer(inverted = false) {
        const buf = Buffer.allocUnsafe(4);
        this.writeToBuffer(buf, 0, inverted);
        return buf;
    }
    equals(other) {
        return (this.red === other.red && this.green === other.green && this.blue === other.blue && this.alpha === other.alpha);
    }
}
exports.Color4 = Color4;
//# sourceMappingURL=Color4.js.map