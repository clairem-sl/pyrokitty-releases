import { UUID } from '../UUID';
import { Vector3 } from '../Vector3';
import Long from 'long';
import { MessageFlags } from '../../enums/MessageFlags';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class TeleportLocationRequestMessage implements MessageBase {
    name: string;
    messageFlags: MessageFlags;
    id: Message;
    AgentData: {
        AgentID: UUID;
        SessionID: UUID;
    };
    Info: {
        RegionHandle: Long;
        Position: Vector3;
        LookAt: Vector3;
    };
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=TeleportLocationRequest.d.ts.map