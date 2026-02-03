import Long from 'long';
import type { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
import type { StatID } from '../../enums/StatID';
export declare class SimStatsMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    Region: {
        RegionX: number;
        RegionY: number;
        RegionFlags: number;
        ObjectCapacity: number;
    };
    Stat: {
        StatID: StatID;
        StatValue: number;
    }[];
    PidStat: {
        PID: number;
    };
    RegionInfo: {
        RegionFlagsExtended: Long;
    }[];
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=SimStats.d.ts.map