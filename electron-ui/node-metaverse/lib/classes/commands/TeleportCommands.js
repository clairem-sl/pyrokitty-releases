"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeleportCommands = void 0;
const CommandsBase_1 = require("./CommandsBase");
const Region_1 = require("../Region");
const TeleportEventType_1 = require("../../enums/TeleportEventType");
const TeleportLureRequest_1 = require("../messages/TeleportLureRequest");
const TeleportLocationRequest_1 = require("../messages/TeleportLocationRequest");
const TeleportFlags_1 = require("../../enums/TeleportFlags");
const PacketFlags_1 = require("../../enums/PacketFlags");
const Utils_1 = require("../Utils");
class TeleportCommands extends CommandsBase_1.CommandsBase {
    expectingTeleport = false;
    teleportSubscription;
    constructor(region, agent, bot) {
        super(region, agent, bot);
        this.teleportSubscription = this.bot.clientEvents.onTeleportEvent.subscribe((e) => {
            if (e.eventType === TeleportEventType_1.TeleportEventType.TeleportCompleted) {
                if (!this.expectingTeleport) {
                    if (e.simIP === 'local') {
                        // Local TP - no need for any other shindiggery
                        return;
                    }
                    // In handoff mode, don't auto-connect to destination
                    if (this.bot.teleportHandoffMode) {
                        return;
                    }
                    const newRegion = new Region_1.Region(this.agent, this.bot.clientEvents, this.currentRegion.options);
                    newRegion.circuit.circuitCode = this.currentRegion.circuit.circuitCode;
                    newRegion.circuit.secureSessionID = this.currentRegion.circuit.secureSessionID;
                    newRegion.circuit.sessionID = this.currentRegion.circuit.sessionID;
                    newRegion.circuit.udpBlacklist = this.currentRegion.circuit.udpBlacklist;
                    newRegion.circuit.ipAddress = e.simIP;
                    newRegion.circuit.port = e.simPort;
                    newRegion.activateCaps(e.seedCapability);
                    this.bot.changeRegion(newRegion, false).then(() => {
                        // Change region successful
                    }).catch((error) => {
                        console.log('Failed to change region');
                        console.error(error);
                    });
                }
            }
        });
    }
    shutdown() {
        this.teleportSubscription.unsubscribe();
    }
    async acceptTeleport(lure) {
        const { circuit } = this.currentRegion;
        const tlr = new TeleportLureRequest_1.TeleportLureRequestMessage();
        tlr.Info = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID,
            LureID: lure.lureID,
            TeleportFlags: TeleportFlags_1.TeleportFlags.ViaLure
        };
        circuit.sendMessage(tlr, PacketFlags_1.PacketFlags.Reliable);
        return this.awaitTeleportEvent(true);
    }
    async teleportToRegionCoordinates(x, y, position, lookAt) {
        const globalPos = Utils_1.Utils.RegionCoordinatesToHandle(x, y);
        return this.teleportToHandle(globalPos.regionHandle, position, lookAt);
    }
    async teleportToHandle(handle, position, lookAt) {
        return new Promise((resolve, reject) => {
            const rtm = new TeleportLocationRequest_1.TeleportLocationRequestMessage();
            rtm.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.circuit.sessionID
            };
            rtm.Info = {
                LookAt: lookAt,
                Position: position,
                RegionHandle: handle
            };
            this.circuit.sendMessage(rtm, PacketFlags_1.PacketFlags.Reliable);
            this.awaitTeleportEvent(true).then((event) => {
                resolve(event);
            }).catch((err) => {
                if (err instanceof Error) {
                    reject(err);
                }
                else {
                    reject(new Error('Failed to teleport'));
                }
            });
        });
    }
    async teleportTo(regionName, position, lookAt) {
        const region = await this.bot.clientCommands.grid.getRegionByName(regionName);
        return this.teleportToHandle(region.handle, position, lookAt);
    }
    async awaitTeleportEvent(requested) {
        return new Promise((resolve, reject) => {
            if (this.currentRegion.caps.eventQueueClient) {
                if (this.bot.clientEvents === null) {
                    reject(new Error('ClientEvents is null'));
                    return;
                }
                this.expectingTeleport = true;
                const subscription = this.bot.clientEvents.onTeleportEvent.subscribe((e) => {
                    if (e.eventType === TeleportEventType_1.TeleportEventType.TeleportFailed || e.eventType === TeleportEventType_1.TeleportEventType.TeleportCompleted) {
                        setTimeout(() => {
                            this.expectingTeleport = false;
                        });
                        subscription.unsubscribe();
                    }
                    if (e.eventType === TeleportEventType_1.TeleportEventType.TeleportFailed) {
                        reject(new class extends Error {
                            teleportEvent = e;
                            constructor() {
                                super('Teleport failed');
                            }
                        });
                    }
                    else if (e.eventType === TeleportEventType_1.TeleportEventType.TeleportCompleted) {
                        if (e.simIP === 'local') {
                            // Local TP - no need for any other shindiggery
                            resolve(e);
                            return;
                        }
                        // In handoff mode, resolve with event data but don't connect
                        if (this.bot.teleportHandoffMode) {
                            resolve(e);
                            return;
                        }
                        if (this.bot.clientEvents === null) {
                            reject(new Error('ClientEvents is null'));
                            return;
                        }
                        // Successful teleport! First, rip apart circuit
                        const region = new Region_1.Region(this.agent, this.bot.clientEvents, this.currentRegion.options);
                        region.circuit.circuitCode = this.currentRegion.circuit.circuitCode;
                        region.circuit.secureSessionID = this.currentRegion.circuit.secureSessionID;
                        region.circuit.sessionID = this.currentRegion.circuit.sessionID;
                        region.circuit.udpBlacklist = this.currentRegion.circuit.udpBlacklist;
                        region.circuit.ipAddress = e.simIP;
                        region.circuit.port = e.simPort;
                        region.activateCaps(e.seedCapability);
                        this.bot.changeRegion(region, requested).then(() => {
                            resolve(e);
                        }).catch((error) => {
                            if (error instanceof Error) {
                                reject(error);
                            }
                            else {
                                reject(new Error('Failed to teleport'));
                            }
                        });
                    }
                });
            }
            else {
                reject(new Error('EventQueue not ready'));
            }
        });
    }
}
exports.TeleportCommands = TeleportCommands;
//# sourceMappingURL=TeleportCommands.js.map