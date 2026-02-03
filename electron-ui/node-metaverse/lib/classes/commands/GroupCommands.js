"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupCommands = void 0;
const CommandsBase_1 = require("./CommandsBase");
const UUID_1 = require("../UUID");
const InstantMessageDialog_1 = require("../../enums/InstantMessageDialog");
const Utils_1 = require("../Utils");
const PacketFlags_1 = require("../../enums/PacketFlags");
const ImprovedInstantMessage_1 = require("../messages/ImprovedInstantMessage");
const Vector3_1 = require("../Vector3");
const InviteGroupRequest_1 = require("../messages/InviteGroupRequest");
const GroupRole_1 = require("../GroupRole");
const GroupRoleDataRequest_1 = require("../messages/GroupRoleDataRequest");
const Message_1 = require("../../enums/Message");
const GroupMember_1 = require("../GroupMember");
const FilterResponse_1 = require("../../enums/FilterResponse");
const LLSD = __importStar(require("@caspertech/llsd"));
const EjectGroupMemberRequest_1 = require("../messages/EjectGroupMemberRequest");
const GroupProfileRequest_1 = require("../messages/GroupProfileRequest");
const GroupBanAction_1 = require("../../enums/GroupBanAction");
const GroupBan_1 = require("../GroupBan");
class GroupCommands extends CommandsBase_1.CommandsBase {
    async sendGroupNotice(groupID, subject, message) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        const { circuit } = this;
        const agentName = this.agent.firstName + ' ' + this.agent.lastName;
        const im = new ImprovedInstantMessage_1.ImprovedInstantMessageMessage();
        im.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID
        };
        im.MessageBlock = {
            FromGroup: false,
            ToAgentID: groupID,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: 0,
            Dialog: InstantMessageDialog_1.InstantMessageDialog.GroupNotice,
            ID: UUID_1.UUID.zero(),
            Timestamp: 0,
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(subject + '|' + message),
            BinaryBucket: Buffer.allocUnsafe(0)
        };
        im.EstateBlock = {
            EstateID: 0
        };
        const sequenceNo = circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        await circuit.waitForAck(sequenceNo, 10000);
    }
    async sendGroupInviteBulk(groupID, sendTo) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        const igr = new InviteGroupRequest_1.InviteGroupRequestMessage();
        igr.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        igr.GroupData = {
            GroupID: groupID
        };
        igr.InviteData = [];
        for (const to of sendTo) {
            if (typeof to.avatarID === 'string') {
                to.avatarID = new UUID_1.UUID(to.avatarID);
            }
            if (to.roleID === undefined) {
                to.roleID = UUID_1.UUID.zero();
            }
            if (typeof to.roleID === 'string') {
                to.roleID = new UUID_1.UUID(to.roleID);
            }
            igr.InviteData.push({
                InviteeID: to.avatarID,
                RoleID: to.roleID
            });
        }
        const sequenceNo = this.circuit.sendMessage(igr, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    getSessionAgentCount(sessionID) {
        if (typeof sessionID === 'string') {
            sessionID = new UUID_1.UUID(sessionID);
        }
        return this.agent.getSessionAgentCount(sessionID);
    }
    async sendGroupInvite(groupID, to, role) {
        const sendTo = [{
                avatarID: to,
                roleID: role
            }];
        await this.sendGroupInviteBulk(groupID, sendTo);
    }
    async acceptGroupInvite(event) {
        const { circuit } = this;
        const agentName = this.agent.firstName + ' ' + this.agent.lastName;
        const im = new ImprovedInstantMessage_1.ImprovedInstantMessageMessage();
        im.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID
        };
        im.MessageBlock = {
            FromGroup: false,
            ToAgentID: event.from,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: 0,
            Dialog: InstantMessageDialog_1.InstantMessageDialog.GroupInvitationAccept,
            ID: event.inviteID,
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(''),
            BinaryBucket: Buffer.allocUnsafe(0)
        };
        im.EstateBlock = {
            EstateID: 0
        };
        const sequenceNo = circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        await circuit.waitForAck(sequenceNo, 10000);
    }
    async rejectGroupInvite(event) {
        const { circuit } = this;
        const agentName = this.agent.firstName + ' ' + this.agent.lastName;
        const im = new ImprovedInstantMessage_1.ImprovedInstantMessageMessage();
        im.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID
        };
        im.MessageBlock = {
            FromGroup: false,
            ToAgentID: event.from,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: 0,
            Dialog: InstantMessageDialog_1.InstantMessageDialog.GroupInvitationDecline,
            ID: event.inviteID,
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(''),
            BinaryBucket: Buffer.allocUnsafe(0)
        };
        im.EstateBlock = {
            EstateID: 0
        };
        const sequenceNo = circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        await circuit.waitForAck(sequenceNo, 10000);
    }
    async unbanMembers(groupID, avatars) {
        return this.banMembers(groupID, avatars, GroupBanAction_1.GroupBanAction.Unban);
    }
    async banMembers(groupID, avatars, groupAction = GroupBanAction_1.GroupBanAction.Ban) {
        const listOfIDs = [];
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        if (Array.isArray(avatars)) {
            for (const av of avatars) {
                if (typeof av === 'string') {
                    listOfIDs.push(av);
                }
                else {
                    listOfIDs.push(av.toString());
                }
            }
        }
        else if (typeof avatars === 'string') {
            listOfIDs.push(avatars);
        }
        else {
            listOfIDs.push(avatars.toString());
        }
        const requestData = {
            'ban_action': groupAction,
            'ban_ids': []
        };
        for (const id of listOfIDs) {
            requestData.ban_ids.push(new LLSD.UUID(id));
        }
        await this.currentRegion.caps.capsPostXML(['GroupAPIv1', { 'group_id': groupID.toString() }], requestData);
    }
    async getBanList(groupID) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        const result = await this.currentRegion.caps.capsGetXML(['GroupAPIv1', { 'group_id': groupID.toString() }]);
        const bans = [];
        if (result.ban_list !== undefined) {
            for (const k of Object.keys(result.ban_list)) {
                bans.push(new GroupBan_1.GroupBan(new UUID_1.UUID(k), result.ban_list[k].ban_date));
            }
        }
        return bans;
    }
    async getMemberList(groupID) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        const result = [];
        const requestData = {
            'group_id': new LLSD.UUID(groupID.toString())
        };
        const response = await this.currentRegion.caps.capsPostXML('GroupMemberData', requestData);
        if (response.members !== undefined) {
            for (const uuid of Object.keys(response.members)) {
                const member = new GroupMember_1.GroupMember();
                const data = response.members[uuid];
                member.AgentID = new UUID_1.UUID(uuid);
                member.OnlineStatus = data.last_login;
                let powers = response.defaults.default_powers;
                if (data.powers) {
                    powers = data.powers;
                }
                member.IsOwner = data.owner === 'Y';
                let titleIndex = 0;
                if (data.title) {
                    titleIndex = data.title;
                }
                member.Title = response.titles[titleIndex];
                member.AgentPowers = Utils_1.Utils.HexToLong(powers);
                result.push(member);
            }
            return result;
        }
        else {
            throw new Error('Bad response');
        }
    }
    async getGroupRoles(groupID) {
        const result = [];
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        const grdr = new GroupRoleDataRequest_1.GroupRoleDataRequestMessage();
        grdr.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        const requestID = UUID_1.UUID.random();
        grdr.GroupData = {
            GroupID: groupID,
            RequestID: requestID
        };
        let totalRoleCount = 0;
        this.circuit.sendMessage(grdr, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForMessage(Message_1.Message.GroupRoleDataReply, 10000, (gmr) => {
            if (gmr.GroupData.RequestID.toString() === requestID.toString()) {
                totalRoleCount = gmr.GroupData.RoleCount;
                for (const role of gmr.RoleData) {
                    const gr = new GroupRole_1.GroupRole();
                    gr.RoleID = role.RoleID;
                    gr.Name = Utils_1.Utils.BufferToStringSimple(role.Name);
                    gr.Title = Utils_1.Utils.BufferToStringSimple(role.Title);
                    gr.Description = Utils_1.Utils.BufferToStringSimple(role.Description);
                    gr.Powers = role.Powers;
                    gr.Members = role.Members;
                    result.push(gr);
                }
                if (totalRoleCount > result.length) {
                    return FilterResponse_1.FilterResponse.Match;
                }
                else {
                    return FilterResponse_1.FilterResponse.Finish;
                }
            }
            else {
                return FilterResponse_1.FilterResponse.NoMatch;
            }
        });
        return result;
    }
    async ejectFromGroupBulk(groupID, sendTo) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        const msg = new EjectGroupMemberRequest_1.EjectGroupMemberRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.GroupData = {
            GroupID: groupID
        };
        msg.EjectData = [];
        for (let ejecteeID of sendTo) {
            if (typeof ejecteeID === 'string') {
                ejecteeID = new UUID_1.UUID(ejecteeID);
            }
            msg.EjectData.push({
                EjecteeID: ejecteeID
            });
        }
        ;
        const sequenceNo = this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    async ejectFromGroup(groupID, ejecteeID) {
        if (typeof ejecteeID === 'string') {
            ejecteeID = new UUID_1.UUID(ejecteeID);
        }
        const sendTo = [ejecteeID];
        await this.ejectFromGroupBulk(groupID, sendTo);
    }
    async getGroupProfile(groupID) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        const msg = new GroupProfileRequest_1.GroupProfileRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.GroupData = {
            GroupID: groupID
        };
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const groupProfileReply = (await this.circuit.waitForMessage(Message_1.Message.GroupProfileReply, 10000, (packet) => {
            const replyMessage = packet;
            if (replyMessage.GroupData.GroupID.equals(groupID)) {
                console.log('groupProfileReply Finish');
                return FilterResponse_1.FilterResponse.Finish;
            }
            console.log('groupProfileReply NoMatch');
            return FilterResponse_1.FilterResponse.NoMatch;
        }));
        return new class {
            GroupID = groupProfileReply.GroupData.GroupID;
            Name = Utils_1.Utils.BufferToStringSimple(groupProfileReply.GroupData.Name);
            Charter = Utils_1.Utils.BufferToStringSimple(groupProfileReply.GroupData.Charter);
            ShowInList = groupProfileReply.GroupData.ShowInList;
            MemberTitle = Utils_1.Utils.BufferToStringSimple(groupProfileReply.GroupData.MemberTitle);
            PowersMask = groupProfileReply.GroupData.PowersMask;
            InsigniaID = groupProfileReply.GroupData.InsigniaID;
            FounderID = groupProfileReply.GroupData.FounderID;
            MembershipFee = groupProfileReply.GroupData.MembershipFee;
            OpenEnrollment = groupProfileReply.GroupData.OpenEnrollment;
            Money = groupProfileReply.GroupData.Money;
            GroupMembershipCount = groupProfileReply.GroupData.GroupMembershipCount;
            GroupRolesCount = groupProfileReply.GroupData.GroupRolesCount;
            AllowPublish = groupProfileReply.GroupData.AllowPublish;
            MaturePublish = groupProfileReply.GroupData.MaturePublish;
            OwnerRole = groupProfileReply.GroupData.OwnerRole;
        };
    }
}
exports.GroupCommands = GroupCommands;
//# sourceMappingURL=GroupCommands.js.map