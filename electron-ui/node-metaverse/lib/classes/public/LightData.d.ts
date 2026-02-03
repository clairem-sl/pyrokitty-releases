import { Color4 } from '../Color4';
export declare class LightData {
    Color: Color4;
    Radius: number;
    Cutoff: number;
    Falloff: number;
    Intensity: number;
    constructor(buf?: Buffer, pos?: number, length?: number);
    writeToBuffer(buf: Buffer, pos: number): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=LightData.d.ts.map