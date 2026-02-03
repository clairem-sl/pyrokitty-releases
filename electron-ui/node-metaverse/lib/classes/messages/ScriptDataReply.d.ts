import Long from 'long';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class ScriptDataReplyMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    DataBlock: {
        Hash: Long;
        Reply: Buffer;
    }[];
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=ScriptDataReply.d.ts.map