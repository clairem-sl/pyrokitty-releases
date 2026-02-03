import { UUID } from './UUID';
import { Vector3 } from './Vector3';
import { Inventory } from './Inventory';
import type { Region } from './Region';
import type { ClientEvents } from './ClientEvents';
import type * as Long from 'long';
import { ControlFlags } from '../enums/ControlFlags';
import { Subject } from 'rxjs';
import { InventoryFolder } from './InventoryFolder';
export declare class Agent {
    firstName: string;
    lastName: string;
    localID: number;
    agentID: UUID;
    activeGroupID: UUID;
    accessMax: string;
    regionAccess: string;
    agentAccess: string;
    currentRegion: Region;
    openID: {
        'token'?: string;
        'url'?: string;
    };
    AOTransition: boolean;
    buddyList: {
        'buddyRightsGiven': boolean;
        'buddyID': UUID;
        'buddyRightsHas': boolean;
    }[];
    uiFlags: {
        'allowFirstLife'?: boolean;
    };
    maxGroups: number;
    agentFlags: number;
    startLocation: string;
    cofVersion: number;
    home: {
        'regionHandle'?: Long;
        'position'?: Vector3;
        'lookAt'?: Vector3;
    };
    snapshotConfigURL: string;
    readonly inventory: Inventory;
    gestures: {
        assetID: UUID;
        itemID: UUID;
    }[];
    estateManager: boolean;
    appearanceComplete: boolean;
    agentAppearanceService: string;
    onGroupChatExpired: Subject<UUID>;
    cameraLookAt: Vector3;
    cameraCenter: Vector3;
    cameraLeftAxis: Vector3;
    cameraUpAxis: Vector3;
    cameraFar: number;
    readonly appearanceCompleteEvent: Subject<void>;
    private readonly headRotation;
    private readonly bodyRotation;
    private wearables?;
    private agentUpdateTimer;
    private controlFlags;
    private readonly clientEvents;
    private animSubscription?;
    private readonly chatSessions;
    constructor(clientEvents: ClientEvents);
    updateLastMessage(groupID: UUID): void;
    setIsEstateManager(is: boolean): void;
    getSessionAgentCount(uuid: UUID): number;
    addChatSession(uuid: UUID, timeout: boolean): boolean;
    groupChatExpired(groupID: UUID): void;
    hasChatSession(uuid: UUID): boolean;
    deleteChatSession(uuid: UUID): boolean;
    setCurrentRegion(region: Region): void;
    circuitActive(): void;
    shutdown(): void;
    setInitialAppearance(): Promise<void>;
    setControlFlag(flag: ControlFlags): void;
    clearControlFlag(flag: ControlFlags): void;
    getWearables(): Promise<InventoryFolder>;
    sendAgentUpdate(): void;
    private onMessage;
}
//# sourceMappingURL=Agent.d.ts.map