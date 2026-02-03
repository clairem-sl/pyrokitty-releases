"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vector3 = void 0;
const Quaternion_1 = require("./Quaternion");
class Vector3 {
    static zero = new Vector3(0, 0, 0);
    static up = new Vector3(0, 1, 0);
    static right = new Vector3(1, 0, 0);
    static forward = new Vector3(0, 0, 1);
    x;
    y;
    z;
    constructor(buf, pos, doubleOrX) {
        if (typeof buf === 'number' && typeof pos === 'number' && typeof doubleOrX === 'number') {
            this.x = buf;
            this.y = pos;
            this.z = doubleOrX;
        }
        else if (buf instanceof Vector3) {
            this.x = buf.x;
            this.y = buf.y;
            this.z = buf.z;
        }
        else {
            if (doubleOrX === undefined) {
                doubleOrX = false;
            }
            if (buf instanceof Buffer) {
                if (pos === undefined) {
                    pos = 0;
                }
                if (doubleOrX === false) {
                    this.x = buf.readFloatLE(pos);
                    this.y = buf.readFloatLE(pos + 4);
                    this.z = buf.readFloatLE(pos + 8);
                }
                else {
                    this.x = buf.readDoubleLE(pos);
                    this.y = buf.readDoubleLE(pos + 8);
                    this.z = buf.readDoubleLE(pos + 16);
                }
            }
            else if (buf !== undefined && Array.isArray(buf) && buf.length > 2) {
                if (typeof buf[0] !== 'number' || typeof buf[1] !== 'number' || typeof buf[2] !== 'number') {
                    throw new Error('Array contains non-numbers');
                }
                [this.x, this.y, this.z] = buf;
            }
            else {
                this.x = 0.0;
                this.y = 0.0;
                this.z = 0.0;
            }
        }
        if (isNaN(this.x)) {
            throw new Error('X component is NaN');
        }
        if (isNaN(this.y)) {
            throw new Error('Y component is NaN');
        }
        if (isNaN(this.z)) {
            throw new Error('Z component is NaN');
        }
    }
    static getXML(doc, v) {
        if (v === undefined) {
            v = Vector3.getZero();
        }
        doc.ele('X', v.x);
        doc.ele('Y', v.y);
        doc.ele('Z', v.z);
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
            if (value.X !== undefined && value.Y !== undefined && value.Z !== undefined) {
                let x = value.X;
                let y = value.Y;
                let z = value.Z;
                if (Array.isArray(x) && x.length > 0) {
                    x = x[0];
                }
                if (Array.isArray(y) && y.length > 0) {
                    y = y[0];
                }
                if (Array.isArray(z) && z.length > 0) {
                    z = z[0];
                }
                return new Vector3([Number(x), Number(y), Number(z)]);
            }
            return false;
        }
        return false;
    }
    static getZero() {
        return new Vector3();
    }
    writeToBuffer(buf, pos, double = false) {
        if (double) {
            buf.writeDoubleLE(this.x, pos);
            buf.writeDoubleLE(this.y, pos + 8);
            buf.writeDoubleLE(this.z, pos + 16);
        }
        else {
            buf.writeFloatLE(this.x, pos);
            buf.writeFloatLE(this.y, pos + 4);
            buf.writeFloatLE(this.z, pos + 8);
        }
    }
    toString() {
        return '<' + this.x + ', ' + this.y + ', ' + this.z + '>';
    }
    getBuffer(double = false) {
        const buf = Buffer.allocUnsafe(double ? 24 : 12);
        this.writeToBuffer(buf, 0, double);
        return buf;
    }
    compareApprox(vec) {
        return vec.equals(this, 0.00001);
    }
    toArray() {
        return [this.x, this.y, this.z];
    }
    equals(vec, epsilon = Number.EPSILON) {
        return (Math.abs(this.x - vec.x) < epsilon &&
            Math.abs(this.y - vec.y) < epsilon &&
            Math.abs(this.z - vec.z) < epsilon);
    }
    cross(vec) {
        return new Vector3([
            this.y * vec.z - this.z * vec.y,
            this.z * vec.x - this.x * vec.z,
            this.x * vec.y - this.y * vec.x,
        ]);
    }
    dot(vec) {
        return this.x * vec.x + this.y * vec.y + this.z * vec.z;
    }
    distance(vec) {
        return Math.sqrt(this.squaredDistance(vec));
    }
    squaredDistance(vec) {
        const dx = this.x - vec.x;
        const dy = this.y - vec.y;
        const dz = this.z - vec.z;
        return dx * dx + dy * dy + dz * dz;
    }
    direction(vec) {
        const diff = vec.difference(this).normalize();
        if (diff.x == 0.0 && diff.y == 0.0 && diff.z == 0.0) {
            diff.x = NaN;
            diff.y = NaN;
            diff.z = NaN;
        }
        return diff;
    }
    toJSON() {
        return {
            values: {
                '0': this.x,
                '1': this.y,
                '2': this.z
            }
        };
    }
    mix(vec, t) {
        return new Vector3([
            this.x + t * (vec.x - this.x),
            this.y + t * (vec.y - this.y),
            this.z + t * (vec.z - this.z),
        ]);
    }
    sum(vec) {
        return new Vector3([
            this.x + vec.x,
            this.y + vec.y,
            this.z + vec.z,
        ]);
    }
    difference(vec) {
        return new Vector3([
            this.x - vec.x,
            this.y - vec.y,
            this.z - vec.z,
        ]);
    }
    product(vec) {
        return new Vector3([
            this.x * vec.x,
            this.y * vec.y,
            this.z * vec.z,
        ]);
    }
    quotient(vec) {
        return new Vector3([
            this.x / vec.x,
            this.y / vec.y,
            this.z / vec.z,
        ]);
    }
    reset() {
        this.x = 0;
        this.y = 0;
        this.z = 0;
    }
    copy() {
        return new Vector3(this);
    }
    negate() {
        return new Vector3([
            -this.x,
            -this.y,
            -this.z,
        ]);
    }
    length() {
        return Math.sqrt(this.squaredLength());
    }
    squaredLength() {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }
    add(vec) {
        return new Vector3([
            this.x + vec.x,
            this.y + vec.y,
            this.z + vec.z,
        ]);
    }
    subtract(vec) {
        return new Vector3([
            this.x - vec.x,
            this.y - vec.y,
            this.z - vec.z,
        ]);
    }
    multiply(value) {
        if (typeof value === 'number') {
            return new Vector3([
                this.x * value,
                this.y * value,
                this.z * value,
            ]);
        }
        else {
            return new Vector3([
                this.x * value.x,
                this.y * value.y,
                this.z * value.z,
            ]);
        }
    }
    divide(value) {
        if (typeof value === 'number') {
            return new Vector3([
                this.x / value,
                this.y / value,
                this.z / value,
            ]);
        }
        else {
            return new Vector3([
                this.x / value.x,
                this.y / value.y,
                this.z / value.z,
            ]);
        }
    }
    scale(scalar) {
        return this.multiply(scalar);
    }
    normalize() {
        const len = this.length();
        if (len > 0) {
            return this.scale(1 / len);
        }
        else {
            return this.copy();
        }
    }
    multiplyQuaternion(quat) {
        const qVec = new Quaternion_1.Quaternion([this.x, this.y, this.z, 0]);
        const result = quat.multiply(qVec).multiply(quat.conjugate());
        return new Vector3([result.x, result.y, result.z]);
    }
    toQuaternion() {
        return new Quaternion_1.Quaternion([this.x, this.y, this.z, 0]);
    }
}
exports.Vector3 = Vector3;
//# sourceMappingURL=Vector3.js.map