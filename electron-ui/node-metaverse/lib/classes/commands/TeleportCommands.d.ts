import { CommandsBase } from './CommandsBase';
import { Region } from '../Region';
import type { Vector3 } from '../Vector3';
import type * as Long from 'long';
import type { Agent } from '../Agent';
import type { TeleportEvent } from '../../events/TeleportEvent';
import type { LureEvent } from '../../events/LureEvent';
import type { Bot } from '../../Bot';
export declare class TeleportCommands extends CommandsBase {
    private expectingTeleport;
    private readonly teleportSubscription;
    constructor(region: Region, agent: Agent, bot: Bot);
    shutdown(): void;
    acceptTeleport(lure: LureEvent): Promise<TeleportEvent>;
    teleportToRegionCoordinates(x: number, y: number, position: Vector3, lookAt: Vector3): Promise<TeleportEvent>;
    teleportToHandle(handle: Long, position: Vector3, lookAt: Vector3): Promise<TeleportEvent>;
    teleportTo(regionName: string, position: Vector3, lookAt: Vector3): Promise<TeleportEvent>;
    private awaitTeleportEvent;
}
//# sourceMappingURL=TeleportCommands.d.ts.map