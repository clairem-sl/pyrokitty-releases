import { UUID } from '../UUID';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class RezMultipleAttachmentsFromInvMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    AgentData: {
        AgentID: UUID;
        SessionID: UUID;
    };
    HeaderData: {
        CompoundMsgID: UUID;
        TotalObjects: number;
        FirstDetachAll: boolean;
    };
    ObjectData: {
        ItemID: UUID;
        OwnerID: UUID;
        AttachmentPt: number;
        ItemFlags: number;
        GroupMask: number;
        EveryoneMask: number;
        NextOwnerMask: number;
        Name: Buffer;
        Description: Buffer;
    }[];
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=RezMultipleAttachmentsFromInv.d.ts.map