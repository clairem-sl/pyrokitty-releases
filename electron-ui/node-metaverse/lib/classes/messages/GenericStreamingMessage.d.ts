import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class GenericStreamingMessageMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    MethodData: {
        Method: number;
    };
    DataBlock: {
        Data: Buffer;
    };
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=GenericStreamingMessage.d.ts.map