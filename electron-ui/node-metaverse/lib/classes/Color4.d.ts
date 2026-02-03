import type { XMLNode } from 'xmlbuilder';
export declare class Color4 {
    red: number | Buffer | number[];
    green: number;
    blue: number | boolean;
    alpha: number | boolean;
    static black: Color4;
    static white: Color4;
    constructor(red: number | Buffer | number[], green?: number, blue?: number | boolean, alpha?: number | boolean);
    static getXML(doc: XMLNode, c?: Color4): void;
    static fromXMLJS(obj: any, param: string): Color4 | false;
    getRed(): number;
    getGreen(): number;
    getBlue(): number;
    getAlpha(): number;
    writeToBuffer(buf: Buffer, pos: number, inverted?: boolean): void;
    getBuffer(inverted?: boolean): Buffer;
    equals(other: Color4): boolean;
}
//# sourceMappingURL=Color4.d.ts.map