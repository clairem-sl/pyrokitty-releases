"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FriendCommands = void 0;
const CommandsBase_1 = require("./CommandsBase");
const Message_1 = require("../../enums/Message");
const AcceptFriendship_1 = require("../messages/AcceptFriendship");
const ImprovedInstantMessage_1 = require("../messages/ImprovedInstantMessage");
const InstantMessageDialog_1 = require("../../enums/InstantMessageDialog");
const Utils_1 = require("../Utils");
const DeclineFriendship_1 = require("../messages/DeclineFriendship");
const FindAgent_1 = require("../messages/FindAgent");
const IPAddress_1 = require("../IPAddress");
const FilterResponse_1 = require("../../enums/FilterResponse");
const GrantUserRights_1 = require("../messages/GrantUserRights");
const Friend_1 = require("../public/Friend");
const RightsFlags_1 = require("../../enums/RightsFlags");
const FriendOnlineEvent_1 = require("../../events/FriendOnlineEvent");
const FriendRemovedEvent_1 = require("../../events/FriendRemovedEvent");
const FriendRightsEvent_1 = require("../../events/FriendRightsEvent");
const UUID_1 = require("../UUID");
const PacketFlags_1 = require("../../enums/PacketFlags");
const FolderType_1 = require("../../enums/FolderType");
const Vector3_1 = require("../Vector3");
class FriendCommands extends CommandsBase_1.CommandsBase {
    friendMessages;
    friendsList = new Map();
    constructor(region, agent, bot) {
        super(region, agent, bot);
        // FriendResponse is handled by Comms because it's part of the InstantMessageImproved module.
        // We don't handle it here because it's always accompanied by an OnlineNotificationMessage.
        this.friendMessages = this.circuit.subscribeToMessages([
            Message_1.Message.OnlineNotification,
            Message_1.Message.OfflineNotification,
            Message_1.Message.TerminateFriendship,
            Message_1.Message.ChangeUserRights
        ], (packet) => {
            void this.processPacket(packet);
        });
    }
    // noinspection JSUnusedGlobalSymbols
    async grantFriendRights(friend, rights) {
        let friendKey = UUID_1.UUID.zero();
        if (friend instanceof UUID_1.UUID) {
            friendKey = friend;
        }
        else if (friend instanceof Friend_1.Friend) {
            friendKey = friend.getKey();
        }
        else {
            friendKey = new UUID_1.UUID(friend);
        }
        const request = new GrantUserRights_1.GrantUserRightsMessage();
        request.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        request.Rights = [
            {
                'AgentRelated': friendKey,
                'RelatedRights': rights
            }
        ];
        const sequenceNo = this.circuit.sendMessage(request, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    async getFriendMapLocation(friend) {
        let friendKey = UUID_1.UUID.zero();
        if (friend instanceof UUID_1.UUID) {
            friendKey = friend;
        }
        else if (friend instanceof Friend_1.Friend) {
            friendKey = friend.getKey();
        }
        else {
            friendKey = new UUID_1.UUID(friend);
        }
        const request = new FindAgent_1.FindAgentMessage();
        request.AgentBlock = {
            'Hunter': this.agent.agentID,
            'Prey': friendKey,
            'SpaceIP': IPAddress_1.IPAddress.zero()
        };
        request.LocationBlock = [
            {
                GlobalX: 0.0,
                GlobalY: 0.0
            }
        ];
        this.circuit.sendMessage(request, PacketFlags_1.PacketFlags.Reliable);
        const response = await this.circuit.waitForMessage(Message_1.Message.FindAgent, 10000, (filterMsg) => {
            if (filterMsg.AgentBlock.Hunter.equals(this.agent.agentID) && filterMsg.AgentBlock.Prey.equals(friendKey)) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        const globalPos = Utils_1.Utils.RegionCoordinatesToHandle(response.LocationBlock[0].GlobalX, response.LocationBlock[0].GlobalY);
        const mapInfo = await this.bot.clientCommands.grid.getRegionMapInfo(globalPos.regionX, globalPos.regionY);
        return {
            'regionName': mapInfo.block.name,
            'mapImage': mapInfo.block.mapImage,
            'regionHandle': globalPos.regionHandle,
            'regionX': globalPos.regionX,
            'regionY': globalPos.regionY,
            'localX': Math.floor(globalPos.localX),
            'localY': Math.floor(globalPos.localY),
            'avatars': mapInfo.avatars
        };
    }
    // noinspection JSUnusedGlobalSymbols
    getFriend(key) {
        return this.friendsList.get(key.toString());
    }
    async acceptFriendRequest(event) {
        const accept = new AcceptFriendship_1.AcceptFriendshipMessage();
        accept.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        accept.TransactionBlock = {
            TransactionID: event.requestID
        };
        accept.FolderData = [];
        accept.FolderData.push({
            'FolderID': this.agent.inventory.findFolderForType(FolderType_1.FolderType.CallingCard)
        });
        const sequenceNo = this.circuit.sendMessage(accept, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    async rejectFriendRequest(event) {
        const reject = new DeclineFriendship_1.DeclineFriendshipMessage();
        reject.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        reject.TransactionBlock = {
            TransactionID: event.requestID
        };
        const sequenceNo = this.circuit.sendMessage(reject, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    async sendFriendRequest(to, message) {
        if (typeof to === 'string') {
            to = new UUID_1.UUID(to);
        }
        const requestID = UUID_1.UUID.random();
        const agentName = this.agent.firstName + ' ' + this.agent.lastName;
        const im = new ImprovedInstantMessage_1.ImprovedInstantMessageMessage();
        im.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        im.MessageBlock = {
            FromGroup: false,
            ToAgentID: to,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: 0,
            Dialog: InstantMessageDialog_1.InstantMessageDialog.FriendshipOffered,
            ID: requestID,
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(message),
            BinaryBucket: Utils_1.Utils.StringToBuffer('')
        };
        im.EstateBlock = {
            EstateID: 0
        };
        const sequenceNo = this.circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForAck(sequenceNo, 10000);
    }
    shutdown() {
        if (this.friendMessages) {
            this.friendMessages.unsubscribe();
            delete this.friendMessages;
        }
    }
    async processPacket(packet) {
        switch (packet.message.id) {
            case Message_1.Message.OnlineNotification:
                {
                    const msg = packet.message;
                    for (const agentEntry of msg.AgentBlock) {
                        const uuidStr = agentEntry.AgentID.toString();
                        if (this.friendsList.has(uuidStr) === undefined) {
                            const friend = await this.bot.clientCommands.grid.avatarKey2Name(agentEntry.AgentID);
                            friend.online = false;
                            friend.myRights = RightsFlags_1.RightsFlags.None;
                            friend.theirRights = RightsFlags_1.RightsFlags.None;
                            this.friendsList.set(uuidStr, friend);
                        }
                        const friend = this.friendsList.get(uuidStr);
                        if (friend && !friend.online) {
                            friend.online = true;
                            const friendOnlineEvent = new FriendOnlineEvent_1.FriendOnlineEvent();
                            friendOnlineEvent.friend = friend;
                            friendOnlineEvent.online = true;
                            this.bot.clientEvents.onFriendOnline.next(friendOnlineEvent);
                        }
                    }
                    break;
                }
            case Message_1.Message.OfflineNotification:
                {
                    const msg = packet.message;
                    for (const agentEntry of msg.AgentBlock) {
                        const uuidStr = agentEntry.AgentID.toString();
                        if (this.friendsList.has(uuidStr) === undefined) {
                            const friend = await this.bot.clientCommands.grid.avatarKey2Name(agentEntry.AgentID);
                            friend.online = false;
                            friend.myRights = RightsFlags_1.RightsFlags.None;
                            friend.theirRights = RightsFlags_1.RightsFlags.None;
                            this.friendsList.set(uuidStr, friend);
                        }
                        const friend = this.friendsList.get(uuidStr);
                        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
                        if (friend !== undefined && friend.online) {
                            friend.online = false;
                            const friendOnlineEvent = new FriendOnlineEvent_1.FriendOnlineEvent();
                            friendOnlineEvent.friend = friend;
                            friendOnlineEvent.online = false;
                            this.bot.clientEvents.onFriendOnline.next(friendOnlineEvent);
                        }
                    }
                    break;
                }
            case Message_1.Message.TerminateFriendship:
                {
                    const msg = packet.message;
                    const friendID = msg.ExBlock.OtherID;
                    const uuidStr = friendID.toString();
                    const friend = this.friendsList.get(uuidStr);
                    if (friend !== undefined) {
                        const event = new FriendRemovedEvent_1.FriendRemovedEvent();
                        event.friend = friend;
                        this.bot.clientEvents.onFriendRemoved.next(event);
                        this.friendsList.delete(uuidStr);
                    }
                    break;
                }
            case Message_1.Message.ChangeUserRights:
                {
                    const msg = packet.message;
                    for (const rightsEntry of msg.Rights) {
                        let uuidStr = '';
                        if (rightsEntry.AgentRelated.equals(this.agent.agentID)) {
                            // My rights
                            uuidStr = msg.AgentData.AgentID.toString();
                            if (!this.friendsList.has(uuidStr)) {
                                const friend = await this.bot.clientCommands.grid.avatarKey2Name(rightsEntry.AgentRelated);
                                friend.online = false;
                                friend.myRights = RightsFlags_1.RightsFlags.None;
                                friend.theirRights = RightsFlags_1.RightsFlags.None;
                                this.friendsList.set(uuidStr, friend);
                            }
                            const friend = this.friendsList.get(uuidStr);
                            if (friend !== undefined) {
                                friend.myRights = rightsEntry.RelatedRights;
                            }
                        }
                        else {
                            uuidStr = rightsEntry.AgentRelated.toString();
                            if (!this.friendsList.has(uuidStr)) {
                                const friend = await this.bot.clientCommands.grid.avatarKey2Name(rightsEntry.AgentRelated);
                                friend.online = false;
                                friend.myRights = RightsFlags_1.RightsFlags.None;
                                friend.theirRights = RightsFlags_1.RightsFlags.None;
                                this.friendsList.set(uuidStr, friend);
                            }
                            const friend = this.friendsList.get(uuidStr);
                            if (friend !== undefined) {
                                friend.theirRights = rightsEntry.RelatedRights;
                            }
                        }
                        const friend = this.friendsList.get(uuidStr);
                        if (friend) {
                            const friendRightsEvent = new FriendRightsEvent_1.FriendRightsEvent();
                            friendRightsEvent.friend = friend;
                            friendRightsEvent.theirRights = friend.theirRights;
                            friendRightsEvent.myRights = friend.myRights;
                            this.bot.clientEvents.onFriendRights.next(friendRightsEvent);
                        }
                    }
                    break;
                }
            default:
                break;
        }
    }
}
exports.FriendCommands = FriendCommands;
//# sourceMappingURL=FriendCommands.js.map