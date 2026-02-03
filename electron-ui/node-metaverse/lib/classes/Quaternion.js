"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Quaternion = void 0;
class Quaternion {
    x = 0;
    y = 0;
    z = 0;
    w = 1.0;
    constructor(buf, pos, z, w) {
        if (typeof buf === 'number' && typeof pos === 'number' && typeof z === 'number' && typeof w === 'number') {
            this.x = buf;
            this.y = pos;
            this.z = z;
            this.w = w;
        }
        else if (buf instanceof Quaternion) {
            this.x = buf.x;
            this.y = buf.y;
            this.z = buf.z;
            this.w = buf.w;
        }
        else {
            if (buf !== undefined && pos !== undefined && buf instanceof Buffer) {
                this.x = buf.readFloatLE(pos);
                this.y = buf.readFloatLE(pos + 4);
                this.z = buf.readFloatLE(pos + 8);
                const xyzsum = 1.0 - this.x * this.x - this.y * this.y - this.z * this.z;
                this.w = xyzsum > 0.0 ? Math.sqrt(xyzsum) : 0;
            }
            else if (buf !== undefined && Array.isArray(buf) && buf.length > 3) {
                [this.x, this.y, this.z, this.w] = buf;
            }
        }
    }
    static getXML(doc, v) {
        if (v === undefined) {
            v = Quaternion.getIdentity();
        }
        doc.ele('X', v.x);
        doc.ele('Y', v.y);
        doc.ele('Z', v.z);
        doc.ele('W', v.w);
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
            if (value.X !== undefined && value.Y !== undefined && value.Z !== undefined && value.W !== undefined) {
                let x = value.X;
                let y = value.Y;
                let z = value.Z;
                let w = value.W;
                if (Array.isArray(x) && x.length > 0) {
                    x = x[0];
                }
                if (Array.isArray(y) && y.length > 0) {
                    y = y[0];
                }
                if (Array.isArray(z) && z.length > 0) {
                    z = z[0];
                }
                if (Array.isArray(w) && w.length > 0) {
                    w = w[0];
                }
                return new Quaternion([Number(x), Number(y), Number(z), Number(w)]);
            }
            return false;
        }
        return false;
    }
    static fromAxis(axis, angle) {
        const halfAngle = angle / 2;
        const sinHalfAngle = Math.sin(halfAngle);
        const cosHalfAngle = Math.cos(halfAngle);
        const normalizedAxis = axis.copy().normalize();
        const axisLengthSquared = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
        if (axisLengthSquared === 0) {
            return Quaternion.getIdentity();
        }
        return new Quaternion([
            normalizedAxis.x * sinHalfAngle,
            normalizedAxis.y * sinHalfAngle,
            normalizedAxis.z * sinHalfAngle,
            cosHalfAngle,
        ]);
    }
    static getIdentity() {
        return new Quaternion();
    }
    writeToBuffer(buf, pos) {
        const q = this.normalize();
        buf.writeFloatLE(q.x, pos);
        buf.writeFloatLE(q.y, pos + 4);
        buf.writeFloatLE(q.z, pos + 8);
    }
    toString() {
        return '<' + this.x + ', ' + this.y + ', ' + this.z + ', ' + this.w + '>';
    }
    getBuffer() {
        const j = Buffer.allocUnsafe(12);
        this.writeToBuffer(j, 0);
        return j;
    }
    angleBetween(b) {
        const aa = this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
        const bb = b.x * b.x + b.y * b.y + b.z * b.z + b.w * b.w;
        const aa_bb = aa * bb;
        if (aa_bb === 0) {
            return 0.0;
        }
        const ab = this.x * b.x + this.y * b.y + this.z * b.z + this.w * b.w;
        const quotient = (ab * ab) / aa_bb;
        if (quotient >= 1.0) {
            return 0.0;
        }
        return Math.acos(2 * quotient - 1);
    }
    dot(q) {
        return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
    }
    sum(q) {
        return new Quaternion([
            this.x + q.x,
            this.y + q.y,
            this.z + q.z,
            this.w + q.w,
        ]);
    }
    product(q) {
        return new Quaternion([
            this.x * q.x,
            this.y * q.y,
            this.z * q.z,
            this.w * q.w,
        ]);
    }
    cross(q) {
        // Cross product of vector parts; scalar part is zero
        return new Quaternion([
            this.y * q.z - this.z * q.y,
            this.z * q.x - this.x * q.z,
            this.x * q.y - this.y * q.x,
            0,
        ]);
    }
    shortMix(q, t) {
        if (t <= 0.0) {
            return new Quaternion(this);
        }
        else if (t >= 1.0) {
            return new Quaternion(q);
        }
        let cosHalfTheta = this.dot(q);
        if (cosHalfTheta < 0) {
            q = q.negate();
            cosHalfTheta = -cosHalfTheta;
        }
        let k0 = 0;
        let k1 = 0;
        if (cosHalfTheta > 0.9999) {
            // Quaternions are very close; use linear interpolation
            k0 = 1 - t;
            k1 = t;
        }
        else {
            const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
            const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
            const oneOverSinHalfTheta = 1.0 / sinHalfTheta;
            k0 = Math.sin((1 - t) * halfTheta) * oneOverSinHalfTheta;
            k1 = Math.sin(t * halfTheta) * oneOverSinHalfTheta;
        }
        return new Quaternion([
            this.x * k0 + q.x * k1,
            this.y * k0 + q.y * k1,
            this.z * k0 + q.z * k1,
            this.w * k0 + q.w * k1,
        ]).normalize();
    }
    mix(q, t) {
        const cosHalfTheta = this.dot(q);
        if (Math.abs(cosHalfTheta) >= 1.0) {
            // Quaternions are very close; return this quaternion
            return new Quaternion(this);
        }
        const halfTheta = Math.acos(cosHalfTheta);
        const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
        if (Math.abs(sinHalfTheta) < 0.001) {
            // Quaternions are too close; use linear interpolation
            return new Quaternion([
                this.x * (1 - t) + q.x * t,
                this.y * (1 - t) + q.y * t,
                this.z * (1 - t) + q.z * t,
                this.w * (1 - t) + q.w * t,
            ]).normalize();
        }
        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
        return new Quaternion([
            this.x * ratioA + q.x * ratioB,
            this.y * ratioA + q.y * ratioB,
            this.z * ratioA + q.z * ratioB,
            this.w * ratioA + q.w * ratioB,
        ]);
    }
    copy() {
        return new Quaternion(this);
    }
    roll() {
        // Rotation around the x-axis
        return Math.atan2(2 * (this.w * this.x + this.y * this.z), 1 - 2 * (this.x * this.x + this.y * this.y));
    }
    pitch() {
        // Rotation around the y-axis
        const sinp = 2 * (this.w * this.y - this.z * this.x);
        if (Math.abs(sinp) >= 1) {
            return (Math.PI / 2) * Math.sign(sinp); // Use 90 degrees if out of range
        }
        else {
            return Math.asin(sinp);
        }
    }
    yaw() {
        // Rotation around the z-axis
        return Math.atan2(2 * (this.w * this.z + this.x * this.y), 1 - 2 * (this.y * this.y + this.z * this.z));
    }
    equals(q, epsilon = Number.EPSILON) {
        return (Math.abs(this.x - q.x) < epsilon &&
            Math.abs(this.y - q.y) < epsilon &&
            Math.abs(this.z - q.z) < epsilon &&
            Math.abs(this.w - q.w) < epsilon);
    }
    inverse() {
        const lengthSq = this.lengthSquared();
        if (lengthSq === 0) {
            throw new Error('Cannot invert a quaternion with zero length');
        }
        return this.conjugate().scale(1 / lengthSq);
    }
    conjugate() {
        return new Quaternion([-this.x, -this.y, -this.z, this.w]);
    }
    length() {
        return Math.sqrt(this.lengthSquared());
    }
    lengthSquared() {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }
    normalize() {
        const len = this.length();
        if (len === 0) {
            return Quaternion.getIdentity();
        }
        else {
            return new Quaternion([
                this.x / len,
                this.y / len,
                this.z / len,
                this.w / len,
            ]);
        }
    }
    add(q) {
        return new Quaternion([
            this.x + q.x,
            this.y + q.y,
            this.z + q.z,
            this.w + q.w,
        ]);
    }
    multiply(value) {
        if (typeof value === 'number') {
            // Scalar multiplication
            return new Quaternion([
                this.x * value,
                this.y * value,
                this.z * value,
                this.w * value,
            ]);
        }
        else {
            // Quaternion multiplication
            const x1 = this.x, y1 = this.y, z1 = this.z, w1 = this.w;
            const x2 = value.x, y2 = value.y, z2 = value.z, w2 = value.w;
            return new Quaternion([
                w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
                w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
            ]);
        }
    }
    negate() {
        return new Quaternion([-this.x, -this.y, -this.z, -this.w]);
    }
    scale(scalar) {
        return new Quaternion([
            this.x * scalar,
            this.y * scalar,
            this.z * scalar,
            this.w * scalar,
        ]);
    }
    calculateW() {
        const t = 1.0 - (this.x * this.x + this.y * this.y + this.z * this.z);
        const w = t < 0 ? 0 : Math.sqrt(t);
        return new Quaternion([this.x, this.y, this.z, w]);
    }
}
exports.Quaternion = Quaternion;
//# sourceMappingURL=Quaternion.js.map