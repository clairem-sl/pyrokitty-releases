import type { ClientEvents } from './ClientEvents';
import type { Agent } from './Agent';
import type { Caps } from './Caps';
export declare class EventQueueClient {
    caps: Caps;
    ack?: number;
    done: boolean;
    private currentRequest?;
    private readonly clientEvents;
    private readonly agent;
    constructor(agent: Agent, caps: Caps, clientEvents: ClientEvents);
    shutdown(): Promise<void>;
    Get(): void;
    request(url: string, data: string, contentType: string): Promise<string>;
    capsPostXML(capability: string, data: any, attempt?: number): Promise<any>;
}
//# sourceMappingURL=EventQueueClient.d.ts.map