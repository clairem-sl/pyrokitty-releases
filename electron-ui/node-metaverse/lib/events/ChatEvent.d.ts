import type { ChatAudibleLevel } from '../enums/ChatAudible';
import type { ChatType } from '../enums/ChatType';
import type { UUID } from '../classes/UUID';
import type { ChatSourceType } from '../enums/ChatSourceType';
import type { Vector3 } from '../classes/Vector3';
export declare class ChatEvent {
    from: UUID;
    ownerID: UUID;
    fromName: string;
    chatType: ChatType;
    sourceType: ChatSourceType;
    audible: ChatAudibleLevel;
    position: Vector3;
    message: string;
}
//# sourceMappingURL=ChatEvent.d.ts.map