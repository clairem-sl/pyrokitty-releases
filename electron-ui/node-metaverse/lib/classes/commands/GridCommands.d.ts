import { UUID } from '../UUID';
import { CommandsBase } from './CommandsBase';
import type { RegionInfoReplyEvent } from '../../events/RegionInfoReplyEvent';
import { MapInfoReplyEvent } from '../../events/MapInfoReplyEvent';
import { MapInfoRangeReplyEvent } from '../../events/MapInfoRangeReplyEvent';
import { AvatarQueryResult } from '../public/AvatarQueryResult';
import type { GameObject } from '../public/GameObject';
export declare class GridCommands extends CommandsBase {
    getRegionByName(regionName: string): Promise<RegionInfoReplyEvent>;
    getRegionMapInfo(gridX: number, gridY: number): Promise<MapInfoReplyEvent>;
    getRegionMapInfoRange(minX: number, minY: number, maxX: number, maxY: number): Promise<MapInfoRangeReplyEvent>;
    avatarName2KeyAndName(name: string, useCap?: boolean): Promise<{
        avatarKey: UUID;
        avatarName: string;
    }>;
    avatarName2Key(name: string, useCap?: boolean): Promise<UUID>;
    getBalance(): Promise<number>;
    payObject(target: GameObject, amount: number): Promise<void>;
    payGroup(target: UUID | string, amount: number, description: string): Promise<void>;
    payAvatar(target: UUID | string, amount: number, description: string): Promise<void>;
    avatarKey2Name(uuid: UUID | UUID[]): Promise<AvatarQueryResult | AvatarQueryResult[]>;
    private pay;
}
//# sourceMappingURL=GridCommands.d.ts.map