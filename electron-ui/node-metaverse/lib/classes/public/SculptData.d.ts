import { UUID } from '../UUID';
import { SculptType } from '../../enums/SculptType';
export declare class SculptData {
    texture: UUID;
    type: SculptType;
    constructor(buf?: Buffer, pos?: number, length?: number);
    writeToBuffer(buf: Buffer, pos: number): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=SculptData.d.ts.map