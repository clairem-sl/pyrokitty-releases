import Long from 'long';
import type { XMLNode } from 'xmlbuilder';
export declare class UUID {
    private mUUID;
    constructor(buf?: Buffer | string, pos?: number);
    static zero(): UUID;
    static random(): UUID;
    static getString(u?: UUID): string;
    static getXML(doc: XMLNode, u?: UUID): void;
    static fromXMLJS(obj: any, param: string): false | UUID;
    setUUID(val: string): boolean;
    toString: () => string;
    writeToBuffer(buf: Buffer, pos: number): void;
    isZero(): boolean;
    equals(cmp: UUID | string): boolean;
    getBuffer(): Buffer;
    getLong(): Long;
    bitwiseXor(w: UUID): UUID;
    CRC(): number;
}
//# sourceMappingURL=UUID.d.ts.map