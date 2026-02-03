import type { ChatSourceType } from '../enums/ChatSourceType';
import type { UUID } from '../classes/UUID';
import type { InstantMessageEventFlags } from '../enums/InstantMessageEventFlags';
export declare class InstantMessageEvent {
    source: ChatSourceType;
    fromName: string;
    from: UUID;
    owner: UUID;
    message: string;
    flags: InstantMessageEventFlags;
}
//# sourceMappingURL=InstantMessageEvent.d.ts.map