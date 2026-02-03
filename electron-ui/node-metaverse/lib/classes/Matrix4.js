"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Matrix4 = void 0;
const Vector4_1 = require("./Vector4");
const EPSILON = 1e-6;
const Vector3_1 = require("./Vector3");
const Matrix3_1 = require("./Matrix3");
class Matrix4 {
    static identity = new Matrix4().setIdentity();
    values;
    constructor(values = null) {
        this.values = new Float32Array(16);
        if (values) {
            this.init(values);
        }
        else {
            this.setIdentity();
        }
    }
    static frustum(left, right, bottom, top, near, far) {
        const rl = right - left;
        const tb = top - bottom;
        const fn = far - near;
        return new Matrix4([
            (near * 2) / rl, 0, 0, 0,
            0, (near * 2) / tb, 0, 0,
            (right + left) / rl, (top + bottom) / tb, -(far + near) / fn, -1,
            0, 0, -(far * near * 2) / fn, 0
        ]);
    }
    static perspective(fov, aspect, near, far) {
        const top = near * Math.tan((fov * Math.PI) / 360.0);
        const right = top * aspect;
        return Matrix4.frustum(-right, right, -top, top, near, far);
    }
    static orthographic(left, right, bottom, top, near, far) {
        const rl = right - left;
        const tb = top - bottom;
        const fn = far - near;
        return new Matrix4([
            2 / rl, 0, 0, 0,
            0, 2 / tb, 0, 0,
            0, 0, -2 / fn, 0,
            -(left + right) / rl, -(top + bottom) / tb, -(far + near) / fn, 1
        ]);
    }
    static lookAt(position, target, up = Vector3_1.Vector3.up) {
        if (position.equals(target)) {
            return this.identity.copy();
        }
        const z = position.difference(target).normalize();
        const x = up.cross(z).normalize();
        const y = z.cross(x).normalize();
        return new Matrix4([
            x.x, y.x, z.x, 0,
            x.y, y.y, z.y, 0,
            x.z, y.z, z.z, 0,
            -x.dot(position), -y.dot(position), -z.dot(position), 1
        ]);
    }
    static product(m1, m2, result = null) {
        const a = m1.values;
        const b = m2.values;
        const productValues = [
            b[0] * a[0] + b[1] * a[4] + b[2] * a[8] + b[3] * a[12],
            b[0] * a[1] + b[1] * a[5] + b[2] * a[9] + b[3] * a[13],
            b[0] * a[2] + b[1] * a[6] + b[2] * a[10] + b[3] * a[14],
            b[0] * a[3] + b[1] * a[7] + b[2] * a[11] + b[3] * a[15],
            b[4] * a[0] + b[5] * a[4] + b[6] * a[8] + b[7] * a[12],
            b[4] * a[1] + b[5] * a[5] + b[6] * a[9] + b[7] * a[13],
            b[4] * a[2] + b[5] * a[6] + b[6] * a[10] + b[7] * a[14],
            b[4] * a[3] + b[5] * a[7] + b[6] * a[11] + b[7] * a[15],
            b[8] * a[0] + b[9] * a[4] + b[10] * a[8] + b[11] * a[12],
            b[8] * a[1] + b[9] * a[5] + b[10] * a[9] + b[11] * a[13],
            b[8] * a[2] + b[9] * a[6] + b[10] * a[10] + b[11] * a[14],
            b[8] * a[3] + b[9] * a[7] + b[10] * a[11] + b[11] * a[15],
            b[12] * a[0] + b[13] * a[4] + b[14] * a[8] + b[15] * a[12],
            b[12] * a[1] + b[13] * a[5] + b[14] * a[9] + b[15] * a[13],
            b[12] * a[2] + b[13] * a[6] + b[14] * a[10] + b[15] * a[14],
            b[12] * a[3] + b[13] * a[7] + b[14] * a[11] + b[15] * a[15],
        ];
        if (result) {
            result.init(productValues);
            return result;
        }
        else {
            return new Matrix4(productValues);
        }
    }
    at(index) {
        return this.values[index];
    }
    init(values) {
        if (values.length !== 16) {
            throw new Error('Initialization array must have exactly 16 elements.');
        }
        for (const val of values) {
            if (typeof val !== 'number') {
                throw new Error('Array contains non-numbers');
            }
        }
        let i = 0;
        for (const value of values) {
            this.values[i++] = Number(value);
        }
        return this;
    }
    reset() {
        for (let i = 0; i < this.values.length; i++) {
            this.values[i] = 0;
        }
    }
    copy(dest = null) {
        const destination = dest ?? new Matrix4();
        for (let i = 0; i < this.values.length; i++) {
            destination.values[i] = this.values[i];
        }
        return destination;
    }
    all() {
        const data = [];
        for (const value of this.values) {
            data.push(value);
        }
        return data;
    }
    row(index) {
        if (index < 0 || index > 3) {
            throw new RangeError('Row index must be between 0 and 3.');
        }
        return [
            this.values[index * 4],
            this.values[index * 4 + 1],
            this.values[index * 4 + 2],
            this.values[index * 4 + 3]
        ];
    }
    col(index) {
        if (index < 0 || index > 3) {
            throw new RangeError('Column index must be between 0 and 3.');
        }
        return [
            this.values[index],
            this.values[index + 4],
            this.values[index + 8],
            this.values[index + 12]
        ];
    }
    equals(matrix, threshold = EPSILON) {
        for (let i = 0; i < this.values.length; i++) {
            if (Math.abs(this.values[i] - matrix.at(i)) > threshold) {
                return false;
            }
        }
        return true;
    }
    determinant() {
        const m = this.values;
        const det00 = m[0] * m[5] - m[1] * m[4];
        const det01 = m[0] * m[6] - m[2] * m[4];
        const det02 = m[0] * m[7] - m[3] * m[4];
        const det03 = m[1] * m[6] - m[2] * m[5];
        const det04 = m[1] * m[7] - m[3] * m[5];
        const det05 = m[2] * m[7] - m[3] * m[6];
        const det06 = m[4] * m[9] - m[5] * m[8];
        const det07 = m[4] * m[10] - m[6] * m[8];
        const det08 = m[4] * m[11] - m[7] * m[8];
        const det09 = m[5] * m[10] - m[6] * m[9];
        const det10 = m[5] * m[11] - m[7] * m[9];
        const det11 = m[6] * m[11] - m[7] * m[10];
        return (det00 * det11
            - det01 * det10
            + det02 * det09
            + det03 * det08
            - det04 * det07
            + det05 * det06);
    }
    setIdentity() {
        this.reset();
        this.values[0] = 1;
        this.values[5] = 1;
        this.values[10] = 1;
        this.values[15] = 1;
        return this;
    }
    transpose() {
        const m = this.values;
        const transposed = new Float32Array(16);
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                transposed[col * 4 + row] = m[row * 4 + col];
            }
        }
        return new Matrix4(Array.from(transposed));
    }
    inverse() {
        const m = this.values;
        const inv = new Array(16);
        inv[0] = m[5] * m[10] * m[15] -
            m[5] * m[11] * m[14] -
            m[9] * m[6] * m[15] +
            m[9] * m[7] * m[14] +
            m[13] * m[6] * m[11] -
            m[13] * m[7] * m[10];
        inv[4] = -m[4] * m[10] * m[15] +
            m[4] * m[11] * m[14] +
            m[8] * m[6] * m[15] -
            m[8] * m[7] * m[14] -
            m[12] * m[6] * m[11] +
            m[12] * m[7] * m[10];
        inv[8] = m[4] * m[9] * m[15] -
            m[4] * m[11] * m[13] -
            m[8] * m[5] * m[15] +
            m[8] * m[7] * m[13] +
            m[12] * m[5] * m[11] -
            m[12] * m[7] * m[9];
        inv[12] = -m[4] * m[9] * m[14] +
            m[4] * m[10] * m[13] +
            m[8] * m[5] * m[14] -
            m[8] * m[6] * m[13] -
            m[12] * m[5] * m[10] +
            m[12] * m[6] * m[9];
        inv[1] = -m[1] * m[10] * m[15] +
            m[1] * m[11] * m[14] +
            m[9] * m[2] * m[15] -
            m[9] * m[3] * m[14] -
            m[13] * m[2] * m[11] +
            m[13] * m[3] * m[10];
        inv[5] = m[0] * m[10] * m[15] -
            m[0] * m[11] * m[14] -
            m[8] * m[2] * m[15] +
            m[8] * m[3] * m[14] +
            m[12] * m[2] * m[11] -
            m[12] * m[3] * m[10];
        inv[9] = -m[0] * m[9] * m[15] +
            m[0] * m[11] * m[13] +
            m[8] * m[1] * m[15] -
            m[8] * m[3] * m[13] -
            m[12] * m[1] * m[11] +
            m[12] * m[3] * m[9];
        inv[13] = m[0] * m[9] * m[14] -
            m[0] * m[10] * m[13] -
            m[8] * m[1] * m[14] +
            m[8] * m[2] * m[13] +
            m[12] * m[1] * m[10] -
            m[12] * m[2] * m[9];
        inv[2] = m[1] * m[6] * m[15] -
            m[1] * m[7] * m[14] -
            m[5] * m[2] * m[15] +
            m[5] * m[3] * m[14] +
            m[13] * m[2] * m[7] -
            m[13] * m[3] * m[6];
        inv[6] = -m[0] * m[6] * m[15] +
            m[0] * m[7] * m[14] +
            m[4] * m[2] * m[15] -
            m[4] * m[3] * m[14] -
            m[12] * m[2] * m[7] +
            m[12] * m[3] * m[6];
        inv[10] = m[0] * m[5] * m[15] -
            m[0] * m[7] * m[13] -
            m[4] * m[1] * m[15] +
            m[4] * m[3] * m[13] +
            m[12] * m[1] * m[7] -
            m[12] * m[3] * m[5];
        inv[14] = -m[0] * m[5] * m[14] +
            m[0] * m[6] * m[13] +
            m[4] * m[1] * m[14] -
            m[4] * m[2] * m[13] -
            m[12] * m[1] * m[6] +
            m[12] * m[2] * m[5];
        inv[3] = -m[1] * m[6] * m[11] +
            m[1] * m[7] * m[10] +
            m[5] * m[2] * m[11] -
            m[5] * m[3] * m[10] -
            m[9] * m[2] * m[7] +
            m[9] * m[3] * m[6];
        inv[7] = m[0] * m[6] * m[11] -
            m[0] * m[7] * m[10] -
            m[4] * m[2] * m[11] +
            m[4] * m[3] * m[10] +
            m[8] * m[2] * m[7] -
            m[8] * m[3] * m[6];
        inv[11] = -m[0] * m[5] * m[11] +
            m[0] * m[7] * m[9] +
            m[4] * m[1] * m[11] -
            m[4] * m[3] * m[9] -
            m[8] * m[1] * m[7] +
            m[8] * m[3] * m[5];
        inv[15] = m[0] * m[5] * m[10] -
            m[0] * m[6] * m[9] -
            m[4] * m[1] * m[10] +
            m[4] * m[2] * m[9] +
            m[8] * m[1] * m[6] -
            m[8] * m[2] * m[5];
        const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
        if (Math.abs(det) < EPSILON) {
            return null;
        }
        const inverseDet = 1.0 / det;
        for (let i = 0; i < 16; i++) {
            inv[i] *= inverseDet;
        }
        return new Matrix4(inv);
    }
    multiply(matrix) {
        return Matrix4.product(this, matrix);
    }
    multiplyVector3(vector) {
        const x = vector.x;
        const y = vector.y;
        const z = vector.z;
        const m = this.values;
        return new Vector3_1.Vector3([
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14]
        ]);
    }
    multiplyVector4(vector) {
        const m = this.values;
        const x = vector.x;
        const y = vector.y;
        const z = vector.z;
        const w = vector.w;
        return new Vector4_1.Vector4([
            m[0] * x + m[4] * y + m[8] * z + m[12] * w,
            m[1] * x + m[5] * y + m[9] * z + m[13] * w,
            m[2] * x + m[6] * y + m[10] * z + m[14] * w,
            m[3] * x + m[7] * y + m[11] * z + m[15] * w
        ]);
    }
    toMatrix3() {
        return new Matrix3_1.Matrix3([
            this.values[0],
            this.values[1],
            this.values[2],
            this.values[4],
            this.values[5],
            this.values[6],
            this.values[8],
            this.values[9],
            this.values[10]
        ]);
    }
    toInverseMatrix3() {
        const matrix3 = this.toMatrix3();
        return matrix3.inverse();
    }
    translate(vector) {
        const translation = new Matrix4([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            vector.x, vector.y, vector.z, 1
        ]);
        return Matrix4.product(this, translation);
    }
    scale(vector) {
        const scaling = new Matrix4([
            vector.x, 0, 0, 0,
            0, vector.y, 0, 0,
            0, 0, vector.z, 0,
            0, 0, 0, 1
        ]);
        return Matrix4.product(this, scaling);
    }
    rotate(angle, axis) {
        const x = axis.x;
        const y = axis.y;
        const z = axis.z;
        const length = Math.sqrt(x * x + y * y + z * z);
        if (length === 0) {
            return null;
        }
        if (length !== 1) {
            const invLength = 1 / length;
            this.rotate(angle, new Vector3_1.Vector3([x * invLength, y * invLength, z * invLength]));
            return this;
        }
        const s = Math.sin(angle);
        const c = Math.cos(angle);
        const t = 1 - c;
        const m = [
            x * x * t + c, y * x * t + z * s, z * x * t - y * s, 0,
            x * y * t - z * s, y * y * t + c, z * y * t + x * s, 0,
            x * z * t + y * s, y * z * t - x * s, z * z * t + c, 0,
            0, 0, 0, 1
        ];
        const rotationMatrix = new Matrix4(m);
        return Matrix4.product(this, rotationMatrix);
    }
    toArray() {
        return Array.from(this.values);
    }
}
exports.Matrix4 = Matrix4;
//# sourceMappingURL=Matrix4.js.map