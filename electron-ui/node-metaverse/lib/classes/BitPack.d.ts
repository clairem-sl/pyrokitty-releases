export declare class BitPack {
    private readonly Data;
    static MAX_BITS: number;
    static ON: number[];
    static OFF: number[];
    private bitPos;
    private bytePos;
    constructor(Data: Buffer, bytePos: number);
    get BytePos(): number;
    get BitPos(): number;
    UnpackFloat(): number;
    UnpackBits(count: number): number;
    UnpackUBits(count: number): number;
    UnpsckShort(): number;
    UnpackUShort(): number;
    UnpackInt(): number;
    UnpackUInt(): number;
    UnpackByte(): number;
    UnpackFixed(signed: boolean, intBits: number, fracBits: number): number;
    UnpackBitsBuffer(totalCount: number): Buffer;
}
//# sourceMappingURL=BitPack.d.ts.map