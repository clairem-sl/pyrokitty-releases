/**
 * ChildAgentConnection - full Region connection to a neighboring region.
 *
 * Creates a Region (with ObjectStore, terrain, parcels, Comms) for the
 * neighboring sim. No CompleteAgentMovement is sent — the sim treats us as
 * a child agent but sends terrain, objects, parcels, and coarse avatar data.
 *
 * Optionally, when EstablishAgentCommunication provides a seed capability URL,
 * this connection activates caps + event queue. The child's event queue can then
 * receive EnableSimulator events for even more distant regions, cascading outward.
 *
 * Protocol (from Firestorm llworld.cpp):
 *   1. Send UseCircuitCode (reusing main login's circuitCode)
 *   2. Wait for RegionHandshake → reply with RegionHandshakeReply
 *   3. Sim sends terrain, objects, parcels, CoarseLocationUpdate
 *   4. EstablishAgentCommunication → activate caps + event queue
 *   5. DisableSimulator tears down the connection
 */

import { Region } from './Region';
import { ClientCommands } from './ClientCommands';
import type { UUID } from './UUID';
import type { Vector3 } from './Vector3';
import type { Avatar } from './public/Avatar';
import { UseCircuitCodeMessage } from './messages/UseCircuitCode';
import { RegionHandshakeReplyMessage } from './messages/RegionHandshakeReply';
import { StartPingCheckMessage } from './messages/StartPingCheck';
import { PacketFlags } from '../enums/PacketFlags';
import { RegionProtocolFlags } from '../enums/RegionProtocolFlags';
import { Message } from '../enums/Message';
import type { BotOptionFlags } from '../enums/BotOptionFlags';
import type { ClientEvents } from './ClientEvents';
import type { Agent } from './Agent';
import type { Bot } from '../Bot';
import type { Packet } from './Packet';
import type { RegionHandshakeMessage } from './messages/RegionHandshake';
import type { CompletePingCheckMessage } from './messages/CompletePingCheck';
import type { Subscription } from 'rxjs';
import type Long from 'long';

export interface ChildAgentAvatar {
    id: string;
    firstName: string;
    lastName: string;
    position: Vector3;
}

export class ChildAgentConnection {
    public regionName = '';
    public gridX = 0;
    public gridY = 0;
    public ipAddress: string;
    public port: number;
    public region: Region;

    /** Proxy to the Region's agents map for backwards compatibility */
    public get agents(): Map<string, Avatar> {
        return this.region.agents;
    }

    private readonly agentID: UUID;
    private readonly sessionID: UUID;
    private readonly circuitCode: number;
    private readonly regionHandle: Long;
    private readonly agent: Agent;
    private readonly bot: Bot;
    private clientCommands: ClientCommands | null = null;

    private pingTimer: NodeJS.Timeout | null = null;
    private pingNumber = 0;
    private lastPingResponse = 0;
    private disableSimSubscription: Subscription | null = null;
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
        clientEvents: ClientEvents;
        agent: Agent;
        bot: Bot;
        options: BotOptionFlags;
    }) {
        this.regionHandle = params.regionHandle;
        this.ipAddress = params.ipAddress;
        this.port = params.port;
        this.agentID = params.agentID;
        this.sessionID = params.sessionID;
        this.circuitCode = params.circuitCode;
        this.agent = params.agent;
        this.bot = params.bot;

        // Derive grid coordinates from region handle
        // Long: high = regionX * 256, low = regionY * 256
        this.gridX = this.regionHandle.high / 256;
        this.gridY = this.regionHandle.low / 256;

        // Create a full Region (ObjectStore, terrain, parcels, Comms all included)
        this.region = new Region(params.agent, params.clientEvents, params.options);
        this.region.circuit.ipAddress = params.ipAddress;
        this.region.circuit.port = params.port;
        this.region.circuit.circuitCode = params.circuitCode;
        this.region.circuit.sessionID = params.sessionID;
        this.region.circuit.secureSessionID = params.secureSessionID;
    }

    async connect(): Promise<void> {
        if (this.shuttingDown) return;

        const circuit = this.region.circuit;
        circuit.init();

        // Subscribe to DisableSimulator
        this.disableSimSubscription = circuit.subscribeToMessages([
            Message.DisableSimulator,
        ], (_packet: Packet) => {
            console.log(`[ChildAgent] DisableSimulator received for ${this.regionName || `${this.gridX},${this.gridY}`}`);
            this.shutdown();
        });

        // Send UseCircuitCode (NO CompleteAgentMovement — child agent only)
        const msg = new UseCircuitCodeMessage();
        msg.CircuitCode = {
            SessionID: this.sessionID,
            ID: this.agentID,
            Code: this.circuitCode,
        };

        try {
            await circuit.waitForAck(
                circuit.sendMessage(msg, PacketFlags.Reliable),
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
            handshake = await circuit.waitForMessage<RegionHandshakeMessage>(
                Message.RegionHandshake, 10000
            );
        } catch (e) {
            console.warn(`[ChildAgent] RegionHandshake timeout for ${this.gridX},${this.gridY}`);
            this.shutdown();
            return;
        }

        if (this.shuttingDown) return;

        // Fill in region info via the lightweight child handshake
        this.region.handshakeChild(handshake, this.gridX, this.gridY, this.regionHandle);
        this.regionName = this.region.regionName;

        // Create ClientCommands so the Region's CoarseLocationUpdate handler can resolve names
        this.clientCommands = new ClientCommands(this.region, this.agent, this.bot);
        this.region.clientCommands = this.clientCommands;

        // Reply to handshake
        const reply = new RegionHandshakeReplyMessage();
        reply.AgentData = {
            AgentID: this.agentID,
            SessionID: this.sessionID,
        };
        reply.RegionInfo = {
            Flags: RegionProtocolFlags.SelfAppearanceSupport | RegionProtocolFlags.AgentAppearanceService,
        };
        circuit.sendMessage(reply, PacketFlags.Reliable);

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
     */
    activateCaps(seedCapability: string): void {
        if (this.shuttingDown) return;
        this.region.activateCaps(seedCapability);
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

        if (this.disableSimSubscription) {
            this.disableSimSubscription.unsubscribe();
            this.disableSimSubscription = null;
        }

        if (this.clientCommands) {
            this.clientCommands.shutdown();
            this.clientCommands = null;
        }

        this.region.shutdown();

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
        this.region.circuit.sendMessage(ping, PacketFlags.Reliable);

        // Listen for pong (fire-and-forget, just update lastPingResponse)
        this.region.circuit.waitForMessage<CompletePingCheckMessage>(
            Message.CompletePingCheck, 10000
        ).then(() => {
            this.lastPingResponse = Date.now();
        }).catch(() => {
            // Timeout on individual ping is ok; the 60s overall timeout handles it
        });
    }
}
