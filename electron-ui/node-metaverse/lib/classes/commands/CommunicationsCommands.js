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
exports.CommunicationsCommands = void 0;
const LLSD = __importStar(require("@caspertech/llsd"));
const AssetType_1 = require("../../enums/AssetType");
const ChatType_1 = require("../../enums/ChatType");
const FilterResponse_1 = require("../../enums/FilterResponse");
const InstantMessageDialog_1 = require("../../enums/InstantMessageDialog");
const InstantMessageOnline_1 = require("../../enums/InstantMessageOnline");
const PacketFlags_1 = require("../../enums/PacketFlags");
const InventoryItem_1 = require("../InventoryItem");
const ChatFromViewer_1 = require("../messages/ChatFromViewer");
const ImprovedInstantMessage_1 = require("../messages/ImprovedInstantMessage");
const ScriptDialogReply_1 = require("../messages/ScriptDialogReply");
const StartLure_1 = require("../messages/StartLure");
const Utils_1 = require("../Utils");
const UUID_1 = require("../UUID");
const Vector3_1 = require("../Vector3");
const CommandsBase_1 = require("./CommandsBase");
class CommunicationsCommands extends CommandsBase_1.CommandsBase {
    async giveInventory(to, itemOrFolder) {
        const { circuit } = this;
        if (typeof to === 'string') {
            to = new UUID_1.UUID(to);
        }
        let bucket = undefined;
        if (itemOrFolder instanceof InventoryItem_1.InventoryItem) {
            bucket = Buffer.allocUnsafe(17);
            bucket.writeUInt8(itemOrFolder.type, 0);
            itemOrFolder.itemID.writeToBuffer(bucket, 1);
        }
        else {
            await itemOrFolder.populate(false);
            bucket = Buffer.allocUnsafe(17 * (itemOrFolder.items.length + 1));
            let offset = 0;
            bucket.writeUInt8(AssetType_1.AssetType.Category, offset++);
            itemOrFolder.folderID.writeToBuffer(bucket, offset);
            offset += 16;
            for (const item of itemOrFolder.items) {
                bucket.writeUInt8(item.type, offset++);
                item.itemID.writeToBuffer(bucket, offset);
                offset += 16;
            }
        }
        const agentName = this.agent.firstName + ' ' + this.agent.lastName;
        const im = new ImprovedInstantMessage_1.ImprovedInstantMessageMessage();
        im.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID
        };
        im.MessageBlock = {
            FromGroup: false,
            ToAgentID: to,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: InstantMessageOnline_1.InstantMessageOnline.Online,
            Dialog: InstantMessageDialog_1.InstantMessageDialog.InventoryOffered,
            ID: UUID_1.UUID.random(),
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(itemOrFolder.name),
            BinaryBucket: bucket
        };
        im.EstateBlock = {
            EstateID: 0
        };
        const sequenceNo = circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        await circuit.waitForAck(sequenceNo, 10000);
    }
    async sendInstantMessage(to, message) {
        const { circuit } = this;
        if (typeof to === 'string') {
            to = new UUID_1.UUID(to);
        }
        const agentName = this.agent.firstName + ' ' + this.agent.lastName;
        const im = new ImprovedInstantMessage_1.ImprovedInstantMessageMessage();
        im.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID
        };
        im.MessageBlock = {
            FromGroup: false,
            ToAgentID: to,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: 1,
            Dialog: 0,
            ID: UUID_1.UUID.zero(),
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(message),
            BinaryBucket: Buffer.allocUnsafe(0)
        };
        im.EstateBlock = {
            EstateID: 0
        };
        const sequenceNo = circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        await circuit.waitForAck(sequenceNo, 10000);
    }
    async nearbyChat(message, type, channel) {
        if (channel === undefined) {
            channel = 0;
        }
        const cfv = new ChatFromViewer_1.ChatFromViewerMessage();
        cfv.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        cfv.ChatData = {
            Message: Utils_1.Utils.StringToBuffer(message),
            Type: type,
            Channel: channel
        };
        const sequenceNo = this.circuit.sendMessage(cfv, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    async say(message, channel) {
        await this.nearbyChat(message, ChatType_1.ChatType.Normal, channel);
    }
    async whisper(message, channel) {
        await this.nearbyChat(message, ChatType_1.ChatType.Whisper, channel);
    }
    async shout(message, channel) {
        await this.nearbyChat(message, ChatType_1.ChatType.Shout, channel);
    }
    async startTypingLocal() {
        const cfv = new ChatFromViewer_1.ChatFromViewerMessage();
        cfv.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        cfv.ChatData = {
            Message: Buffer.allocUnsafe(0),
            Type: ChatType_1.ChatType.StartTyping,
            Channel: 0
        };
        const sequenceNo = this.circuit.sendMessage(cfv, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    async sendTeleport(target, message) {
        if (typeof target === 'string') {
            target = new UUID_1.UUID(target);
        }
        if (message === undefined) {
            message = 'Join me in ' + this.currentRegion.regionName;
        }
        const p = new StartLure_1.StartLureMessage();
        p.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        p.Info = {
            LureType: 0,
            Message: Utils_1.Utils.StringToBuffer(message)
        };
        p.TargetData = [{
                TargetID: target
            }];
        const sequenceNo = this.circuit.sendMessage(p, PacketFlags_1.PacketFlags.Reliable);
        return this.circuit.waitForAck(sequenceNo, 10000);
    }
    async stopTypingLocal() {
        const cfv = new ChatFromViewer_1.ChatFromViewerMessage();
        cfv.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        cfv.ChatData = {
            Message: Buffer.allocUnsafe(0),
            Type: ChatType_1.ChatType.StopTyping,
            Channel: 0
        };
        const sequenceNo = this.circuit.sendMessage(cfv, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    async startTypingIM(to) {
        if (typeof to === 'string') {
            to = new UUID_1.UUID(to);
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
            ToAgentID: to,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: 0,
            Dialog: InstantMessageDialog_1.InstantMessageDialog.StartTyping,
            ID: UUID_1.UUID.zero(),
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
    async stopTypingIM(to) {
        if (typeof to === 'string') {
            to = new UUID_1.UUID(to);
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
            ToAgentID: to,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: 0,
            Dialog: InstantMessageDialog_1.InstantMessageDialog.StopTyping,
            ID: UUID_1.UUID.zero(),
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
    async typeInstantMessage(to, message, thinkingTime, charactersPerSecond) {
        if (thinkingTime === undefined) {
            thinkingTime = 2000;
        }
        await Utils_1.Utils.sleep(thinkingTime);
        if (typeof to === 'string') {
            to = new UUID_1.UUID(to);
        }
        let typeTimer = null;
        await this.startTypingIM(to);
        typeTimer = setInterval(() => {
            // Send a new typing message ever 5 secs
            // or it will time out at the other end
            void this.startTypingIM(to);
        }, 5000);
        if (charactersPerSecond === undefined) {
            charactersPerSecond = 5;
        }
        const timeToWait = (message.length / charactersPerSecond) * 1000;
        await Utils_1.Utils.sleep(timeToWait);
        if (typeTimer !== null) {
            clearInterval(typeTimer);
            typeTimer = null;
        }
        await this.stopTypingIM(to);
        await this.sendInstantMessage(to, message);
    }
    async typeLocalMessage(message, thinkingTime, charactersPerSecond) {
        if (thinkingTime === undefined) {
            thinkingTime = 0;
        }
        await Utils_1.Utils.sleep(thinkingTime);
        await this.startTypingLocal();
        await this.bot.clientCommands.agent.startAnimations([new UUID_1.UUID('c541c47f-e0c0-058b-ad1a-d6ae3a4584d9')]);
        if (charactersPerSecond === undefined) {
            charactersPerSecond = 5;
        }
        const timeToWait = (message.length / charactersPerSecond) * 1000;
        await Utils_1.Utils.sleep(timeToWait);
        await this.stopTypingLocal();
        await this.bot.clientCommands.agent.stopAnimations([new UUID_1.UUID('c541c47f-e0c0-058b-ad1a-d6ae3a4584d9')]);
        await this.say(message);
    }
    async endGroupChatSession(groupID) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        if (!this.agent.hasChatSession(groupID)) {
            throw new Error('Group session does not exist');
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
            Dialog: InstantMessageDialog_1.InstantMessageDialog.SessionDrop,
            ID: groupID,
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Buffer.allocUnsafe(0),
            BinaryBucket: Buffer.allocUnsafe(0)
        };
        im.EstateBlock = {
            EstateID: 0
        };
        this.agent.deleteChatSession(groupID);
        const sequenceNo = this.circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        return this.circuit.waitForAck(sequenceNo, 10000);
    }
    async startGroupChatSession(groupID, message) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        if (this.agent.hasChatSession(groupID)) {
            return;
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
            Dialog: InstantMessageDialog_1.InstantMessageDialog.SessionGroupStart,
            ID: groupID,
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(message),
            BinaryBucket: Utils_1.Utils.StringToBuffer('')
        };
        im.EstateBlock = {
            EstateID: 0
        };
        circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        await Utils_1.Utils.waitOrTimeOut(this.currentRegion.clientEvents.onGroupChatSessionJoin, 10000, (event) => {
            if (event.sessionID.toString() === groupID.toString()) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
    }
    async moderateGroupChat(groupID, memberID, muteText, muteVoice) {
        if (typeof groupID === 'object') {
            groupID = groupID.toString();
        }
        if (typeof memberID === 'object') {
            memberID = memberID.toString();
        }
        await this.startGroupChatSession(groupID, '');
        const requested = {
            'method': 'mute update',
            'params': {
                'agent_id': new LLSD.UUID(memberID),
                'mute_info': {
                    'voice': muteVoice,
                    'text': muteText
                }
            },
            'session-id': new LLSD.UUID(groupID),
        };
        return this.currentRegion.caps.capsPostXML('ChatSessionRequest', requested);
    }
    async sendGroupMessage(groupID, message) {
        if (typeof groupID === 'string') {
            groupID = new UUID_1.UUID(groupID);
        }
        if (!this.agent.hasChatSession(groupID)) {
            await this.startGroupChatSession(groupID, message);
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
            Dialog: InstantMessageDialog_1.InstantMessageDialog.SessionSend,
            ID: groupID,
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(message),
            BinaryBucket: Utils_1.Utils.StringToBuffer('')
        };
        im.EstateBlock = {
            EstateID: 0
        };
        const sequenceNo = circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
        return this.bot.clientCommands.group.getSessionAgentCount(groupID);
    }
    async respondToScriptDialog(event, buttonIndex) {
        const dialog = new ScriptDialogReply_1.ScriptDialogReplyMessage();
        dialog.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        dialog.Data = {
            ObjectID: event.ObjectID,
            ChatChannel: event.ChatChannel,
            ButtonIndex: buttonIndex,
            ButtonLabel: Utils_1.Utils.StringToBuffer(event.Buttons[buttonIndex])
        };
        const sequenceNo = this.circuit.sendMessage(dialog, PacketFlags_1.PacketFlags.Reliable);
        return this.circuit.waitForAck(sequenceNo, 10000);
    }
}
exports.CommunicationsCommands = CommunicationsCommands;
//# sourceMappingURL=CommunicationsCommands.js.map