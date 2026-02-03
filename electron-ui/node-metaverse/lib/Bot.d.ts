import type { LoginResponse } from './classes/LoginResponse';
import type { LoginParameters } from './classes/LoginParameters';
import type { Agent } from './classes/Agent';
import type { Region } from './classes/Region';
import { ClientEvents } from './classes/ClientEvents';
import { ClientCommands } from './classes/ClientCommands';
import type { BotOptionFlags } from './enums/BotOptionFlags';
import { UUID } from './classes/UUID';
import { Vector3 } from './classes/Vector3';
export declare class Bot {
    clientEvents: ClientEvents;
    private stayRegion;
    private stayPosition;
    private readonly loginParams;
    private ping;
    private pingNumber;
    private lastSuccessfulPing;
    private circuitSubscription;
    private readonly options;
    private eventQueueRunning;
    private readonly eventQueueWaits;
    private stay;
    /**
     * When true, teleport events will fire but the bot will NOT automatically
     * connect to the destination region. This allows external code to intercept
     * the teleport data and hand it off to another client (e.g., a viewer).
     */
    teleportHandoffMode: boolean;
    private _agent?;
    private _currentRegion?;
    private _clientCommands?;
    get currentRegion(): Region;
    get agent(): Agent;
    get clientCommands(): ClientCommands;
    get loginParameters(): LoginParameters;
    constructor(login: LoginParameters, options: BotOptionFlags);
    stayPut(stay: boolean, regionName?: string, position?: Vector3): void;
    getCurrentRegion(): Region;
    login(): Promise<LoginResponse>;
    changeRegion(region: Region, requested: boolean): Promise<void>;
    waitForEventQueue(timeout?: number): Promise<void>;
    setInterestList(mode: '360' | 'default'): Promise<boolean>;
    close(): Promise<void>;
    agentID(): UUID;
    connectToSim(requested?: boolean): Promise<void>;
    private closeCircuit;
    private kicked;
    private disconnected;
}
//# sourceMappingURL=Bot.d.ts.map