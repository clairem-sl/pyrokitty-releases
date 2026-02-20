/**
 * ChildAgentConnection - lightweight UDP circuit to a neighboring region.
 *
 * Unlike the heavy Region class (which allocates terrain, object stores, Comms, etc.),
 * this only maintains a UDP circuit for receiving CoarseLocationUpdate messages
 * with avatar positions. No CompleteAgentMovement is sent — the sim treats us as
 * a child agent and sends only limited data.
 *
 * Optionally, when EstablishAgentCommunication provides a seed capability URL,
 * this connection activates caps + event queue. The child's event queue can then
 * receive EnableSimulator events for even more distant regions, cascading outward.
 *
 * Protocol (from Firestorm llworld.cpp):
 *   1. Send UseCircuitCode (reusing main login's circuitCode)
 *   2. Wait for RegionHandshake → reply with RegionHandshakeReply
 *   3. Sim sends CoarseLocationUpdate every few seconds
 *   4. EstablishAgentCommunication → activate caps + event queue
 *   5. DisableSimulator tears down the connection
 */

import { Circuit } from './Circuit';
import { Caps } from './Caps';
import { UUID } from './UUID';
import { Vector3 } from './Vector3';
import { Avatar } from './public/Avatar';
import { AvatarQueryResult } from './public/AvatarQueryResult';
import { UseCircuitCodeMessage } from './messages/UseCircuitCode';
import { RegionHandshakeReplyMessage } from './messages/RegionHandshakeReply';
import { StartPingCheckMessage } from './messages/StartPingCheck';
import { PacketFlags } from '../enums/PacketFlags';
import { RegionProtocolFlags } from '../enums/RegionProtocolFlags';
import { Message } from '../enums/Message';
import { Utils } from './Utils';
import type { ClientEvents } from './ClientEvents';
import type { Agent } from './Agent';
import type { Packet } from './Packet';
import type { RegionHandshakeMessage } from './messages/RegionHandshake';
import type { CoarseLocationUpdateMessage } from './messages/CoarseLocationUpdate';
import type { CompletePingCheckMessage } from './messages/CompletePingCheck';
import type { Subscription } from 'rxjs';
import type Long from 'long';

export interface ChildAgentAvatar {
    id: string;
    firstName: string;
    lastName: string;
    position: Vector3;
}

export type NameResolver = (uuid: UUID) => Promise<AvatarQueryResult | AvatarQueryResult[]>;

export class ChildAgentConnection {
    public regionName = '';
    public gridX = 0;
    public gridY = 0;
    public agents = new Map<string, Avatar>();
    public ipAddress: string;
    public port: number;

    private circuit: Circuit;
    private caps: Caps | null = null;
    private readonly agentID: UUID;
    private readonly sessionID: UUID;
    private readonly circuitCode: number;
    private readonly regionHandle: Long;
    private readonly nameResolver: NameResolver;
    private readonly onAvatarUpdate: () => void;
    private readonly clientEvents: ClientEvents;
    private readonly agent: Agent;

    private pingTimer: NodeJS.Timeout | null = null;
    private pingNumber = 0;
    private lastPingResponse = 0;
    private messageSubscription: Subscription | null = null;
    private connected = false;
    private shuttingDown = false;

    constructor(params: {
        regionHandle: Long;
        ipAddress: string;
        port: number;
        agentID: UUID;
        sessionID: UUID;
        secureSessionID: UUID;
        circuitCode: number;
        nameResolver: NameResolver;
        onAvatarUpdate: () => void;
        clientEvents: ClientEvents;
        agent: Agent;
    }) {
        this.regionHandle = params.regionHandle;
        this.ipAddress = params.ipAddress;
        this.port = params.port;
        this.agentID = params.agentID;
        this.sessionID = params.sessionID;
        this.circuitCode = params.circuitCode;
        this.nameResolver = params.nameResolver;
        this.onAvatarUpdate = params.onAvatarUpdate;
        this.clientEvents = params.clientEvents;
        this.agent = params.agent;

        // Derive grid coordinates from region handle
        // Long: high = regionX * 256, low = regionY * 256
        this.gridX = this.regionHandle.high / 256;
        this.gridY = this.regionHandle.low / 256;

        // Create circuit
        this.circuit = new Circuit();
        this.circuit.ipAddress = params.ipAddress;
        this.circuit.port = params.port;
        this.circuit.circuitCode = params.circuitCode;
        this.circuit.sessionID = params.sessionID;
        this.circuit.secureSessionID = params.secureSessionID;
    }

