import { UUID } from '../UUID';
import { Vector3 } from '../Vector3';
export declare class LightImageData {
    texture: UUID;
    params: Vector3;
    constructor(buf: Buffer, pos: number, length: number);
    writeToBuffer(buf: Buffer, pos: number): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=LightImageData.d.ts.map