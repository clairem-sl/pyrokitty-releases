"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vector2 = void 0;
class Vector2 {
    x;
    y;
    constructor(buf, pos, double) {
        if (typeof buf === 'number' && typeof pos === 'number') {
            this.x = buf;
            this.y = pos;
        }
        else if (buf instanceof Vector2) {
            this.x = buf.x;
            this.y = buf.y;
        }
        else {
            if (double === undefined) {
                double = false;
            }
            if (buf !== undefined && pos !== undefined && buf instanceof Buffer) {
                if (double === false) {
                    this.x = buf.readFloatLE(pos);
                    this.y = buf.readFloatLE(pos + 4);
                }
                else {
                    this.x = buf.readDoubleLE(pos);
                    this.y = buf.readDoubleLE(pos + 8);
                }
            }
            else if (buf !== undefined && Array.isArray(buf) && buf.length >= 2) {
                if (typeof buf[0] !== 'number' || typeof buf[1] !== 'number') {
                    throw new Error('Array contains non-numbers');
                }
                [this.x, this.y] = buf;
            }
            else {
                this.x = 0;
                this.y = 0;
            }
        }
    }
    static getXML(doc, v) {
        if (v === undefined) {
            v = Vector2.getZero();
        }
        doc.ele('X', v.x);
        doc.ele('Y', v.y);
    }
    static getZero() {
        return new Vector2(0, 0);
    }
    writeToBuffer(buf, pos, double = false) {
        if (double) {
            buf.writeDoubleLE(this.x, pos);
            buf.writeDoubleLE(this.y, pos + 8);
        }
        else {
            buf.writeFloatLE(this.x, pos);
            buf.writeFloatLE(this.y, pos + 4);
        }
    }
    toString() {
        return `<${this.x}, ${this.y}>`;
    }
    getBuffer(double = false) {
        const buf = Buffer.allocUnsafe(double ? 16 : 8);
        this.writeToBuffer(buf, 0, double);
        return buf;
    }
    compareApprox(vec) {
        return this.equals(vec, 0.00001);
    }
    toArray() {
        return [this.x, this.y];
    }
    equals(vec, epsilon = Number.EPSILON) {
        return (Math.abs(this.x - vec.x) < epsilon &&
            Math.abs(this.y - vec.y) < epsilon);
    }
    dot(vec) {
        return this.x * vec.x + this.y * vec.y;
    }
    cross(vec) {
        // In 2D, the cross product is a scalar representing the magnitude of the perpendicular vector
        return this.x * vec.y - this.y * vec.x;
    }
    distance(vec) {
        return Math.sqrt(this.squaredDistance(vec));
    }
    squaredDistance(vec) {
        const dx = this.x - vec.x;
        const dy = this.y - vec.y;
        return dx * dx + dy * dy;
    }
    direction(vec) {
        const diff = vec.subtract(this).normalize();
        if (diff.x === 0.0 && diff.y === 0.0) {
            diff.x = NaN;
            diff.y = NaN;
        }
        return diff;
    }
    mix(vec, t) {
        return new Vector2([
            this.x + t * (vec.x - this.x),
            this.y + t * (vec.y - this.y),
        ]);
    }
    sum(vec) {
        return new Vector2([
            this.x + vec.x,
            this.y + vec.y,
        ]);
    }
    difference(vec) {
        return new Vector2([
            this.x - vec.x,
            this.y - vec.y,
        ]);
    }
    product(vec) {
        return new Vector2([
            this.x * vec.x,
            this.y * vec.y,
        ]);
    }
    quotient(vec) {
        return new Vector2([
            this.x / vec.x,
            this.y / vec.y,
        ]);
    }
    reset() {
        this.x = 0;
        this.y = 0;
    }
    copy() {
        return new Vector2(this);
    }
    negate() {
        return new Vector2([
            -this.x,
            -this.y,
        ]);
    }
    length() {
        return Math.sqrt(this.squaredLength());
    }
    squaredLength() {
        return this.x * this.x + this.y * this.y;
    }
    add(vec) {
        return new Vector2([
            this.x + vec.x,
            this.y + vec.y,
        ]);
    }
    subtract(vec) {
        return new Vector2([
            this.x - vec.x,
            this.y - vec.y,
        ]);
    }
    multiply(value) {
        if (typeof value === 'number') {
            return new Vector2([
                this.x * value,
                this.y * value,
            ]);
        }
        else {
            return new Vector2([
                this.x * value.x,
                this.y * value.y,
            ]);
        }
    }
    divide(value) {
        if (typeof value === 'number') {
            return new Vector2([
                this.x / value,
                this.y / value,
            ]);
        }
        else {
            return new Vector2([
                this.x / value.x,
                this.y / value.y,
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
    angle() {
        // Returns the angle in radians between this vector and the positive x-axis
        return Math.atan2(this.y, this.x);
    }
    rotate(angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return new Vector2([
            this.x * cos - this.y * sin,
            this.x * sin + this.y * cos,
        ]);
    }
    perpendicular() {
        // Returns a vector perpendicular to this vector (rotated 90 degrees counter-clockwise)
        return new Vector2([-this.y, this.x]);
    }
    projectOnto(vec) {
        const scalar = this.dot(vec) / vec.squaredLength();
        return vec.scale(scalar);
    }
}
exports.Vector2 = Vector2;
//# sourceMappingURL=Vector2.js.map