import type { LLSDType } from "./LLSDType";
export declare class LLSD {
    static parseNotation(input: string): LLSDType;
    static parseBinary(input: Buffer, metadata?: {
        readPos: number;
    }): LLSDType;
    static toNotation(element: LLSDType, header?: boolean): string;
    static toBinary(element: LLSDType): Buffer;
    static toXML(element: LLSDType): string;
    static parseXML(input: string): LLSDType;
    static toLLSD(input: unknown): LLSDType;
}
//# sourceMappingURL=LLSD.d.ts.map