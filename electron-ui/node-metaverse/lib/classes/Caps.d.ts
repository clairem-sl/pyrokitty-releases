import { EventQueueClient } from './EventQueueClient';
import type { UUID } from './UUID';
import type { ClientEvents } from './ClientEvents';
import type { Agent } from './Agent';
import type { ICapResponse } from './interfaces/ICapResponse';
import { AssetType } from '../enums/AssetType';
export declare class Caps {
    eventQueueClient: EventQueueClient | null;
    private static readonly CAP_INVOCATION_DELAY_MS;
    private readonly onGotSeedCap;
    private gotSeedCap;
    private capabilities;
    private readonly clientEvents;
    private readonly agent;
    private active;
    private timeLastCapExecuted;
    constructor(agent: Agent, seedURL: string, clientEvents: ClientEvents);
    downloadAsset(uuid: UUID, type: AssetType): Promise<Buffer>;
    requestPost(capURL: string, data: string | Buffer, contentType: string): Promise<{
        status: number;
        body: string;
    }>;
    requestPut(capURL: string, data: string | Buffer, contentType: string): Promise<ICapResponse>;
    requestGet(requestURL: string): Promise<ICapResponse>;
    requestDelete(requestURL: string): Promise<ICapResponse>;
    isCapAvailable(capability: string): Promise<boolean>;
    getCapability(capability: string): Promise<string>;
    capsRequestUpload(capURL: string, data: Buffer): Promise<any>;
    capsPerformXMLPost(capURL: string, data: any): Promise<any>;
    capsPerformXMLPut(capURL: string, data: any): Promise<any>;
    capsPerformXMLGet(capURL: string): Promise<any>;
    capsPerformGet(capURL: string): Promise<string>;
    capsGetXML(capability: string | [string, Record<string, string>]): Promise<any>;
    capsGetString(capability: string | [string, Record<string, string>]): Promise<string>;
    capsPostXML(capability: string | [string, Record<string, string>], data: any): Promise<any>;
    capsPutXML(capability: string | [string, Record<string, string>], data: any): Promise<any>;
    shutdown(): void;
    waitForSeedCapability(): Promise<void>;
    private waitForCapTimeout;
}
//# sourceMappingURL=Caps.d.ts.map