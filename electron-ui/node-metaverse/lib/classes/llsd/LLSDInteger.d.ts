import type { BinaryReader } from "../BinaryReader";
export declare class LLSDInteger {
    private _int;
    constructor(int: number);
    static parseBinary(reader: BinaryReader): LLSDInteger;
    valueOf(): number;
    toJSON(): number;
    set value(newValue: number);
}
//# sourceMappingURL=LLSDInteger.d.ts.map