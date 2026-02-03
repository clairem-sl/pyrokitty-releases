import Long from 'long';
import { MessageFlags } from '../../enums/MessageFlags';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class SendXferPacketMessage implements MessageBase {
    name: string;
    messageFlags: MessageFlags;
    id: Message;
    XferID: {
        ID: Long;
        Packet: number;
    };
    DataPacket: {
        Data: Buffer;
    };
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=SendXferPacket.d.ts.map