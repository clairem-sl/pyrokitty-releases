import type { Agent } from './Agent';
import type { Circuit } from './Circuit';
import type { ClientEvents } from './ClientEvents';
export declare class Comms {
    readonly circuit: Circuit;
    readonly agent: Agent;
    readonly clientEvents: ClientEvents;
    private groupChatExpiredSub?;
    constructor(circuit: Circuit, agent: Agent, clientEvents: ClientEvents);
    shutdown(): void;
    private groupChatExpired;
}
//# sourceMappingURL=Comms.d.ts.map