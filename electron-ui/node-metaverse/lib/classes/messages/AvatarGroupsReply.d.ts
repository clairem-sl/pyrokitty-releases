import { UUID } from '../UUID';
import Long from 'long';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class AvatarGroupsReplyMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    AgentData: {
        AgentID: UUID;
        AvatarID: UUID;
    };
    GroupData: {
        GroupPowers: Long;
        AcceptNotices: boolean;
        GroupTitle: Buffer;
        GroupID: UUID;
        GroupName: Buffer;
        GroupInsigniaID: UUID;
    }[];
    NewGroupData: {
        ListInProfile: boolean;
    };
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=AvatarGroupsReply.d.ts.map