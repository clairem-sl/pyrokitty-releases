import Long from 'long';
import { MessageFlags } from '../../enums/MessageFlags';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class ConfirmXferPacketMessage implements MessageBase {
    name: string;
    messageFlags: MessageFlags;
    id: Message;
    XferID: {
        ID: Long;
        Packet: number;
    };
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=ConfirmXferPacket.d.ts.map