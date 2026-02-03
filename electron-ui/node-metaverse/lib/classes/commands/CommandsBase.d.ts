import type { Region } from '../Region';
import type { Bot } from '../../Bot';
import type { Agent } from '../Agent';
import type { Circuit } from '../Circuit';
export declare class CommandsBase {
    protected currentRegion: Region;
    protected agent: Agent;
    protected bot: Bot;
    protected circuit: Circuit;
    constructor(region: Region, agent: Agent, bot: Bot);
    shutdown(): void;
}
//# sourceMappingURL=CommandsBase.d.ts.map