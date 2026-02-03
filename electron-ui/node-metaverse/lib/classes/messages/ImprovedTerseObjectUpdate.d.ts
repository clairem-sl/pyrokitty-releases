import Long from 'long';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class ImprovedTerseObjectUpdateMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    RegionData: {
        RegionHandle: Long;
        TimeDilation: number;
    };
    ObjectData: {
        Data: Buffer;
        TextureEntry: Buffer;
    }[];
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=ImprovedTerseObjectUpdate.d.ts.map