import type { MessageBase } from './MessageBase';
import { PacketFlags } from '../enums/PacketFlags';
import type { DecodeFlags } from '../enums/DecodeFlags';
export declare class Packet {
    packetFlags: PacketFlags;
    sequenceNumber: number;
    extraHeader: Buffer;
    message: MessageBase;
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number, options?: DecodeFlags): Buffer;
    readFromBuffer(buf: Buffer, pos: number, ackReceived: (sequenceID: number) => void, sendAck: (sequenceID: number) => void): number;
}
//# sourceMappingURL=Packet.d.ts.map