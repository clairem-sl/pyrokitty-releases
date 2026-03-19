/**
 * ChildAgentManager - manages child agent connections to neighboring regions.
 *
 * When the sim sends EnableSimulator events, this creates ChildAgentConnection instances
 * for each neighbor. Each child connection creates a full Region with ObjectStore, terrain,
 * parcels, and avatar tracking — expanding awareness from 1 region to up to 3x3 regions.
 */

import { Subject, type Subscription } from 'rxjs';
import { ChildAgentConnection, type ChildAgentAvatar } from './ChildAgentConnection';
import type { ClientEvents } from './ClientEvents';
import type { Agent } from './Agent';
import type { Bot } from '../Bot';
import type { UUID } from './UUID';
import type { Region } from './Region';
import type { BotOptionFlags } from '../enums/BotOptionFlags';
import type Long from 'long';

export class ChildAgentManager {
    /** Fires when any child's avatar list changes */
    public onChildAvatarsUpdated: Subject<void> = new Subject<void>();

    private readonly children = new Map<string, ChildAgentConnection>();
    private readonly agentID: UUID;
    private readonly sessionID: UUID;
    private readonly secureSessionID: UUID;
    private readonly circuitCode: number;
    private readonly clientEvents: ClientEvents;
    private readonly agent: Agent;
    private readonly bot: Bot;
    private readonly options: BotOptionFlags;
    private mainRegionKey = '';
    private isShutdown = false;
    private eacSubscription: Subscription | null = null;

    constructor(params: {
        agentID: UUID;
        sessionID: UUID;
        secureSessionID: UUID;
        circuitCode: number;
        clientEvents: ClientEvents;
        agent: Agent;
        bot: Bot;
        options: BotOptionFlags;
    }) {
        this.agentID = params.agentID;
        this.sessionID = params.sessionID;
        this.secureSessionID = params.secureSessionID;
        this.circuitCode = params.circuitCode;
        this.clientEvents = params.clientEvents;
        this.agent = params.agent;
        this.bot = params.bot;
        this.options = params.options;

        // Subscribe to EstablishAgentCommunication to activate caps on child connections
        this.eacSubscription = this.clientEvents.onEstablishAgentCommunication.subscribe((evt) => {
            if (this.isShutdown) return;
            const child = this.children.get(evt.simIpAndPort);
            if (child) {
                child.activateCaps(evt.seedCapability);
            }
        });
    }

    /** Set the main region's ip:port so we skip creating a child for it */
    setMainRegion(ipAddress: string, port: number): void {
        this.mainRegionKey = `${ipAddress}:${port}`;
    }

    /** Create and connect a child agent for a neighbor region */
    async enableSimulator(regionHandle: Long, ipAddress: string, port: number): Promise<void> {
        if (this.isShutdown) return;

        const key = `${ipAddress}:${port}`;

        // Skip if this is our main region
        if (key === this.mainRegionKey) return;

        // Skip if already connected
        if (this.children.has(key)) return;

        const child = new ChildAgentConnection({
            regionHandle,
            ipAddress,
            port,
            agentID: this.agentID,
            sessionID: this.sessionID,
            secureSessionID: this.secureSessionID,
            circuitCode: this.circuitCode,
            clientEvents: this.clientEvents,
            agent: this.agent,
            bot: this.bot,
            options: this.options,
        });

        this.children.set(key, child);

        try {
            await child.connect();
        } catch (e) {
            console.warn(`[ChildAgentManager] Failed to connect child agent to ${key}:`, e);
            this.children.delete(key);
        }
    }

    /** Get all avatars across all child connections */
    getAllChildAvatars(): {
        avatar: ChildAgentAvatar;
        regionName: string;
        gridX: number;
        gridY: number;
    }[] {
        const result: {
            avatar: ChildAgentAvatar;
            regionName: string;
            gridX: number;
            gridY: number;
        }[] = [];

        for (const child of this.children.values()) {
            if (!child.isConnected()) continue;

            for (const [id, av] of child.agents) {
                const pos = av.position;
                result.push({
                    avatar: {
                        id,
                        firstName: av.getFirstName(),
                        lastName: av.getLastName(),
                        position: pos,
                    },
                    regionName: child.regionName,
                    gridX: child.gridX,
                    gridY: child.gridY,
                });
            }
        }

        return result;
    }

    /** Get the Region for a child connection by ip:port key */
    getChildRegion(ipAddress: string, port: number): Region | null {
        const child = this.children.get(`${ipAddress}:${port}`);
        return child?.region ?? null;
    }

    /** Get all connected child Regions */
    getChildRegions(): Region[] {
        const regions: Region[] = [];
        for (const child of this.children.values()) {
            if (child.isConnected()) {
                regions.push(child.region);
            }
        }
        return regions;
    }

    /** Tear down all children (called on region change — new EnableSimulator events will come) */
    updateMainRegion(ipAddress: string, port: number): void {
        this.shutdownAll();
        this.mainRegionKey = `${ipAddress}:${port}`;
    }

    /** Shut down all child connections */
    shutdownAll(): void {
        for (const child of this.children.values()) {
            child.shutdown();
        }
        this.children.clear();
    }

    /** Final shutdown — prevents new connections */
    shutdown(): void {
        this.isShutdown = true;
        this.shutdownAll();
        if (this.eacSubscription) {
            this.eacSubscription.unsubscribe();
            this.eacSubscription = null;
        }
        this.onChildAvatarsUpdated.complete();
    }

    /** Number of active child connections */
    get childCount(): number {
        let count = 0;
        for (const child of this.children.values()) {
            if (child.isConnected()) count++;
        }
        return count;
    }
}
