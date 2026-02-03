import type { TeleportEventType } from '../enums/TeleportEventType';
import Long from 'long';

export class TeleportEvent
{
    public eventType: TeleportEventType;
    public message: string;
    public simIP: string;
    public simPort: number;
    public seedCapability: string;
    public regionHandle: Long;
}
