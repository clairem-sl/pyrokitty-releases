import { CommandsBase } from './CommandsBase';
import type { Region } from '../Region';
import type { Agent } from '../Agent';
import type { Bot } from '../../Bot';
import { Friend } from '../public/Friend';
import { RightsFlags } from '../../enums/RightsFlags';
import { UUID } from '../UUID';
import type { MapLocation } from '../public/interfaces/MapLocation';
import type { FriendRequestEvent } from '../../events/FriendRequestEvent';
export declare class FriendCommands extends CommandsBase {
    private friendMessages?;
    private readonly friendsList;
    constructor(region: Region, agent: Agent, bot: Bot);
    grantFriendRights(friend: Friend | UUID | string, rights: RightsFlags): Promise<void>;
    getFriendMapLocation(friend: Friend | UUID | string): Promise<MapLocation>;
    getFriend(key: UUID): Friend | undefined;
    acceptFriendRequest(event: FriendRequestEvent): Promise<void>;
    rejectFriendRequest(event: FriendRequestEvent): Promise<void>;
    sendFriendRequest(to: UUID | string, message: string): Promise<void>;
    shutdown(): void;
    private processPacket;
}
//# sourceMappingURL=FriendCommands.d.ts.map