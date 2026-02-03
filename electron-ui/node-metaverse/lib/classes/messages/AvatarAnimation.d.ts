import { UUID } from '../UUID';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class AvatarAnimationMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    Sender: {
        ID: UUID;
    };
    AnimationList: {
        AnimID: UUID;
        AnimSequenceID: number;
    }[];
    AnimationSourceList: {
        ObjectID: UUID;
    }[];
    PhysicalAvatarEventList: {
        TypeData: Buffer;
    }[];
    getSize(): number;
    calculateVarVarSize(block: {
        [key: string]: any;
    }[], paramName: string, extraPerVar: number): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=AvatarAnimation.d.ts.map