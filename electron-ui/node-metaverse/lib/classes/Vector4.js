"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vector4 = void 0;
const Quaternion_1 = require("./Quaternion");
class Vector4 {
    x;
    y;
    z;
    w;
    constructor(buf, pos, double, w) {
        if (typeof buf === 'number' && typeof pos === 'number' && typeof double === 'number' && typeof w === 'number') {
            this.x = buf;
            this.y = pos;
            this.z = double;
            this.w = w;
        }
        else if (buf instanceof Vector4) {
            this.x = buf.x;
            this.y = buf.y;
            this.z = buf.z;
            this.w = buf.w;
        }
        else {
            if (double === undefined) {
                double = false;
            }
            if (buf instanceof Buffer) {
                if (pos === undefined) {
                    pos = 0;
                }
                if (double === true) {
                    this.x = buf.readDoubleLE(pos);
                    this.y = buf.readDoubleLE(pos + 8);
                    this.z = buf.readDoubleLE(pos + 16);
                    this.w = buf.readDoubleLE(pos + 24);
                }
                else {
                    this.x = buf.readFloatLE(pos);
                    this.y = buf.readFloatLE(pos + 4);
                    this.z = buf.readFloatLE(pos + 8);
                    this.w = buf.readFloatLE(pos + 12);
                }
            }
            else if (buf !== undefined && Array.isArray(buf) && buf.length > 3) {
                if (typeof buf[0] !== 'number' || typeof buf[1] !== 'number' || typeof buf[2] !== 'number' || typeof buf[3] !== 'number') {
                    throw new Error('Array contains non-numbers');
                }
                [this.x, this.y, this.z, this.w] = buf;
            }
            else {
                this.x = 0;
                this.y = 0;
                this.z = 0;
                this.w = 0;
            }
        }
    }
    static getXML(doc, v) {
        if (v === undefined) {
            v = Vector4.getZero();
        }
        doc.ele('X', v.x);
        doc.ele('Y', v.y);
        doc.ele('Z', v.z);
        doc.ele('W', v.w);
    }
    static getZero() {
        return new Vector4();
    }
    writeToBuffer(buf, pos, double = false) {
        if (double) {
            buf.writeDoubleLE(this.x, pos);
            buf.writeDoubleLE(this.y, pos + 8);
            buf.writeDoubleLE(this.z, pos + 16);
            buf.writeDoubleLE(this.w, pos + 24);
        }
        else {
            buf.writeFloatLE(this.x, pos);
            buf.writeFloatLE(this.y, pos + 4);
            buf.writeFloatLE(this.z, pos + 8);
            buf.writeFloatLE(this.w, pos + 12);
        }
    }
    toString() {
        return `<${this.x}, ${this.y}, ${this.z}, ${this.w}>`;
    }
    getBuffer(double = false) {
        const buf = Buffer.allocUnsafe(double ? 32 : 16);
        this.writeToBuffer(buf, 0, double);
        return buf;
    }
    compareApprox(vec) {
        return this.equals(vec, 0.00001);
    }
    toArray() {
        return [this.x, this.y, this.z, this.w];
    }
    equals(vec, epsilon = Number.EPSILON) {
        return (Math.abs(this.x - vec.x) < epsilon &&
            Math.abs(this.y - vec.y) < epsilon &&
            Math.abs(this.z - vec.z) < epsilon &&
            Math.abs(this.w - vec.w) < epsilon);
    }
    dot(vec) {
        return this.x * vec.x + this.y * vec.y + this.z * vec.z + this.w * vec.w;
    }
    distance(vec) {
        return Math.sqrt(this.squaredDistance(vec));
    }
    squaredDistance(vec) {
        const dx = this.x - vec.x;
        const dy = this.y - vec.y;
        const dz = this.z - vec.z;
        const dw = this.w - vec.w;
        return dx * dx + dy * dy + dz * dz + dw * dw;
    }
    direction(vec) {
        return vec.difference(this).normalize();
    }
    mix(vec, t) {
        return new Vector4([
            this.x + t * (vec.x - this.x),
            this.y + t * (vec.y - this.y),
            this.z + t * (vec.z - this.z),
            this.w + t * (vec.w - this.w),
        ]);
    }
    sum(vec) {
        return new Vector4([
            this.x + vec.x,
            this.y + vec.y,
            this.z + vec.z,
            this.w + vec.w,
        ]);
    }
    difference(vec) {
        return new Vector4([
            this.x - vec.x,
            this.y - vec.y,
            this.z - vec.z,
            this.w - vec.w,
        ]);
    }
    product(vec) {
        return new Vector4([
            this.x * vec.x,
            this.y * vec.y,
            this.z * vec.z,
            this.w * vec.w,
        ]);
    }
    quotient(vec) {
        return new Vector4([
            this.x / vec.x,
            this.y / vec.y,
            this.z / vec.z,
            this.w / vec.w,
        ]);
    }
    reset() {
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.w = 0;
    }
    copy() {
        return new Vector4(this);
    }
    toJSON() {
        return {
            values: {
                '0': this.x,
                '1': this.y,
                '2': this.z,
                '3': this.w
            }
        };
    }
    negate() {
        return new Vector4([
            -this.x,
            -this.y,
            -this.z,
            -this.w,
        ]);
    }
    length() {
        return Math.sqrt(this.squaredLength());
    }
    squaredLength() {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }
    add(vec) {
        this.x += vec.x;
        this.y += vec.y;
        this.z += vec.z;
        this.w += vec.w;
        return this;
    }
    subtract(vec) {
        this.x -= vec.x;
        this.y -= vec.y;
        this.z -= vec.z;
        this.w -= vec.w;
        return this;
    }
    multiply(value) {
        if (typeof value === 'number') {
            this.x *= value;
            this.y *= value;
            this.z *= value;
            this.w *= value;
        }
        else {
            this.x *= value.x;
            this.y *= value.y;
            this.z *= value.z;
            this.w *= value.w;
        }
        return this;
    }
    divide(value) {
        if (typeof value === 'number') {
            this.x /= value;
            this.y /= value;
            this.z /= value;
            this.w /= value;
        }
        else {
            this.x /= value.x;
            this.y /= value.y;
            this.z /= value.z;
            this.w /= value.w;
        }
        return this;
    }
    scale(scalar) {
        return this.multiply(scalar);
    }
    normalize() {
        const len = this.length();
        if (len > 0) {
            this.scale(1 / len);
        }
        return this;
    }
    toQuaternion() {
        return new Quaternion_1.Quaternion(this.x, this.y, this.z, this.w);
    }
}
exports.Vector4 = Vector4;
//# sourceMappingURL=Vector4.js.map