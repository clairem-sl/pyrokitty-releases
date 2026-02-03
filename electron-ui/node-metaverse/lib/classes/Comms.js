"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Comms = void 0;
const GroupChatClosedEvent_1 = require("../events/GroupChatClosedEvent");
const Message_1 = require("../enums/Message");
const Utils_1 = require("./Utils");
const InstantMessageDialog_1 = require("../enums/InstantMessageDialog");
const InstantMessageEvent_1 = require("../events/InstantMessageEvent");
const ChatSourceType_1 = require("../enums/ChatSourceType");
const InstantMessageEventFlags_1 = require("../enums/InstantMessageEventFlags");
const GroupInviteEvent_1 = require("../events/GroupInviteEvent");
const InventoryOfferedEvent_1 = require("../events/InventoryOfferedEvent");
const LureEvent_1 = require("../events/LureEvent");
const UUID_1 = require("./UUID");
const GroupNoticeEvent_1 = require("../events/GroupNoticeEvent");
const FriendRequestEvent_1 = require("../events/FriendRequestEvent");
const FriendResponseEvent_1 = require("../events/FriendResponseEvent");
const GroupChatEvent_1 = require("../events/GroupChatEvent");
const ChatEvent_1 = require("../events/ChatEvent");
const ScriptDialogEvent_1 = require("../events/ScriptDialogEvent");
const InventoryResponseEvent_1 = require("../events/InventoryResponseEvent");
class Comms {
    circuit;
    agent;
    clientEvents;
    groupChatExpiredSub;
    constructor(circuit, agent, clientEvents) {
        this.circuit = circuit;
        this.agent = agent;
        this.clientEvents = clientEvents;
        this.groupChatExpiredSub = this.agent.onGroupChatExpired.subscribe((groupID) => {
            this.groupChatExpired(groupID).catch((_e) => {
                // ignore
            });
        });
        this.circuit.subscribeToMessages([
            Message_1.Message.ImprovedInstantMessage,
            Message_1.Message.ChatFromSimulator,
            Message_1.Message.AlertMessage,
            Message_1.Message.ScriptDialog
        ], (packet) => {
            switch (packet.message.id) {
                case Message_1.Message.ImprovedInstantMessage:
                    {
                        const im = packet.message;
                        switch (im.MessageBlock.Dialog) {
                            case InstantMessageDialog_1.InstantMessageDialog.MessageFromAgent:
                                {
                                    const imEvent = new InstantMessageEvent_1.InstantMessageEvent();
                                    imEvent.source = ChatSourceType_1.ChatSourceType.Agent;
                                    imEvent.from = im.AgentData.AgentID;
                                    imEvent.owner = im.AgentData.AgentID;
                                    imEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    imEvent.message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    imEvent.flags = InstantMessageEventFlags_1.InstantMessageEventFlags.normal;
                                    this.clientEvents.onInstantMessage.next(imEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.MessageBox:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.GroupInvitation:
                                {
                                    const giEvent = new GroupInviteEvent_1.GroupInviteEvent();
                                    giEvent.from = im.AgentData.AgentID;
                                    giEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    giEvent.message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    giEvent.inviteID = im.MessageBlock.ID;
                                    this.clientEvents.onGroupInvite.next(giEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.InventoryOffered:
                                {
                                    const fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    const inventoryMessage = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    const ioEvent = new InventoryOfferedEvent_1.InventoryOfferedEvent();
                                    ioEvent.from = im.AgentData.AgentID;
                                    ioEvent.fromName = fromName;
                                    ioEvent.message = inventoryMessage;
                                    ioEvent.requestID = im.MessageBlock.ID;
                                    ioEvent.source = ChatSourceType_1.ChatSourceType.Agent;
                                    this.clientEvents.onInventoryOffered.next(ioEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.InventoryAccepted:
                                {
                                    const irEvent = new InventoryResponseEvent_1.InventoryResponseEvent();
                                    irEvent.from = im.AgentData.AgentID;
                                    irEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    irEvent.message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    irEvent.requestID = im.MessageBlock.ID;
                                    irEvent.accepted = true;
                                    this.clientEvents.onInventoryResponse.next(irEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.InventoryDeclined:
                                {
                                    const irEvent = new InventoryResponseEvent_1.InventoryResponseEvent();
                                    irEvent.from = im.AgentData.AgentID;
                                    irEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    irEvent.message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    irEvent.requestID = im.MessageBlock.ID;
                                    irEvent.accepted = false;
                                    this.clientEvents.onInventoryResponse.next(irEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.TaskInventoryOffered:
                                {
                                    const fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    const inventoryMessage = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    const ioEvent = new InventoryOfferedEvent_1.InventoryOfferedEvent();
                                    ioEvent.from = im.AgentData.AgentID;
                                    ioEvent.fromName = fromName;
                                    ioEvent.message = inventoryMessage;
                                    ioEvent.requestID = im.MessageBlock.ID;
                                    ioEvent.source = ChatSourceType_1.ChatSourceType.Object;
                                    ioEvent.type = im.MessageBlock.BinaryBucket.readUInt8(0);
                                    this.clientEvents.onInventoryOffered.next(ioEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.TaskInventoryAccepted:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.TaskInventoryDeclined:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.MessageFromObject:
                                {
                                    const imEvent = new InstantMessageEvent_1.InstantMessageEvent();
                                    imEvent.source = ChatSourceType_1.ChatSourceType.Object;
                                    imEvent.owner = im.AgentData.AgentID;
                                    imEvent.from = im.MessageBlock.ID;
                                    imEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    imEvent.message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    imEvent.flags = InstantMessageEventFlags_1.InstantMessageEventFlags.normal;
                                    this.clientEvents.onInstantMessage.next(imEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.BusyAutoResponse:
                                {
                                    const imEvent = new InstantMessageEvent_1.InstantMessageEvent();
                                    imEvent.source = ChatSourceType_1.ChatSourceType.Agent;
                                    imEvent.from = im.AgentData.AgentID;
                                    imEvent.owner = im.AgentData.AgentID;
                                    imEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    imEvent.message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    imEvent.flags = InstantMessageEventFlags_1.InstantMessageEventFlags.busyResponse;
                                    this.clientEvents.onInstantMessage.next(imEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.ConsoleAndChatHistory:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.RequestTeleport:
                                {
                                    const lureEvent = new LureEvent_1.LureEvent();
                                    const extraData = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.BinaryBucket).split('|');
                                    lureEvent.from = im.AgentData.AgentID;
                                    lureEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    lureEvent.lureMessage = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    lureEvent.regionID = im.MessageBlock.RegionID;
                                    lureEvent.position = im.MessageBlock.Position;
                                    lureEvent.lureID = im.MessageBlock.ID;
                                    lureEvent.gridX = parseInt(extraData[0], 10);
                                    lureEvent.gridY = parseInt(extraData[1], 10);
                                    this.clientEvents.onLure.next(lureEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.AcceptTeleport:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.DenyTeleport:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.RequestLure:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.GotoUrl:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.FromTaskAsAlert:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.GroupNotice:
                                {
                                    const groupNoticeEvent = new GroupNoticeEvent_1.GroupNoticeEvent();
                                    groupNoticeEvent.from = im.AgentData.AgentID;
                                    groupNoticeEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    groupNoticeEvent.groupID = new UUID_1.UUID(im.MessageBlock.BinaryBucket, 2);
                                    const message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message).split('|');
                                    groupNoticeEvent.subject = message[0];
                                    if (message.length > 1) {
                                        groupNoticeEvent.message = message[1];
                                    }
                                    this.clientEvents.onGroupNotice.next(groupNoticeEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.GroupNoticeInventoryAccepted:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.GroupNoticeInventoryDeclined:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.GroupInvitationAccept:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.GroupInvitationDecline:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.GroupNoticeRequested:
                                break;
                            case InstantMessageDialog_1.InstantMessageDialog.FriendshipOffered:
                                {
                                    const fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    const message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    const frEvent = new FriendRequestEvent_1.FriendRequestEvent();
                                    frEvent.from = im.AgentData.AgentID;
                                    frEvent.fromName = fromName;
                                    frEvent.message = message;
                                    frEvent.requestID = im.MessageBlock.ID;
                                    this.clientEvents.onFriendRequest.next(frEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.FriendshipAccepted:
                                {
                                    const fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    const message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    const frEvent = new FriendResponseEvent_1.FriendResponseEvent();
                                    frEvent.from = im.AgentData.AgentID;
                                    frEvent.fromName = fromName;
                                    frEvent.message = message;
                                    frEvent.requestID = im.MessageBlock.ID;
                                    frEvent.accepted = true;
                                    this.clientEvents.onFriendResponse.next(frEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.FriendshipDeclined:
                                {
                                    const fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    const message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    const frEvent = new FriendResponseEvent_1.FriendResponseEvent();
                                    frEvent.from = im.AgentData.AgentID;
                                    frEvent.fromName = fromName;
                                    frEvent.message = message;
                                    frEvent.requestID = im.MessageBlock.ID;
                                    frEvent.accepted = false;
                                    this.clientEvents.onFriendResponse.next(frEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.StartTyping:
                                {
                                    const imEvent = new InstantMessageEvent_1.InstantMessageEvent();
                                    imEvent.source = ChatSourceType_1.ChatSourceType.Agent;
                                    imEvent.from = im.AgentData.AgentID;
                                    imEvent.owner = im.AgentData.AgentID;
                                    imEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    imEvent.message = '';
                                    imEvent.flags = InstantMessageEventFlags_1.InstantMessageEventFlags.startTyping;
                                    this.clientEvents.onInstantMessage.next(imEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.StopTyping:
                                {
                                    const imEvent = new InstantMessageEvent_1.InstantMessageEvent();
                                    imEvent.source = ChatSourceType_1.ChatSourceType.Agent;
                                    imEvent.from = im.AgentData.AgentID;
                                    imEvent.owner = im.AgentData.AgentID;
                                    imEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    imEvent.message = '';
                                    imEvent.flags = InstantMessageEventFlags_1.InstantMessageEventFlags.finishTyping;
                                    this.clientEvents.onInstantMessage.next(imEvent);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.SessionDrop:
                                {
                                    const groupChatClosedEvent = new GroupChatClosedEvent_1.GroupChatClosedEvent();
                                    groupChatClosedEvent.groupID = im.MessageBlock.ID;
                                    this.clientEvents.onGroupChatClosed.next(groupChatClosedEvent);
                                    this.agent.deleteChatSession(groupChatClosedEvent.groupID);
                                    break;
                                }
                            case InstantMessageDialog_1.InstantMessageDialog.SessionSend:
                                {
                                    const groupChatEvent = new GroupChatEvent_1.GroupChatEvent();
                                    groupChatEvent.from = im.AgentData.AgentID;
                                    groupChatEvent.fromName = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.FromAgentName);
                                    groupChatEvent.groupID = im.MessageBlock.ID;
                                    groupChatEvent.message = Utils_1.Utils.BufferToStringSimple(im.MessageBlock.Message);
                                    if (!this.agent.hasChatSession(groupChatEvent.groupID)) {
                                        this.agent.addChatSession(groupChatEvent.groupID, true);
                                    }
                                    this.agent.updateLastMessage(groupChatEvent.groupID);
                                    this.clientEvents.onGroupChat.next(groupChatEvent);
                                    break;
                                }
                            default:
                                break;
                        }
                        break;
                    }
                case Message_1.Message.ChatFromSimulator:
                    {
                        const chat = packet.message;
                        const event = new ChatEvent_1.ChatEvent();
                        event.fromName = Utils_1.Utils.BufferToStringSimple(chat.ChatData.FromName);
                        event.message = Utils_1.Utils.BufferToStringSimple(chat.ChatData.Message);
                        event.from = chat.ChatData.SourceID;
                        event.ownerID = chat.ChatData.OwnerID;
                        event.chatType = chat.ChatData.ChatType;
                        event.sourceType = chat.ChatData.SourceType;
                        event.audible = chat.ChatData.Audible;
                        event.position = chat.ChatData.Position;
                        this.clientEvents.onNearbyChat.next(event);
                        break;
                    }
                case Message_1.Message.AlertMessage:
                    {
                        // TODO: this isn't finished
                        const alertm = packet.message;
                        const alertMessage = Utils_1.Utils.BufferToStringSimple(alertm.AlertData.Message);
                        console.log('AlertMessage: ' + alertMessage);
                        for (const info of alertm.AlertInfo) {
                            const alertInfoMessage = Utils_1.Utils.BufferToStringSimple(info.Message);
                            console.log('Alert info message: ' + alertInfoMessage);
                        }
                        break;
                    }
                case Message_1.Message.ScriptDialog:
                    {
                        const scriptd = packet.message;
                        const event = new ScriptDialogEvent_1.ScriptDialogEvent();
                        event.ObjectID = scriptd.Data.ObjectID;
                        event.FirstName = Utils_1.Utils.BufferToStringSimple(scriptd.Data.FirstName);
                        event.LastName = Utils_1.Utils.BufferToStringSimple(scriptd.Data.LastName);
                        event.ObjectName = Utils_1.Utils.BufferToStringSimple(scriptd.Data.ObjectName);
                        event.Message = Utils_1.Utils.BufferToStringSimple(scriptd.Data.Message);
                        event.ChatChannel = scriptd.Data.ChatChannel;
                        event.ImageID = scriptd.Data.ImageID;
                        event.Buttons = [];
                        event.Owners = [];
                        for (const button of scriptd.Buttons) {
                            event.Buttons.push(Utils_1.Utils.BufferToStringSimple(button.ButtonLabel));
                        }
                        for (const owner of scriptd.OwnerData) {
                            event.Owners.push(owner.OwnerID);
                        }
                        this.clientEvents.onScriptDialog.next(event);
                        break;
                    }
                default:
                    break;
            }
        });
    }
    shutdown() {
        if (this.groupChatExpiredSub !== undefined) {
            this.groupChatExpiredSub.unsubscribe();
            delete this.groupChatExpiredSub;
        }
    }
    async groupChatExpired(groupID) {
        // Reconnect to group chat since it's been idle for 15 minutes
        await this.agent.currentRegion.clientCommands.comms.endGroupChatSession(groupID);
        await this.agent.currentRegion.clientCommands.comms.startGroupChatSession(groupID, '');
    }
}
exports.Comms = Comms;
//# sourceMappingURL=Comms.js.map