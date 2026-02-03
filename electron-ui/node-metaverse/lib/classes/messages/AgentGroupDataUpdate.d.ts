import { UUID } from '../UUID';
import Long from 'long';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class AgentGroupDataUpdateMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    AgentData: {
        AgentID: UUID;
    };
    GroupData: {
        GroupID: UUID;
        GroupPowers: Long;
        AcceptNotices: boolean;
        GroupInsigniaID: UUID;
        Contribution: number;
        GroupName: Buffer;
    }[];
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=AgentGroupDataUpdate.d.ts.map