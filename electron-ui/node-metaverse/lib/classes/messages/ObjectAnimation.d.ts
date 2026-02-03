import { UUID } from '../UUID';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class ObjectAnimationMessage implements MessageBase {
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
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=ObjectAnimation.d.ts.map