    async connect(): Promise<void> {
        if (this.shuttingDown) return;

        this.circuit.init();

        // Subscribe to messages we care about
        this.messageSubscription = this.circuit.subscribeToMessages([
            Message.CoarseLocationUpdate,
            Message.DisableSimulator,
        ], (packet: Packet) => {
            switch (packet.message.id) {
                case Message.CoarseLocationUpdate:
                    this.handleCoarseLocationUpdate(packet.message as CoarseLocationUpdateMessage);
                    break;
                case Message.DisableSimulator:
                    console.log(`[ChildAgent] DisableSimulator received for ${this.regionName || `${this.gridX},${this.gridY}`}`);
                    this.shutdown();
                    break;
            }
        });

        // Send UseCircuitCode (NO CompleteAgentMovement — child agent only)
        const msg = new UseCircuitCodeMessage();
        msg.CircuitCode = {
            SessionID: this.sessionID,
            ID: this.agentID,
            Code: this.circuitCode,
        };

        try {
            await this.circuit.waitForAck(
                this.circuit.sendMessage(msg, PacketFlags.Reliable),
                10000
            );
        } catch (e) {
            console.warn(`[ChildAgent] UseCircuitCode timeout for ${this.gridX},${this.gridY}`);
            this.shutdown();
            return;
        }

        if (this.shuttingDown) return;

        // Wait for RegionHandshake
        let handshake: RegionHandshakeMessage;
        try {
            handshake = await this.circuit.waitForMessage<RegionHandshakeMessage>(
                Message.RegionHandshake, 10000
            );
        } catch (e) {
            console.warn(`[ChildAgent] RegionHandshake timeout for ${this.gridX},${this.gridY}`);
            this.shutdown();
            return;
        }

        if (this.shuttingDown) return;

        // Extract region name
        this.regionName = Utils.BufferToStringSimple(handshake.RegionInfo.SimName);

        // Reply to handshake
        const reply = new RegionHandshakeReplyMessage();
        reply.AgentData = {
            AgentID: this.agentID,
            SessionID: this.sessionID,
        };
        reply.RegionInfo = {
            Flags: RegionProtocolFlags.SelfAppearanceSupport | RegionProtocolFlags.AgentAppearanceService,
        };
        this.circuit.sendMessage(reply, PacketFlags.Reliable);

        this.connected = true;
        this.lastPingResponse = Date.now();
        console.log(`[ChildAgent] Connected to ${this.regionName} (${this.gridX},${this.gridY})`);

        // Start keepalive ping (15s interval, lighter than main's 5s)
        this.pingTimer = setInterval(() => {
            this.sendPing();
        }, 15000);
    }

    /**
     * Activate caps + event queue for this child agent.
     * Called when EstablishAgentCommunication provides the seed capability URL.
     * The event queue uses the shared clientEvents, so EnableSimulator events
     * from this child will cascade to create even more child connections.
     */
    activateCaps(seedCapability: string): void {
        if (this.shuttingDown || this.caps) return;

        this.caps = new Caps(this.agent, seedCapability, this.clientEvents);
        console.log(`[ChildAgent] Caps activated for ${this.regionName} (${this.gridX},${this.gridY})`);
    }

    shutdown(): void {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        this.connected = false;

        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }

        if (this.messageSubscription) {
            this.messageSubscription.unsubscribe();
            this.messageSubscription = null;
        }

        if (this.caps) {
            this.caps.shutdown();
            this.caps = null;
        }

        this.agents.clear();
        this.circuit.shutdown();

        console.log(`[ChildAgent] Disconnected from ${this.regionName || `${this.gridX},${this.gridY}`}`);
    }

    isConnected(): boolean {
        return this.connected && !this.shuttingDown;
    }

    private sendPing(): void {
        if (!this.connected || this.shuttingDown) return;

        // Check for timeout (60s with no response)
        if (Date.now() - this.lastPingResponse > 60000) {
            console.warn(`[ChildAgent] Ping timeout for ${this.regionName}`);
            this.shutdown();
            return;
        }

        this.pingNumber = (this.pingNumber + 1) % 256;
        const ping = new StartPingCheckMessage();
        ping.PingID = {
            PingID: this.pingNumber,
            OldestUnacked: 0,
        };
        this.circuit.sendMessage(ping, PacketFlags.Reliable);

        // Listen for pong (fire-and-forget, just update lastPingResponse)
        this.circuit.waitForMessage<CompletePingCheckMessage>(
            Message.CompletePingCheck, 10000
        ).then(() => {
            this.lastPingResponse = Date.now();
        }).catch(() => {
            // Timeout on individual ping is ok; the 60s overall timeout handles it
        });
    }

    private handleCoarseLocationUpdate(locations: CoarseLocationUpdateMessage): void {
        const foundAgents: Record<string, Vector3> = {};

        const resolvePromises: Promise<void>[] = [];

        for (let i = 0; i < locations.AgentData.length; i++) {
            const agentData = locations.AgentData[i];
            const location = locations.Location[i];
            if (!location) continue;

            const agentId = agentData.AgentID.toString();
            const newPosition = new Vector3([location.X, location.Y, location.Z * 4]);
            foundAgents[agentId] = newPosition;

            const existing = this.agents.get(agentId);
            if (existing) {
                existing.coarsePosition = newPosition;
            } else {
                // Need to resolve name — do it async but don't block the update
                const uuid = agentData.AgentID;
                resolvePromises.push(
                    this.nameResolver(uuid).then((resolved) => {
                        if (this.shuttingDown) return;
                        if (Array.isArray(resolved)) resolved = resolved[0];
                        const av = new Avatar(uuid, resolved.getFirstName(), resolved.getLastName());
                        av.coarsePosition = newPosition;
                        this.agents.set(agentId, av);
                    }).catch(() => {
                        // If name resolution fails, use Unknown Avatar
                        if (this.shuttingDown) return;
                        const av = new Avatar(uuid, 'Unknown', 'Avatar');
                        av.coarsePosition = newPosition;
                        this.agents.set(agentId, av);
                    })
                );
            }
        }

        // Remove agents no longer present
        for (const agentId of this.agents.keys()) {
            if (foundAgents[agentId] === undefined) {
                const agent = this.agents.get(agentId);
                if (agent) agent.coarseLeftRegion();
                this.agents.delete(agentId);
            }
        }

        // Notify immediately for known agents, then again after name resolution
        this.onAvatarUpdate();

        if (resolvePromises.length > 0) {
            Promise.all(resolvePromises).then(() => {
                if (!this.shuttingDown) this.onAvatarUpdate();
            }).catch(() => { /* ignore */ });
        }
    }
}
