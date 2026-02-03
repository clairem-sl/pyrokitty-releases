import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class AlertMessageMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    AlertData: {
        Message: Buffer;
    };
    AlertInfo: {
        Message: Buffer;
        ExtraParams: Buffer;
    }[];
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=AlertMessage.d.ts.map