import { UUID } from '../UUID';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class AvatarTextureUpdateMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    AgentData: {
        AgentID: UUID;
        TexturesChanged: boolean;
    };
    WearableData: {
        CacheID: UUID;
        TextureIndex: number;
        HostName: Buffer;
    }[];
    TextureData: {
        TextureID: UUID;
    }[];
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=AvatarTextureUpdate.d.ts.map