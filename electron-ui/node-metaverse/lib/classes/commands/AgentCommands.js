"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentCommands = void 0;
const UUID_1 = require("../UUID");
const AgentAnimation_1 = require("../messages/AgentAnimation");
const PacketFlags_1 = require("../../enums/PacketFlags");
const CommandsBase_1 = require("./CommandsBase");
const Message_1 = require("../../enums/Message");
const Utils_1 = require("../Utils");
const FilterResponse_1 = require("../../enums/FilterResponse");
const AvatarPropertiesRequest_1 = require("../messages/AvatarPropertiesRequest");
class AgentCommands extends CommandsBase_1.CommandsBase {
    async startAnimations(anim) {
        return this.animate(anim, true);
    }
    async stopAnimations(anim) {
        return this.animate(anim, false);
    }
    setCamera(position, lookAt, viewDistance, leftAxis, upAxis) {
        this.agent.cameraCenter = position;
        this.agent.cameraLookAt = lookAt;
        if (viewDistance !== undefined) {
            this.agent.cameraFar = viewDistance;
        }
        if (leftAxis !== undefined) {
            this.agent.cameraLeftAxis = leftAxis;
        }
        if (upAxis !== undefined) {
            this.agent.cameraUpAxis = upAxis;
        }
        this.agent.sendAgentUpdate();
    }
    // noinspection JSUnusedGlobalSymbols
    setViewDistance(viewDistance) {
        this.agent.cameraFar = viewDistance;
        this.agent.sendAgentUpdate();
    }
    // noinspection JSUnusedGlobalSymbols
    getGameObject() {
        const agentLocalID = this.currentRegion.agent.localID;
        return this.currentRegion.objects.getObjectByLocalID(agentLocalID);
    }
    // noinspection JSUnusedGlobalSymbols
    async getWearables() {
        return this.agent.getWearables();
    }
    // noinspection JSUnusedGlobalSymbols
    async waitForAppearanceComplete(timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (this.agent.appearanceComplete) {
                resolve();
            }
            else {
                let appearanceSubscription = undefined;
                let timeoutTimer = undefined;
                appearanceSubscription = this.agent.appearanceCompleteEvent.subscribe(() => {
                    if (timeoutTimer !== undefined) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = undefined;
                    }
                    if (appearanceSubscription !== undefined) {
                        appearanceSubscription.unsubscribe();
                        appearanceSubscription = undefined;
                        resolve();
                    }
                });
                timeoutTimer = setTimeout(() => {
                    if (appearanceSubscription !== undefined) {
                        appearanceSubscription.unsubscribe();
                        appearanceSubscription = undefined;
                    }
                    if (timeoutTimer !== undefined) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = undefined;
                        reject(new Error('Timeout'));
                    }
                }, timeout);
                if (this.agent.appearanceComplete) {
                    if (appearanceSubscription !== undefined) {
                        appearanceSubscription.unsubscribe();
                        appearanceSubscription = undefined;
                    }
                    if (timeoutTimer !== undefined) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = undefined;
                    }
                    resolve();
                }
            }
        });
    }
    // noinspection JSUnusedGlobalSymbols
    getAvatar(avatarID = UUID_1.UUID.zero()) {
        if (typeof avatarID === 'string') {
            avatarID = new UUID_1.UUID(avatarID);
        }
        else if (avatarID.isZero()) {
            avatarID = this.agent.agentID;
        }
        return this.currentRegion.agents.get(avatarID.toString());
    }
    // noinspection JSUnusedGlobalSymbols
    async getAvatarProperties(avatarID) {
        if (typeof avatarID === 'string') {
            avatarID = new UUID_1.UUID(avatarID);
        }
        const msg = new AvatarPropertiesRequest_1.AvatarPropertiesRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID,
            AvatarID: avatarID
        };
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const avatarPropertiesReply = (await this.circuit.waitForMessage(Message_1.Message.AvatarPropertiesReply, 10000, (packet) => {
            if (packet.AgentData.AvatarID.equals(avatarID)) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        }));
        return new class {
            ImageID = avatarPropertiesReply.PropertiesData.ImageID;
            FLImageID = avatarPropertiesReply.PropertiesData.FLImageID;
            PartnerID = avatarPropertiesReply.PropertiesData.PartnerID;
            AboutText = Utils_1.Utils.BufferToStringSimple(avatarPropertiesReply.PropertiesData.AboutText);
            FLAboutText = Utils_1.Utils.BufferToStringSimple(avatarPropertiesReply.PropertiesData.FLAboutText);
            BornOn = Utils_1.Utils.BufferToStringSimple(avatarPropertiesReply.PropertiesData.BornOn);
            ProfileURL = Utils_1.Utils.BufferToStringSimple(avatarPropertiesReply.PropertiesData.ProfileURL);
            CharterMember = parseInt(Utils_1.Utils.BufferToStringSimple(avatarPropertiesReply.PropertiesData.CharterMember), 10); // avatarPropertiesReply.PropertiesData.CharterMember;
            Flags = avatarPropertiesReply.PropertiesData.Flags;
        };
    }
    async animate(anim, run) {
        const { circuit } = this.currentRegion;
        const animPacket = new AgentAnimation_1.AgentAnimationMessage();
        animPacket.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID
        };
        animPacket.PhysicalAvatarEventList = [];
        animPacket.AnimationList = [];
        for (const a of anim) {
            animPacket.AnimationList.push({
                AnimID: a,
                StartAnim: run
            });
        }
        await circuit.waitForAck(circuit.sendMessage(animPacket, PacketFlags_1.PacketFlags.Reliable), 10000);
    }
}
exports.AgentCommands = AgentCommands;
//# sourceMappingURL=AgentCommands.js.map