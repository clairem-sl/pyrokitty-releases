import type { TeleportEventType } from '../enums/TeleportEventType';
import Long from 'long';
export declare class TeleportEvent {
    eventType: TeleportEventType;
    message: string;
    simIP: string;
    simPort: number;
    seedCapability: string;
    regionHandle: Long;
}
//# sourceMappingURL=TeleportEvent.d.ts.map