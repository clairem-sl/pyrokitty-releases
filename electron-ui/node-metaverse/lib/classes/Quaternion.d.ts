import type { Vector3 } from "./Vector3";
import type { XMLNode } from 'xmlbuilder';
export declare class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(buf?: Buffer | number[] | Quaternion | number, pos?: number, z?: number, w?: number);
    static getXML(doc: XMLNode, v?: Quaternion): void;
    static fromXMLJS(obj: any, param: string): Quaternion | false;
    static fromAxis(axis: Vector3, angle: number): Quaternion;
    static getIdentity(): Quaternion;
    writeToBuffer(buf: Buffer, pos: number): void;
    toString(): string;
    getBuffer(): Buffer;
    angleBetween(b: Quaternion): number;
    dot(q: Quaternion): number;
    sum(q: Quaternion): Quaternion;
    product(q: Quaternion): Quaternion;
    cross(q: Quaternion): Quaternion;
    shortMix(q: Quaternion, t: number): Quaternion;
    mix(q: Quaternion, t: number): Quaternion;
    copy(): Quaternion;
    roll(): number;
    pitch(): number;
    yaw(): number;
    equals(q: Quaternion, epsilon?: number): boolean;
    inverse(): Quaternion;
    conjugate(): Quaternion;
    length(): number;
    lengthSquared(): number;
    normalize(): Quaternion;
    add(q: Quaternion): Quaternion;
    multiply(value: number | Quaternion): Quaternion;
    negate(): Quaternion;
    scale(scalar: number): Quaternion;
    calculateW(): Quaternion;
}
//# sourceMappingURL=Quaternion.d.ts.map