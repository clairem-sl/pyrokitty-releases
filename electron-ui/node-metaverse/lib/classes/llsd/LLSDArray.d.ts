import type { LLSDTokenGenerator } from './LLSDTokenGenerator';
import type { LLSDType } from './LLSDType';
import type { BinaryReader } from "../BinaryReader";
import type { BinaryWriter } from "../BinaryWriter";
import { Vector3 } from '../Vector3';
import { LLSDReal } from './LLSDReal';
import { Vector2 } from '../Vector2';
import { Vector4 } from '../Vector4';
import { Quaternion } from '../Quaternion';
export declare class LLSDArray {
    static parseNotation(gen: LLSDTokenGenerator): LLSDType[];
    static parseBinary(reader: BinaryReader): LLSDType[];
    static parseXML(element: Record<string, unknown>[]): LLSDType[];
    static toNotation(value: LLSDType[]): string;
    static toBinary(value: LLSDType[], writer: BinaryWriter): void;
    static toXML(value: LLSDType[]): unknown;
    static toQuaternion(arr: LLSDType[]): Quaternion;
    static toVector4(arr: LLSDType[]): Vector4;
    static toVector3(arr: LLSDType[]): Vector3;
    static toVector2(arr: LLSDType[]): Vector2;
    static fromQuaternion(vec?: Quaternion): LLSDReal[] | undefined;
    static fromVector4(vec?: Vector4): LLSDReal[] | undefined;
    static fromVector3(vec?: Vector3): LLSDReal[] | undefined;
    static fromVector2(vec?: Vector2): LLSDReal[] | undefined;
    static toStringArray(arr: LLSDType[]): string[];
    static toNumberArray(arr: LLSDType[]): number[];
    private static componentToFloat;
}
//# sourceMappingURL=LLSDArray.d.ts.map