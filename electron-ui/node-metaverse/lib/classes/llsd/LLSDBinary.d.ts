import type { BinaryReader } from "../BinaryReader";
import type { LLSDType } from "./LLSDType";
import type { BinaryWriter } from "../BinaryWriter";
export declare class LLSDBinary {
    static parseValue(reader: BinaryReader): LLSDType;
    static encodeValue(value: LLSDType, writer: BinaryWriter): void;
}
//# sourceMappingURL=LLSDBinary.d.ts.map