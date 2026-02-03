import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class SimStatusMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    SimStatus: {
        CanAcceptAgents: boolean;
        CanAcceptTasks: boolean;
    };
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=SimStatus.d.ts.map