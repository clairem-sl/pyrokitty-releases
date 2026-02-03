import { Vector4 } from './Vector4';
import { Vector3 } from './Vector3';
import { Matrix3 } from './Matrix3';
export declare class Matrix4 {
    static readonly identity: Matrix4;
    private readonly values;
    constructor(values?: number[] | null);
    static frustum(left: number, right: number, bottom: number, top: number, near: number, far: number): Matrix4;
    static perspective(fov: number, aspect: number, near: number, far: number): Matrix4;
    static orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Matrix4;
    static lookAt(position: Vector3, target: Vector3, up?: Vector3): Matrix4;
    static product(m1: Matrix4, m2: Matrix4, result?: Matrix4 | null): Matrix4;
    at(index: number): number;
    init(values: unknown[]): this;
    reset(): void;
    copy(dest?: Matrix4 | null): Matrix4;
    all(): number[];
    row(index: number): number[];
    col(index: number): number[];
    equals(matrix: Matrix4, threshold?: number): boolean;
    determinant(): number;
    setIdentity(): this;
    transpose(): Matrix4;
    inverse(): Matrix4 | null;
    multiply(matrix: Matrix4): Matrix4;
    multiplyVector3(vector: Vector3): Vector3;
    multiplyVector4(vector: Vector4): Vector4;
    toMatrix3(): Matrix3;
    toInverseMatrix3(): Matrix3 | null;
    translate(vector: Vector3): Matrix4;
    scale(vector: Vector3): Matrix4;
    rotate(angle: number, axis: Vector3): Matrix4 | null;
    toArray(): number[];
}
//# sourceMappingURL=Matrix4.d.ts.map