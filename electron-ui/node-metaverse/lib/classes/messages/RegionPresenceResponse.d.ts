import { UUID } from '../UUID';
import { IPAddress } from '../IPAddress';
import Long from 'long';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class RegionPresenceResponseMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    RegionData: {
        RegionID: UUID;
        RegionHandle: Long;
        InternalRegionIP: IPAddress;
        ExternalRegionIP: IPAddress;
        RegionPort: number;
        ValidUntil: number;
        Message: Buffer;
    }[];
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=RegionPresenceResponse.d.ts.map