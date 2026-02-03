import { Vector3 } from '../Vector3';
export declare class FlexibleData {
    Softness: number;
    Tension: number;
    Drag: number;
    Gravity: number;
    Wind: number;
    Force: Vector3;
    constructor(buf?: Buffer, pos?: number, length?: number);
    writeToBuffer(buf: Buffer, pos: number): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=FlexibleData.d.ts.map