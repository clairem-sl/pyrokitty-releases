"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Matrix3 = void 0;
const Vector2_1 = require("./Vector2");
const Vector3_1 = require("./Vector3");
const Matrix4_1 = require("./Matrix4");
const Quaternion_1 = require("./Quaternion");
class Matrix3 {
    static identity = new Matrix3().setIdentity();
    static EPSILON = 1e-6;
    values = new Float32Array(9);
    constructor(values) {
        if (values) {
            this.init(values);
        }
    }
    at(index) {
        return this.values[index];
    }
    init(values) {
        if (values.length !== 9) {
            throw new Error("Matrix3 requires exactly 9 values.");
        }
        let i = 0;
        for (const value of values) {
            this.values[i] = value;
            i++;
        }
        return this;
    }
    reset() {
        let i = 0;
        for (const _ of this.values) {
            this.values[i] = 0;
            i++;
        }
    }
    copy(dest) {
        if (!dest) {
            dest = new Matrix3();
        }
        let i = 0;
        for (const value of this.values) {
            dest.values[i] = value;
            i++;
        }
        return dest;
    }
    all() {
        const data = [];
        for (const value of this.values) {
            data.push(value);
        }
        return data;
    }
    row(index) {
        return [
            this.values[index * 3],
            this.values[index * 3 + 1],
            this.values[index * 3 + 2]
        ];
    }
    col(index) {
        return [
            this.values[index],
            this.values[index + 3],
            this.values[index + 6]
        ];
    }
    equals(matrix, threshold = Matrix3.EPSILON) {
        let i = 0;
        for (const value of this.values) {
            if (Math.abs(value - matrix.at(i)) > threshold) {
                return false;
            }
            i++;
        }
        return true;
    }
    determinant() {
        const a00 = this.values[0];
        const a01 = this.values[1];
        const a02 = this.values[2];
        const a10 = this.values[3];
        const a11 = this.values[4];
        const a12 = this.values[5];
        const a20 = this.values[6];
        const a21 = this.values[7];
        const a22 = this.values[8];
        const det01 = a22 * a11 - a12 * a21;
        const det11 = -a22 * a10 + a12 * a20;
        const det21 = a21 * a10 - a11 * a20;
        return a00 * det01 + a01 * det11 + a02 * det21;
    }
    setIdentity() {
        this.reset();
        this.values[0] = 1;
        this.values[4] = 1;
        this.values[8] = 1;
        return this;
    }
    transpose() {
        const transposedValues = [
            this.values[0],
            this.values[3],
            this.values[6],
            this.values[1],
            this.values[4],
            this.values[7],
            this.values[2],
            this.values[5],
            this.values[8]
        ];
        return new Matrix3(transposedValues);
    }
    inverse() {
        const a00 = this.values[0];
        const a01 = this.values[1];
        const a02 = this.values[2];
        const a10 = this.values[3];
        const a11 = this.values[4];
        const a12 = this.values[5];
        const a20 = this.values[6];
        const a21 = this.values[7];
        const a22 = this.values[8];
        const det01 = a22 * a11 - a12 * a21;
        const det11 = -a22 * a10 + a12 * a20;
        const det21 = a21 * a10 - a11 * a20;
        let det = a00 * det01 + a01 * det11 + a02 * det21;
        if (Math.abs(det) < Matrix3.EPSILON) {
            return null;
        }
        det = 1.0 / det;
        const invValues = [
            det01 * det,
            (-a22 * a01 + a02 * a21) * det,
            (a12 * a01 - a02 * a11) * det,
            det11 * det,
            (a22 * a00 - a02 * a20) * det,
            (-a12 * a00 + a02 * a10) * det,
            det21 * det,
            (-a21 * a00 + a01 * a20) * det,
            (a11 * a00 - a01 * a10) * det
        ];
        return new Matrix3(invValues);
    }
    multiply(matrix) {
        const a00 = this.values[0];
        const a01 = this.values[1];
        const a02 = this.values[2];
        const a10 = this.values[3];
        const a11 = this.values[4];
        const a12 = this.values[5];
        const a20 = this.values[6];
        const a21 = this.values[7];
        const a22 = this.values[8];
        const b00 = matrix.at(0);
        const b01 = matrix.at(1);
        const b02 = matrix.at(2);
        const b10 = matrix.at(3);
        const b11 = matrix.at(4);
        const b12 = matrix.at(5);
        const b20 = matrix.at(6);
        const b21 = matrix.at(7);
        const b22 = matrix.at(8);
        const resultValues = [
            b00 * a00 + b01 * a10 + b02 * a20,
            b00 * a01 + b01 * a11 + b02 * a21,
            b00 * a02 + b01 * a12 + b02 * a22,
            b10 * a00 + b11 * a10 + b12 * a20,
            b10 * a01 + b11 * a11 + b12 * a21,
            b10 * a02 + b11 * a12 + b12 * a22,
            b20 * a00 + b21 * a10 + b22 * a20,
            b20 * a01 + b21 * a11 + b22 * a21,
            b20 * a02 + b21 * a12 + b22 * a22
        ];
        return new Matrix3(resultValues);
    }
    multiplyVector2(vector, result) {
        const x = vector.x;
        const y = vector.y;
        if (result) {
            result.x = x * this.values[0] + y * this.values[3] + this.values[6];
            result.y = x * this.values[1] + y * this.values[4] + this.values[7];
            return result;
        }
        else {
            return new Vector2_1.Vector2([
                x * this.values[0] + y * this.values[3] + this.values[6],
                x * this.values[1] + y * this.values[4] + this.values[7]
            ]);
        }
    }
    multiplyVector3(vector, result) {
        const x = vector.x;
        const y = vector.y;
        const z = vector.z;
        if (result) {
            result.x = x * this.values[0] + y * this.values[3] + z * this.values[6];
            result.y = x * this.values[1] + y * this.values[4] + z * this.values[7];
            result.z = x * this.values[2] + y * this.values[5] + z * this.values[8];
            return result;
        }
        else {
            return new Vector3_1.Vector3([
                x * this.values[0] + y * this.values[3] + z * this.values[6],
                x * this.values[1] + y * this.values[4] + z * this.values[7],
                x * this.values[2] + y * this.values[5] + z * this.values[8]
            ]);
        }
    }
    toMatrix4(result) {
        const mat4Values = [
            this.values[0],
            this.values[1],
            this.values[2],
            0,
            this.values[3],
            this.values[4],
            this.values[5],
            0,
            this.values[6],
            this.values[7],
            this.values[8],
            0,
            0,
            0,
            0,
            1
        ];
        if (result) {
            result.init(mat4Values);
            return result;
        }
        else {
            return new Matrix4_1.Matrix4(mat4Values);
        }
    }
    toQuaternion() {
        const m00 = this.values[0];
        const m01 = this.values[1];
        const m02 = this.values[2];
        const m10 = this.values[3];
        const m11 = this.values[4];
        const m12 = this.values[5];
        const m20 = this.values[6];
        const m21 = this.values[7];
        const m22 = this.values[8];
        const fourXSquaredMinus1 = m00 - m11 - m22;
        const fourYSquaredMinus1 = m11 - m00 - m22;
        const fourZSquaredMinus1 = m22 - m00 - m11;
        const fourWSquaredMinus1 = m00 + m11 + m22;
        let biggestIndex = 0;
        let fourBiggestSquaredMinus1 = fourWSquaredMinus1;
        if (fourXSquaredMinus1 > fourBiggestSquaredMinus1) {
            fourBiggestSquaredMinus1 = fourXSquaredMinus1;
            biggestIndex = 1;
        }
        if (fourYSquaredMinus1 > fourBiggestSquaredMinus1) {
            fourBiggestSquaredMinus1 = fourYSquaredMinus1;
            biggestIndex = 2;
        }
        if (fourZSquaredMinus1 > fourBiggestSquaredMinus1) {
            fourBiggestSquaredMinus1 = fourZSquaredMinus1;
            biggestIndex = 3;
        }
        const biggestVal = Math.sqrt(fourBiggestSquaredMinus1 + 1) * 0.5;
        const mult = 0.25 / biggestVal;
        const quat = new Quaternion_1.Quaternion();
        switch (biggestIndex) {
            case 0:
                quat.w = biggestVal;
                quat.x = (m12 - m21) * mult;
                quat.y = (m20 - m02) * mult;
                quat.z = (m01 - m10) * mult;
                break;
            case 1:
                quat.w = (m12 - m21) * mult;
                quat.x = biggestVal;
                quat.y = (m01 + m10) * mult;
                quat.z = (m20 + m02) * mult;
                break;
            case 2:
                quat.w = (m20 - m02) * mult;
                quat.x = (m01 + m10) * mult;
                quat.y = biggestVal;
                quat.z = (m12 + m21) * mult;
                break;
            case 3:
                quat.w = (m01 - m10) * mult;
                quat.x = (m20 + m02) * mult;
                quat.y = (m12 + m21) * mult;
                quat.z = biggestVal;
                break;
        }
        return quat;
    }
    rotate(angle, axis) {
        let x = axis.x;
        let y = axis.y;
        let z = axis.z;
        let length = Math.sqrt(x * x + y * y + z * z);
        if (length < Matrix3.EPSILON) {
            return null;
        }
        if (length !== 1) {
            length = 1 / length;
            x *= length;
            y *= length;
            z *= length;
        }
        const s = Math.sin(angle);
        const c = Math.cos(angle);
        const t = 1.0 - c;
        const b00 = x * x * t + c;
        const b01 = y * x * t + z * s;
        const b02 = z * x * t - y * s;
        const b10 = x * y * t - z * s;
        const b11 = y * y * t + c;
        const b12 = z * y * t + x * s;
        const b20 = x * z * t + y * s;
        const b21 = y * z * t - x * s;
        const b22 = z * z * t + c;
        const a00 = this.values[0];
        const a01 = this.values[1];
        const a02 = this.values[2];
        const a10 = this.values[3];
        const a11 = this.values[4];
        const a12 = this.values[5];
        const a20 = this.values[6];
        const a21 = this.values[7];
        const a22 = this.values[8];
        const resultValues = [
            a00 * b00 + a10 * b01 + a20 * b02,
            a01 * b00 + a11 * b01 + a21 * b02,
            a02 * b00 + a12 * b01 + a22 * b02,
            a00 * b10 + a10 * b11 + a20 * b12,
            a01 * b10 + a11 * b11 + a21 * b12,
            a02 * b10 + a12 * b11 + a22 * b12,
            a00 * b20 + a10 * b21 + a20 * b22,
            a01 * b20 + a11 * b21 + a21 * b22,
            a02 * b20 + a12 * b21 + a22 * b22
        ];
        return new Matrix3(resultValues);
    }
}
exports.Matrix3 = Matrix3;
//# sourceMappingURL=Matrix3.js.map