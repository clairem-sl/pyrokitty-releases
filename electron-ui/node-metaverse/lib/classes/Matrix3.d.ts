import { Vector2 } from './Vector2';
import { Vector3 } from './Vector3';
import { Matrix4 } from './Matrix4';
import { Quaternion } from './Quaternion';
export declare class Matrix3 {
    static readonly identity: Matrix3;
    private static readonly EPSILON;
    private values;
    constructor(values?: number[]);
    at(index: number): number;
    init(values: number[]): this;
    reset(): void;
    copy(dest?: Matrix3): Matrix3;
    all(): number[];
    row(index: number): number[];
    col(index: number): number[];
    equals(matrix: Matrix3, threshold?: number): boolean;
    determinant(): number;
    setIdentity(): this;
    transpose(): Matrix3;
    inverse(): Matrix3 | null;
    multiply(matrix: Matrix3): Matrix3;
    multiplyVector2(vector: Vector2, result?: Vector2): Vector2;
    multiplyVector3(vector: Vector3, result?: Vector3): Vector3;
    toMatrix4(result?: Matrix4): Matrix4;
    toQuaternion(): Quaternion;
    rotate(angle: number, axis: Vector3): Matrix3 | null;
}
//# sourceMappingURL=Matrix3.d.ts.map