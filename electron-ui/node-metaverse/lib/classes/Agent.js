"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Agent = void 0;
const UUID_1 = require("./UUID");
const Vector3_1 = require("./Vector3");
const Inventory_1 = require("./Inventory");
const Message_1 = require("../enums/Message");
const AgentUpdate_1 = require("./messages/AgentUpdate");
const Quaternion_1 = require("./Quaternion");
const AgentState_1 = require("../enums/AgentState");
const BuiltInAnimations_1 = require("../enums/BuiltInAnimations");
const AgentWearablesRequest_1 = require("./messages/AgentWearablesRequest");
const RezSingleAttachmentFromInv_1 = require("./messages/RezSingleAttachmentFromInv");
const AttachmentPoint_1 = require("../enums/AttachmentPoint");
const Utils_1 = require("./Utils");
const AgentFlags_1 = require("../enums/AgentFlags");
const ControlFlags_1 = require("../enums/ControlFlags");
const PacketFlags_1 = require("../enums/PacketFlags");
const FolderType_1 = require("../enums/FolderType");
const rxjs_1 = require("rxjs");
const InventoryFolder_1 = require("./InventoryFolder");
const BulkUpdateInventoryEvent_1 = require("../events/BulkUpdateInventoryEvent");
const InventoryItem_1 = require("./InventoryItem");
const InventoryLibrary_1 = require("../enums/InventoryLibrary");
const AssetType_1 = require("../enums/AssetType");
class Agent {
    firstName;
    lastName;
    localID = 0;
    agentID;
    activeGroupID = UUID_1.UUID.zero();
    accessMax;
    regionAccess;
    agentAccess;
    currentRegion;
    openID = {};
    AOTransition;
    buddyList = [];
    uiFlags = {};
    maxGroups;
    agentFlags;
    startLocation;
    cofVersion;
    home = {};
    snapshotConfigURL;
    inventory;
    gestures = [];
    estateManager = false;
    appearanceComplete = false;
    agentAppearanceService;
    onGroupChatExpired = new rxjs_1.Subject();
    cameraLookAt = new Vector3_1.Vector3([0.979546, 0.105575, -0.171303]);
    cameraCenter = new Vector3_1.Vector3([199.58, 203.95, 24.304]);
    cameraLeftAxis = new Vector3_1.Vector3([-1.0, 0.0, 0]);
    cameraUpAxis = new Vector3_1.Vector3([0.0, 0.0, 1.0]);
    cameraFar = 1;
    appearanceCompleteEvent = new rxjs_1.Subject();
    headRotation = Quaternion_1.Quaternion.getIdentity();
    bodyRotation = Quaternion_1.Quaternion.getIdentity();
    wearables;
    agentUpdateTimer = null;
    controlFlags = 0;
    clientEvents;
    animSubscription;
    chatSessions = new Map();
    constructor(clientEvents) {
        this.inventory = new Inventory_1.Inventory(this);
        this.clientEvents = clientEvents;
        this.clientEvents.onGroupChatAgentListUpdate.subscribe((event) => {
            const str = event.groupID.toString();
            const agent = event.agentID.toString();
            const session = this.chatSessions.get(str);
            if (session === undefined) {
                return;
            }
            if (event.entered) {
                if (session.agents === undefined) {
                    session.agents = new Map();
                }
                session.agents.set(agent, {
                    hasVoice: event.canVoiceChat,
                    isModerator: event.isModerator
                });
            }
            else {
                session.agents.delete(agent);
            }
        });
    }
    updateLastMessage(groupID) {
        const str = groupID.toString();
        const entry = this.chatSessions.get(str);
        if (entry === undefined) {
            return;
        }
        if (entry.timeout !== undefined) {
            clearInterval(entry.timeout);
            entry.timeout = setTimeout(this.groupChatExpired.bind(this, groupID), 900000);
        }
    }
    setIsEstateManager(is) {
        this.estateManager = is;
    }
    getSessionAgentCount(uuid) {
        const str = uuid.toString();
        const session = this.chatSessions.get(str);
        if (session === undefined) {
            return 0;
        }
        else {
            return session.agents.size;
        }
    }
    addChatSession(uuid, timeout) {
        const str = uuid.toString();
        if (this.chatSessions.has(str)) {
            return false;
        }
        this.chatSessions.set(str, {
            agents: new Map(),
            timeout: timeout ? setTimeout(this.groupChatExpired.bind(this, uuid), 900000) : undefined
        });
        return true;
    }
    groupChatExpired(groupID) {
        this.onGroupChatExpired.next(groupID);
    }
    hasChatSession(uuid) {
        const str = uuid.toString();
        return this.chatSessions.has(str);
    }
    deleteChatSession(uuid) {
        const str = uuid.toString();
        if (!this.chatSessions.has(str)) {
            return false;
        }
        this.chatSessions.delete(str);
        return true;
    }
    setCurrentRegion(region) {
        if (this.animSubscription !== undefined) {
            this.animSubscription.unsubscribe();
        }
        this.currentRegion = region;
        this.animSubscription = this.currentRegion.circuit.subscribeToMessages([
            Message_1.Message.AvatarAnimation,
            Message_1.Message.AgentDataUpdate,
            Message_1.Message.BulkUpdateInventory
        ], this.onMessage.bind(this));
    }
    circuitActive() {
        this.agentUpdateTimer = setInterval(this.sendAgentUpdate.bind(this), 1000);
    }
    shutdown() {
        if (this.agentUpdateTimer !== null) {
            clearInterval(this.agentUpdateTimer);
            this.agentUpdateTimer = null;
        }
    }
    async setInitialAppearance() {
        const circuit = this.currentRegion.circuit;
        const wearablesRequest = new AgentWearablesRequest_1.AgentWearablesRequestMessage();
        wearablesRequest.AgentData = {
            AgentID: this.agentID,
            SessionID: circuit.sessionID
        };
        circuit.sendMessage(wearablesRequest, PacketFlags_1.PacketFlags.Reliable);
        const wearables = await circuit.waitForMessage(Message_1.Message.AgentWearablesUpdate, 30000);
        if (!this.wearables || wearables.AgentData.SerialNum > this.wearables.serialNumber) {
            this.wearables = {
                serialNumber: wearables.AgentData.SerialNum,
                attachments: []
            };
            for (const wearable of wearables.WearableData) {
                if (this.wearables.attachments) {
                    this.wearables.attachments.push({
                        itemID: wearable.ItemID,
                        assetID: wearable.AssetID,
                        wearableType: wearable.WearableType
                    });
                }
            }
        }
        const currentOutfitFolder = await this.getWearables();
        const wornObjects = this.currentRegion.objects.getObjectsByParent(this.localID);
        for (const item of currentOutfitFolder.items) {
            if (item.type === AssetType_1.AssetType.Notecard) {
                let found = false;
                for (const obj of wornObjects) {
                    if (obj.hasNameValueEntry('AttachItemID')) {
                        if (item.itemID.toString() === obj.getNameValueEntry('AttachItemID')) {
                            found = true;
                        }
                    }
                }
                if (!found) {
                    const rsafi = new RezSingleAttachmentFromInv_1.RezSingleAttachmentFromInvMessage();
                    rsafi.AgentData = {
                        AgentID: this.agentID,
                        SessionID: circuit.sessionID
                    };
                    rsafi.ObjectData = {
                        ItemID: new UUID_1.UUID(item.itemID.toString()),
                        OwnerID: this.agentID,
                        AttachmentPt: 0x80 | AttachmentPoint_1.AttachmentPoint.Default,
                        ItemFlags: item.flags,
                        GroupMask: item.permissions.groupMask,
                        EveryoneMask: item.permissions.everyoneMask,
                        NextOwnerMask: item.permissions.nextOwnerMask,
                        Name: Utils_1.Utils.StringToBuffer(item.name),
                        Description: Utils_1.Utils.StringToBuffer(item.description)
                    };
                    circuit.sendMessage(rsafi, PacketFlags_1.PacketFlags.Reliable);
                }
            }
        }
        this.appearanceComplete = true;
        this.appearanceCompleteEvent.next();
    }
    setControlFlag(flag) {
        this.controlFlags = this.controlFlags | flag;
    }
    clearControlFlag(flag) {
        this.controlFlags = this.controlFlags & ~flag;
    }
    async getWearables() {
        for (const uuid of this.inventory.main.skeleton.keys()) {
            const folder = this.inventory.main.skeleton.get(uuid);
            if (folder && folder.typeDefault === FolderType_1.FolderType.CurrentOutfit) {
                await folder.populate(false);
                return folder;
            }
        }
        throw new Error('Unable to get wearables from inventory');
    }
    sendAgentUpdate() {
        if (!this.currentRegion) {
            return;
        }
        const circuit = this.currentRegion.circuit;
        const agentUpdate = new AgentUpdate_1.AgentUpdateMessage();
        agentUpdate.AgentData = {
            AgentID: this.agentID,
            SessionID: circuit.sessionID,
            HeadRotation: this.headRotation,
            BodyRotation: this.bodyRotation,
            State: AgentState_1.AgentState.None,
            CameraCenter: this.cameraCenter,
            CameraAtAxis: this.cameraLookAt,
            CameraLeftAxis: this.cameraLeftAxis,
            CameraUpAxis: this.cameraUpAxis,
            Far: this.cameraFar,
            ControlFlags: this.controlFlags,
            Flags: AgentFlags_1.AgentFlags.None
        };
        circuit.sendMessage(agentUpdate, 0);
    }
    onMessage(packet) {
        if (packet.message.id === Message_1.Message.AgentDataUpdate) {
            const msg = packet.message;
            this.activeGroupID = msg.AgentData.ActiveGroupID;
        }
        else if (packet.message.id === Message_1.Message.BulkUpdateInventory) {
            const msg = packet.message;
            const evt = new BulkUpdateInventoryEvent_1.BulkUpdateInventoryEvent();
            for (const newItem of msg.ItemData) {
                const folder = this.inventory.findFolder(newItem.FolderID);
                const item = new InventoryItem_1.InventoryItem(folder ?? undefined, this);
                item.assetID = newItem.AssetID;
                item.inventoryType = newItem.InvType;
                item.name = Utils_1.Utils.BufferToStringSimple(newItem.Name);
                item.salePrice = newItem.SalePrice;
                item.saleType = newItem.SaleType;
                item.created = new Date(newItem.CreationDate * 1000);
                item.parentID = newItem.FolderID;
                item.flags = newItem.Flags;
                item.itemID = newItem.ItemID;
                item.description = Utils_1.Utils.BufferToStringSimple(newItem.Description);
                item.type = newItem.Type;
                item.callbackID = newItem.CallbackID;
                item.permissions.baseMask = newItem.BaseMask;
                item.permissions.groupMask = newItem.GroupMask;
                item.permissions.nextOwnerMask = newItem.NextOwnerMask;
                item.permissions.ownerMask = newItem.OwnerMask;
                item.permissions.everyoneMask = newItem.EveryoneMask;
                item.permissions.owner = newItem.OwnerID;
                item.permissions.creator = newItem.CreatorID;
                item.permissions.group = newItem.GroupID;
                item.permissions.groupOwned = newItem.GroupOwned;
                evt.itemData.push(item);
            }
            for (const newFolder of msg.FolderData) {
                const fld = new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Main, this.inventory.main, this);
                fld.typeDefault = newFolder.Type;
                fld.name = Utils_1.Utils.BufferToStringSimple(newFolder.Name);
                fld.folderID = newFolder.FolderID;
                fld.parentID = newFolder.ParentID;
                evt.folderData.push(fld);
            }
            this.clientEvents.onBulkUpdateInventoryEvent.next(evt);
        }
        else if (packet.message.id === Message_1.Message.AvatarAnimation) {
            const animMsg = packet.message;
            if (animMsg.Sender.ID.toString() === this.agentID.toString()) {
                for (const anim of animMsg.AnimationList) {
                    const a = anim.AnimID.toString();
                    if (a === BuiltInAnimations_1.BuiltInAnimations.STANDUP ||
                        a === BuiltInAnimations_1.BuiltInAnimations.PRE_JUMP ||
                        a === BuiltInAnimations_1.BuiltInAnimations.LAND ||
                        a === BuiltInAnimations_1.BuiltInAnimations.MEDIUM_LAND ||
                        a === BuiltInAnimations_1.BuiltInAnimations.WALK ||
                        a === BuiltInAnimations_1.BuiltInAnimations.RUN) {
                        // TODO: Pretty sure this isn't the best way to do this
                        this.controlFlags = ControlFlags_1.ControlFlags.AGENT_CONTROL_FINISH_ANIM;
                        this.sendAgentUpdate();
                        this.controlFlags = 0;
                    }
                }
            }
        }
    }
}
exports.Agent = Agent;
//# sourceMappingURL=Agent.js.map