import type { BinaryReader } from "../BinaryReader";
export declare class LLSDReal {
    private real;
    constructor(val: string | number);
    static parseBinary(reader: BinaryReader): LLSDReal;
    static parseReal(val?: unknown): LLSDReal | undefined;
    valueOf(): number;
    toJSON(): number;
    set value(newValue: number);
}
//# sourceMappingURL=LLSDReal.d.ts.map