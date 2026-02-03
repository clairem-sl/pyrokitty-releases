import type { UUID } from "./UUID";
import type { Vector3 } from './Vector3';
export declare class BinaryWriter {
    segments: Buffer[];
    length(): number;
    writeBuffer(buf: Buffer, start?: number, end?: number): void;
    writeVarInt(value: number | bigint): void;
    get(): Buffer;
    writeUInt8(value: number): void;
    writeInt8(value: number): void;
    writeUInt16LE(value: number): void;
    writeInt16LE(value: number): void;
    writeUInt16BE(value: number): void;
    writeInt16BE(value: number): void;
    writeUInt32LE(value: number): void;
    writeInt32LE(value: number): void;
    writeUInt32BE(value: number): void;
    writeInt32BE(value: number): void;
    writeUInt64LE(value: bigint): void;
    writeInt64LE(value: bigint): void;
    writeUInt64BE(value: bigint): void;
    writeInt64BE(value: bigint): void;
    writeFloatLE(value: number): void;
    writeVector3F(vec: Vector3): void;
    writeFloatBE(value: number): void;
    writeDoubleLE(value: number): void;
    writeDoubleBE(value: number): void;
    writeUUID(uuid: UUID): void;
    writeDate(date: Date): void;
    writeCString(str: string): void;
    writeString(str: string): void;
    writeFixedString(str: string, len?: number): void;
    writeUUIDFromParts(timeLow: number, timeMid: number, timeHiAndVersion: number, clockSeq: number, node: Buffer): void;
}
//# sourceMappingURL=BinaryWriter.d.ts.map