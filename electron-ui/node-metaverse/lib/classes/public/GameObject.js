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
exports.GameObject = void 0;
const Vector3_1 = require("../Vector3");
const UUID_1 = require("../UUID");
const Quaternion_1 = require("../Quaternion");
const Vector4_1 = require("../Vector4");
const TextureEntry_1 = require("../TextureEntry");
const Color4_1 = require("../Color4");
const ParticleSystem_1 = require("../ParticleSystem");
const builder = __importStar(require("xmlbuilder"));
const InventoryItem_1 = require("../InventoryItem");
const LLWearable_1 = require("../LLWearable");
const TextureAnim_1 = require("./TextureAnim");
const ExtraParams_1 = require("./ExtraParams");
const ObjectExtraParams_1 = require("../messages/ObjectExtraParams");
const ExtraParamType_1 = require("../../enums/ExtraParamType");
const ObjectImage_1 = require("../messages/ObjectImage");
const ObjectName_1 = require("../messages/ObjectName");
const ObjectDescription_1 = require("../messages/ObjectDescription");
const MultipleObjectUpdate_1 = require("../messages/MultipleObjectUpdate");
const UpdateType_1 = require("../../enums/UpdateType");
const ObjectLink_1 = require("../messages/ObjectLink");
const ObjectShape_1 = require("../messages/ObjectShape");
const PrimFlags_1 = require("../../enums/PrimFlags");
const Utils_1 = require("../Utils");
const ProfileShape_1 = require("../../enums/ProfileShape");
const HoleType_1 = require("../../enums/HoleType");
const SculptType_1 = require("../../enums/SculptType");
const PacketFlags_1 = require("../../enums/PacketFlags");
const PCode_1 = require("../../enums/PCode");
const DeRezObject_1 = require("../messages/DeRezObject");
const DeRezDestination_1 = require("../../enums/DeRezDestination");
const Message_1 = require("../../enums/Message");
const FilterResponse_1 = require("../../enums/FilterResponse");
const UpdateTaskInventory_1 = require("../messages/UpdateTaskInventory");
const ObjectSelect_1 = require("../messages/ObjectSelect");
const ObjectDeselect_1 = require("../messages/ObjectDeselect");
const AttachmentPoint_1 = require("../../enums/AttachmentPoint");
const RequestTaskInventory_1 = require("../messages/RequestTaskInventory");
const InventoryType_1 = require("../../enums/InventoryType");
const rxjs_1 = require("rxjs");
const RezScript_1 = require("../messages/RezScript");
const PermissionMask_1 = require("../../enums/PermissionMask");
const AssetType_1 = require("../../enums/AssetType");
const LLGLTFMaterialOverride_1 = require("../LLGLTFMaterialOverride");
const RemoveTaskInventory_1 = require("../messages/RemoveTaskInventory");
const uuid = __importStar(require("uuid"));
const Logger_1 = require("../Logger");
const InventoryTypeRegistry_1 = require("../InventoryTypeRegistry");
const AssetTypeRegistry_1 = require("../AssetTypeRegistry");
class GameObject {
    dateReceived;
    rtreeEntry;
    textureAnim;
    extraParams;
    deleted = false;
    creatorID;
    creationDate;
    baseMask;
    ownerMask;
    groupMask;
    groupID;
    everyoneMask;
    nextOwnerMask;
    ownershipCost;
    saleType;
    salePrice;
    aggregatePerms;
    aggregatePermTextures;
    aggregatePermTexturesOwner;
    category;
    inventorySerial;
    itemID;
    folderID;
    fromTaskID;
    lastOwnerID;
    name;
    description;
    touchName;
    sitName;
    textureID;
    resolvedAt;
    resolvedInventory = false;
    totalChildren;
    landImpact;
    calculatedLandImpact;
    physicaImpact;
    resourceImpact;
    linkResourceImpact;
    linkPhysicsImpact;
    limitingType;
    children;
    ID = 0;
    FullID = UUID_1.UUID.random();
    ParentID;
    _ownerID = UUID_1.UUID.zero();
    IsAttachment = false;
    NameValue = new Map();
    PCode = PCode_1.PCode.None;
    State;
    CRC;
    Material;
    ClickAction;
    Scale;
    Flags;
    PathCurve;
    ProfileCurve;
    PathBegin;
    PathEnd;
    PathScaleX;
    PathScaleY;
    PathShearX;
    PathShearY;
    PathTwist;
    PathTwistBegin;
    PathRadiusOffset;
    PathTaperX;
    PathTaperY;
    PathRevolutions;
    PathSkew;
    ProfileBegin;
    ProfileEnd;
    ProfileHollow;
    TextureEntry;
    Text;
    TextColor;
    MediaURL;
    JointType;
    JointPivot;
    JointAxisOrAnchor;
    Position;
    Rotation;
    CollisionPlane;
    Velocity;
    Acceleration;
    AngularVelocity;
    TreeSpecies;
    Sound;
    SoundGain;
    SoundFlags;
    SoundRadius;
    Particles;
    density;
    friction;
    gravityMultiplier;
    physicsShapeType;
    restitution;
    attachmentPoint = AttachmentPoint_1.AttachmentPoint.Default;
    inventory = [];
    linksetData;
    region;
    resolveAttempts = 0;
    childrenPopulated = false;
    claimedForBuild = false;
    createdSelected = false;
    isMarkedRoot = false;
    onTextureUpdate = new rxjs_1.Subject();
    get OwnerID() {
        return this._ownerID;
    }
    set OwnerID(owner) {
        this._ownerID = owner;
    }
    constructor() {
        this.dateReceived = new Date();
        this.Position = Vector3_1.Vector3.getZero();
        this.Rotation = Quaternion_1.Quaternion.getIdentity();
        this.AngularVelocity = Vector3_1.Vector3.getZero();
        this.TreeSpecies = 0;
        this.SoundFlags = 0;
        this.SoundRadius = 1.0;
        this.SoundGain = 1.0;
    }
    static async fromXML(xml) {
        let result = null;
        if (typeof xml === 'string') {
            const parsed = await Utils_1.Utils.parseXML(xml);
            if (parsed.SceneObjectGroup === undefined) {
                throw new Error('SceneObjectGroup not found');
            }
            result = parsed.SceneObjectGroup;
        }
        else {
            result = xml;
        }
        let rootPartXML = null;
        if (result.SceneObjectPart !== undefined) {
            rootPartXML = result.SceneObjectPart;
        }
        else if (result.RootPart?.[0]?.SceneObjectPart !== undefined) {
            rootPartXML = result.RootPart[0].SceneObjectPart;
        }
        else {
            throw new Error('Root part not found');
        }
        const rootPart = GameObject.partFromXMLJS(rootPartXML[0], true);
        rootPart.children = [];
        rootPart.totalChildren = 0;
        if (result.OtherParts !== undefined && Array.isArray(result.OtherParts) && result.OtherParts.length > 0) {
            const [obj] = result.OtherParts;
            if (obj.SceneObjectPart !== undefined || obj.Part !== undefined) {
                if (obj.Part !== undefined) {
                    for (const part of obj.Part) {
                        rootPart.children.push(GameObject.partFromXMLJS(part.SceneObjectPart[0], false));
                        rootPart.totalChildren++;
                    }
                }
                else {
                    for (const part of obj.SceneObjectPart) {
                        rootPart.children.push(GameObject.partFromXMLJS(part, false));
                        rootPart.totalChildren++;
                    }
                }
            }
        }
        return rootPart;
    }
    static async deRezObjects(region, objects, destination, transactionID, destFolder) {
        const msg = new DeRezObject_1.DeRezObjectMessage();
        msg.AgentData = {
            AgentID: region.agent.agentID,
            SessionID: region.circuit.sessionID
        };
        msg.AgentBlock = {
            GroupID: UUID_1.UUID.zero(),
            Destination: destination,
            DestinationID: destFolder,
            TransactionID: transactionID,
            PacketCount: 1,
            PacketNumber: 1
        };
        msg.ObjectData = [];
        for (const obj of objects) {
            msg.ObjectData.push({
                ObjectLocalID: obj.ID
            });
        }
        const ack = region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return region.circuit.waitForAck(ack, 10000);
    }
    static async takeManyToInventory(region, objects, folder) {
        const transactionID = UUID_1.UUID.random();
        let enforceFolder = true;
        if (folder === undefined) {
            enforceFolder = false;
            folder = region.agent.inventory.getRootFolderMain();
        }
        if (folder !== undefined) {
            void GameObject.deRezObjects(region, objects, DeRezDestination_1.DeRezDestination.AgentInventoryTake, transactionID, folder.folderID);
            const createInventoryMsg = await region.circuit.waitForMessage(Message_1.Message.UpdateCreateInventoryItem, 20000, (message) => {
                for (const inv of message.InventoryData) {
                    const name = Utils_1.Utils.BufferToStringSimple(inv.Name);
                    if (name === objects[0].name) {
                        return FilterResponse_1.FilterResponse.Finish;
                    }
                }
                return FilterResponse_1.FilterResponse.NoMatch;
            });
            for (const inv of createInventoryMsg.InventoryData) {
                const name = Utils_1.Utils.BufferToStringSimple(inv.Name);
                if (name === objects[0].name) {
                    const itemID = inv.ItemID;
                    const item = await region.agent.inventory.fetchInventoryItem(itemID);
                    if (item === null) {
                        throw new Error('Inventory item was unable to be retrieved after take to inventory');
                    }
                    else {
                        if (enforceFolder && !item.parentID.equals(folder.folderID)) {
                            await item.moveToFolder(folder);
                        }
                    }
                    return item;
                }
            }
        }
        throw new Error('Failed to take object');
    }
    // noinspection JSUnusedGlobalSymbols
    async waitForTextureUpdate(timeout) {
        await Utils_1.Utils.waitOrTimeOut(this.onTextureUpdate, timeout);
    }
    // noinspection JSUnusedGlobalSymbols
    async rezScript(name, description, perms = 532480) {
        const rezScriptMsg = new RezScript_1.RezScriptMessage();
        rezScriptMsg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID,
            GroupID: this.region.agent.activeGroupID
        };
        rezScriptMsg.UpdateBlock = {
            ObjectLocalID: this.ID,
            Enabled: true
        };
        const tmpName = uuid.v4();
        const invItem = new InventoryItem_1.InventoryItem(this);
        invItem.itemID = UUID_1.UUID.zero();
        invItem.parentID = this.FullID;
        invItem.permissions.creator = this.region.agent.agentID;
        invItem.permissions.group = UUID_1.UUID.zero();
        invItem.permissions.baseMask = PermissionMask_1.PermissionMask.All;
        invItem.permissions.ownerMask = PermissionMask_1.PermissionMask.All;
        invItem.permissions.groupMask = 0;
        invItem.permissions.everyoneMask = 0;
        invItem.permissions.nextOwnerMask = perms;
        invItem.permissions.groupOwned = false;
        invItem.type = AssetType_1.AssetType.LSLText;
        invItem.inventoryType = InventoryType_1.InventoryType.LSL;
        invItem.flags = 0;
        invItem.salePrice = this.salePrice ?? 10;
        invItem.saleType = this.saleType ?? 0;
        invItem.name = tmpName;
        invItem.description = description;
        invItem.created = new Date();
        rezScriptMsg.InventoryBlock = {
            ItemID: UUID_1.UUID.zero(),
            FolderID: this.FullID,
            CreatorID: this.region.agent.agentID,
            OwnerID: this.region.agent.agentID,
            GroupID: UUID_1.UUID.zero(),
            BaseMask: PermissionMask_1.PermissionMask.All,
            OwnerMask: PermissionMask_1.PermissionMask.All,
            GroupMask: 0,
            EveryoneMask: 0,
            NextOwnerMask: perms,
            GroupOwned: false,
            TransactionID: UUID_1.UUID.zero(),
            Type: AssetType_1.AssetType.LSLText,
            InvType: InventoryType_1.InventoryType.LSL,
            Flags: 0,
            SaleType: this.saleType ?? 0,
            SalePrice: this.salePrice ?? 10,
            Name: Utils_1.Utils.StringToBuffer(tmpName),
            Description: Utils_1.Utils.StringToBuffer(description),
            CreationDate: Math.floor(invItem.created.getTime() / 1000),
            CRC: invItem.getCRC()
        };
        await this.region.circuit.waitForAck(this.region.circuit.sendMessage(rezScriptMsg, PacketFlags_1.PacketFlags.Reliable), 10000);
        await this.updateInventory();
        for (const item of this.inventory) {
            if (item.name === tmpName) {
                // We are intentionally not waiting for this rename job so that the wait below succeeds
                void item.rename(name);
                try {
                    await this.waitForInventoryUpdate();
                }
                catch (_error) {
                    // ignore
                }
                await this.updateInventory();
                for (const newItem of this.inventory) {
                    if (newItem.itemID.equals(item.itemID)) {
                        return newItem;
                    }
                }
                return item;
            }
        }
        throw new Error('Failed to add script to object');
    }
    async updateInventory() {
        if (this.PCode === PCode_1.PCode.Avatar) {
            return;
        }
        try {
            const capURL = await this.region.caps.getCapability('RequestTaskInventory');
            const result = await this.region.caps.capsPerformXMLGet(capURL + '?task_id=' + this.FullID.toString());
            if (result.contents) {
                this.inventory = [];
                for (const item of result.contents) {
                    const invItem = new InventoryItem_1.InventoryItem(this, this.region.agent);
                    invItem.assetID = new UUID_1.UUID(item.asset_id);
                    invItem.created = new Date((item.created_at ?? 0) * 1000);
                    invItem.description = item.desc ?? '';
                    invItem.flags = item.flags ?? 0;
                    const invType = InventoryTypeRegistry_1.InventoryTypeRegistry.getTypeFromTypeName(item.inv_type ?? '');
                    if (invType) {
                        invItem.inventoryType = invType.type;
                    }
                    const type = AssetTypeRegistry_1.AssetTypeRegistry.getTypeFromTypeName(item.type ?? '');
                    if (type !== undefined) {
                        invItem.type = type.type;
                    }
                    invItem.itemID = new UUID_1.UUID(item.item_id);
                    invItem.name = item.name ?? '';
                    invItem.parentID = new UUID_1.UUID(item.parent_id);
                    invItem.permissions = {
                        baseMask: item.permissions?.base_mask ?? 0,
                        creator: new UUID_1.UUID(item.permissions?.creator_id),
                        everyoneMask: item.permissions?.everyone_mask ?? 0,
                        group: new UUID_1.UUID(item.permissions?.group_id),
                        groupMask: item.permissions?.group_mask ?? 0,
                        groupOwned: item.permissions?.is_owner_group ?? false,
                        lastOwner: new UUID_1.UUID(item.permissions?.last_owner_id),
                        nextOwnerMask: item.permissions?.next_owner_mask ?? 0,
                        owner: new UUID_1.UUID(item.permissions?.owner_id),
                        ownerMask: item.permissions?.owner_mask ?? 0
                    };
                    invItem.salePrice = item.sale_info?.sale_price ?? 0;
                    switch (item.sale_info?.sale_type) {
                        case 'not':
                            invItem.saleType = 0;
                            break;
                        case 'orig':
                            invItem.saleType = 1;
                            break;
                        case 'copy':
                            invItem.saleType = 2;
                            break;
                        case 'cntn':
                            invItem.saleType = 3;
                            break;
                        case undefined:
                            break;
                    }
                    this.inventory.push(invItem);
                }
                return;
            }
        }
        catch (_e) {
            // ignore
        }
        const req = new RequestTaskInventory_1.RequestTaskInventoryMessage();
        req.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        req.InventoryData = {
            LocalID: this.ID
        };
        this.region.circuit.sendMessage(req, PacketFlags_1.PacketFlags.Reliable);
        return this.waitForTaskInventory();
    }
    hasNameValueEntry(key) {
        return this.NameValue.has(key);
    }
    getNameValueEntry(key) {
        const entry = this.NameValue.get(key);
        if (entry !== undefined) {
            return entry.value;
        }
        return '';
    }
    setIfDefined(def, v) {
        if (def === undefined) {
            def = 0;
        }
        if (v === undefined) {
            return def;
        }
        else {
            return v;
        }
    }
    async setShape(PathCurve, ProfileCurve, PathBegin, PathEnd, PathScaleX, PathScaleY, PathShearX, PathShearY, PathTwist, PathTwistBegin, PathRadiusOffset, PathTaperX, PathTaperY, PathRevolutions, PathSkew, ProfileBegin, ProfileEnd, ProfileHollow) {
        this.PathCurve = this.setIfDefined(this.PathCurve, PathCurve);
        this.ProfileCurve = this.setIfDefined(this.ProfileCurve, ProfileCurve);
        this.PathBegin = this.setIfDefined(this.PathBegin, PathBegin);
        this.PathEnd = this.setIfDefined(this.PathEnd, PathEnd);
        this.PathScaleX = this.setIfDefined(this.PathScaleX, PathScaleX);
        this.PathScaleY = this.setIfDefined(this.PathScaleY, PathScaleY);
        this.PathShearX = this.setIfDefined(this.PathShearX, PathShearX);
        this.PathShearY = this.setIfDefined(this.PathShearY, PathShearY);
        this.PathTwist = this.setIfDefined(this.PathTwist, PathTwist);
        this.PathTwistBegin = this.setIfDefined(this.PathTwistBegin, PathTwistBegin);
        this.PathRadiusOffset = this.setIfDefined(this.PathRadiusOffset, PathRadiusOffset);
        this.PathTaperX = this.setIfDefined(this.PathTaperX, PathTaperX);
        this.PathTaperY = this.setIfDefined(this.PathTaperY, PathTaperY);
        this.PathRevolutions = this.setIfDefined(this.PathRevolutions, PathRevolutions);
        this.PathSkew = this.setIfDefined(this.PathSkew, PathSkew);
        this.ProfileBegin = this.setIfDefined(this.ProfileBegin, ProfileBegin);
        this.ProfileEnd = this.setIfDefined(this.ProfileEnd, ProfileEnd);
        this.ProfileHollow = this.setIfDefined(this.ProfileHollow, ProfileHollow);
        if (this.region === undefined) {
            return;
        }
        const msg = new ObjectShape_1.ObjectShapeMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.ObjectData = [
            {
                ObjectLocalID: this.ID,
                PathCurve: this.PathCurve,
                ProfileCurve: this.ProfileCurve,
                PathBegin: Utils_1.Utils.packBeginCut(this.PathBegin),
                PathEnd: Utils_1.Utils.packEndCut(this.PathEnd),
                PathScaleX: Utils_1.Utils.packPathScale(this.PathScaleX),
                PathScaleY: Utils_1.Utils.packPathScale(this.PathScaleY),
                PathShearX: Utils_1.Utils.packPathShear(this.PathShearX),
                PathShearY: Utils_1.Utils.packPathShear(this.PathShearY),
                PathTwist: Utils_1.Utils.packPathTwist(this.PathTwist),
                PathTwistBegin: Utils_1.Utils.packPathTwist(this.PathTwistBegin),
                PathRadiusOffset: Utils_1.Utils.packPathTwist(this.PathRadiusOffset),
                PathTaperX: Utils_1.Utils.packPathTaper(this.PathTaperX),
                PathTaperY: Utils_1.Utils.packPathTaper(this.PathTaperY),
                PathRevolutions: Utils_1.Utils.packPathRevolutions(this.PathRevolutions),
                PathSkew: Utils_1.Utils.packPathTwist(this.PathSkew),
                ProfileBegin: Utils_1.Utils.packBeginCut(this.ProfileBegin),
                ProfileEnd: Utils_1.Utils.packEndCut(this.ProfileEnd),
                ProfileHollow: Utils_1.Utils.packProfileHollow(this.ProfileHollow)
            }
        ];
        return this.region.circuit.waitForAck(this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable), 10000);
    }
    async setName(name) {
        this.name = name;
        if (this.region === undefined) {
            return;
        }
        const msg = new ObjectName_1.ObjectNameMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.ObjectData = [
            {
                LocalID: this.ID,
                Name: Utils_1.Utils.StringToBuffer(name)
            }
        ];
        return this.region.circuit.waitForAck(this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable), 10000);
    }
    async setGeometry(pos, rot, scale, wholeLinkset = false) {
        const data = [];
        const linked = (wholeLinkset) ? UpdateType_1.UpdateType.Linked : 0;
        if (pos !== undefined) {
            this.Position = pos;
            data.push({
                ObjectLocalID: this.ID,
                Type: UpdateType_1.UpdateType.Position | linked,
                Data: pos.getBuffer()
            });
        }
        if (rot !== undefined) {
            this.Rotation = rot;
            data.push({
                ObjectLocalID: this.ID,
                Type: UpdateType_1.UpdateType.Rotation | linked,
                Data: rot.getBuffer()
            });
        }
        if (scale !== undefined) {
            this.Scale = scale;
            data.push({
                ObjectLocalID: this.ID,
                Type: UpdateType_1.UpdateType.Scale | linked,
                Data: scale.getBuffer()
            });
        }
        if (this.region === undefined || data.length === 0) {
            return;
        }
        const msg = new MultipleObjectUpdate_1.MultipleObjectUpdateMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.ObjectData = data;
        return this.region.circuit.waitForAck(this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable), 30000);
    }
    // noinspection JSUnusedGlobalSymbols
    async linkTo(rootObj) {
        const msg = new ObjectLink_1.ObjectLinkMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.ObjectData = [
            {
                ObjectLocalID: rootObj.ID
            },
            {
                ObjectLocalID: this.ID
            }
        ];
        return this.region.circuit.waitForAck(this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable), 30000);
    }
    async linkFrom(objects) {
        if (objects.length === 0) {
            return;
        }
        const primsExpectingUpdate = new Map();
        const msg = new ObjectLink_1.ObjectLinkMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.ObjectData = [
            {
                ObjectLocalID: this.ID
            }
        ];
        primsExpectingUpdate.set(this.ID, this);
        for (const obj of objects) {
            msg.ObjectData.push({
                ObjectLocalID: obj.ID
            });
            primsExpectingUpdate.set(obj.ID, obj);
        }
        await this.region.circuit.sendAndWaitForMessage(msg, PacketFlags_1.PacketFlags.Reliable, Message_1.Message.ObjectUpdate, 10000, (message) => {
            let match = false;
            for (const obj of message.ObjectData) {
                const num = obj.ID;
                if (primsExpectingUpdate.has(num)) {
                    primsExpectingUpdate.delete(num);
                    match = true;
                }
            }
            if (match) {
                if (primsExpectingUpdate.size === 0) {
                    return FilterResponse_1.FilterResponse.Finish;
                }
                return FilterResponse_1.FilterResponse.Match;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
    }
    async setDescription(desc) {
        this.description = desc;
        if (this.region === undefined) {
            return;
        }
        const msg = new ObjectDescription_1.ObjectDescriptionMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.ObjectData = [
            {
                LocalID: this.ID,
                Description: Utils_1.Utils.StringToBuffer(desc)
            }
        ];
        return this.region.circuit.waitForAck(this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable), 10000);
    }
    async setTextureEntry(e) {
        this.TextureEntry = e;
        if (this.region === undefined) {
            return;
        }
        return this.setTextureAndMediaURL();
    }
    async setTextureAndMediaURL() {
        const msg = new ObjectImage_1.ObjectImageMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        if (this.MediaURL === undefined) {
            this.MediaURL = '';
        }
        if (this.TextureEntry === undefined) {
            this.TextureEntry = new TextureEntry_1.TextureEntry();
        }
        msg.ObjectData = [
            {
                ObjectLocalID: this.ID,
                TextureEntry: this.TextureEntry.toBuffer(),
                MediaURL: Utils_1.Utils.StringToBuffer(this.MediaURL)
            }
        ];
        return this.region.circuit.waitForAck(this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable), 10000);
    }
    async setExtraParams(ex) {
        this.extraParams = ex;
        if (this.region === undefined) {
            return;
        }
        // Set ExtraParams
        const msg = new ObjectExtraParams_1.ObjectExtraParamsMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.ObjectData = [];
        let params = 0;
        if (ex.lightData !== null) {
            params++;
            const data = ex.lightData.getBuffer();
            msg.ObjectData.push({
                ObjectLocalID: this.ID,
                ParamType: ExtraParamType_1.ExtraParamType.Light,
                ParamInUse: (ex.lightData.Intensity !== 0.0),
                ParamData: data,
                ParamSize: data.length
            });
        }
        if (ex.flexibleData !== null) {
            params++;
            const data = ex.flexibleData.getBuffer();
            msg.ObjectData.push({
                ObjectLocalID: this.ID,
                ParamType: ExtraParamType_1.ExtraParamType.Flexible,
                ParamInUse: true,
                ParamData: data,
                ParamSize: data.length
            });
        }
        if (ex.lightImageData !== null) {
            params++;
            const data = ex.lightImageData.getBuffer();
            msg.ObjectData.push({
                ObjectLocalID: this.ID,
                ParamType: ExtraParamType_1.ExtraParamType.LightImage,
                ParamInUse: true,
                ParamData: data,
                ParamSize: data.length
            });
        }
        if (ex.sculptData !== null) {
            params++;
            const data = ex.sculptData.getBuffer();
            msg.ObjectData.push({
                ObjectLocalID: this.ID,
                ParamType: ExtraParamType_1.ExtraParamType.Sculpt,
                ParamInUse: true,
                ParamData: data,
                ParamSize: data.length
            });
        }
        if (ex.meshData !== null) {
            params++;
            const data = ex.meshData.getBuffer();
            msg.ObjectData.push({
                ObjectLocalID: this.ID,
                ParamType: ExtraParamType_1.ExtraParamType.Mesh,
                ParamInUse: true,
                ParamData: data,
                ParamSize: data.length
            });
        }
        if (ex.reflectionProbeData != null) {
            params++;
            const data = ex.reflectionProbeData.getBuffer();
            msg.ObjectData.push({
                ObjectLocalID: this.ID,
                ParamType: ExtraParamType_1.ExtraParamType.ReflectionProbe,
                ParamInUse: true,
                ParamData: data,
                ParamSize: data.length
            });
        }
        if (ex.renderMaterialData != null) {
            params++;
            const data = ex.renderMaterialData.getBuffer();
            msg.ObjectData.push({
                ObjectLocalID: this.ID,
                ParamType: ExtraParamType_1.ExtraParamType.RenderMaterial,
                ParamInUse: true,
                ParamData: data,
                ParamSize: data.length
            });
        }
        if (params > 0) {
            const ack = this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
            await this.region.circuit.waitForAck(ack, 10000);
        }
    }
    // noinspection JSUnusedGlobalSymbols
    populateChildren() {
        this.region.objects.populateChildren(this);
    }
    async exportXMLElement(rootNode, skipInventory = false, skipResolve = false) {
        const document = builder.create('SceneObjectGroup');
        let linkNum = 1;
        await this.getXML(document, this, linkNum, rootNode, skipInventory, skipResolve);
        if (this.children && this.children.length > 0) {
            const otherParts = document.ele('OtherParts');
            const children = [...this.children];
            children.sort((a, b) => b.dateReceived.getTime() - a.dateReceived.getTime());
            for (const child of children) {
                await child.getXML(otherParts, this, ++linkNum, (rootNode !== undefined) ? 'Part' : undefined, skipInventory, skipResolve);
            }
        }
        return document;
    }
    async exportXML(rootNode, skipInventory = false, skipResolve = false) {
        return (await this.exportXMLElement(rootNode, skipInventory, skipResolve)).end({ pretty: true, allowEmpty: true });
    }
    // noinspection JSUnusedGlobalSymbols
    toJSON() {
        return {
            deleted: this.deleted,
            creatorID: this.creatorID,
            creationDate: this.creationDate,
            baseMask: this.baseMask,
            ownerMask: this.ownerMask,
            groupMask: this.groupMask,
            everyoneMask: this.everyoneMask,
            nextOwnerMask: this.nextOwnerMask,
            ownershipCost: this.ownershipCost,
            saleType: this.saleType,
            salePrice: this.salePrice,
            aggregatePerms: this.aggregatePerms,
            aggregatePermTextures: this.aggregatePermTextures,
            aggregatePermTexturesOwner: this.aggregatePermTexturesOwner,
            category: this.category,
            inventorySerial: this.inventorySerial,
            itemID: this.itemID,
            folderID: this.folderID,
            fromTaskID: this.fromTaskID,
            lastOwnerID: this.lastOwnerID,
            name: this.name,
            description: this.description,
            touchName: this.touchName,
            sitName: this.sitName,
            resolvedAt: this.resolvedAt,
            resolvedInventory: this.resolvedInventory,
            totalChildren: this.totalChildren,
            landImpact: this.landImpact,
            calculatedLandImpact: this.calculatedLandImpact,
            physicaImpact: this.physicaImpact,
            resourceImpact: this.resourceImpact,
            linkResourceImpact: this.linkResourceImpact,
            linkPhysicsImpact: this.linkPhysicsImpact,
            limitingType: this.limitingType,
            children: this.children,
            ID: this.ID,
            FullID: this.FullID,
            ParentID: this.ParentID,
            OwnerID: this.OwnerID,
            IsAttachment: this.IsAttachment,
            NameValue: this.NameValue,
            PCode: this.PCode,
            State: this.State,
            CRC: this.CRC,
            Material: this.Material,
            ClickAction: this.ClickAction,
            Scale: this.Scale,
            Flags: this.Flags,
            PathCurve: this.PathCurve,
            ProfileCurve: this.ProfileCurve,
            PathBegin: this.PathBegin,
            PathEnd: this.PathEnd,
            PathScaleX: this.PathScaleX,
            PathScaleY: this.PathScaleY,
            PathShearX: this.PathShearX,
            PathShearY: this.PathShearY,
            PathTwist: this.PathTwist,
            PathTwistBegin: this.PathTwistBegin,
            PathRadiusOffset: this.PathRadiusOffset,
            PathTaperX: this.PathTaperX,
            PathTaperY: this.PathTaperY,
            PathRevolutions: this.PathRevolutions,
            PathSkew: this.PathSkew,
            ProfileBegin: this.ProfileBegin,
            ProfileEnd: this.ProfileEnd,
            ProfileHollow: this.ProfileHollow,
            TextureEntry: this.TextureEntry,
            Text: this.Text,
            TextColor: this.TextColor,
            MediaURL: this.MediaURL,
            JointType: this.JointType,
            JointPivot: this.JointPivot,
            JointAxisOrAnchor: this.JointAxisOrAnchor,
            Position: this.Position,
            Rotation: this.Rotation,
            CollisionPlane: this.CollisionPlane,
            Velocity: this.Velocity,
            Acceleration: this.Acceleration,
            AngularVelocity: this.AngularVelocity,
            TreeSpecies: this.TreeSpecies,
            Sound: this.Sound,
            SoundGain: this.SoundGain,
            SoundFlags: this.SoundFlags,
            SoundRadius: this.SoundRadius,
            Particles: this.Particles,
            density: this.density,
            friction: this.friction,
            gravityMultiplier: this.gravityMultiplier,
            physicsShapeType: this.physicsShapeType,
            restitution: this.restitution
        };
    }
    setObjectData(data) {
        let dataPos = 0;
        // noinspection FallThroughInSwitchStatementJS, TsLint
        switch (data.length) {
            case 76:
                // Avatar collision normal;
                this.CollisionPlane = new Vector4_1.Vector4(data, dataPos);
                dataPos += 16;
            // falls through
            case 60:
                // Position
                this.Position = new Vector3_1.Vector3(data, dataPos);
                dataPos += 12;
                this.Velocity = new Vector3_1.Vector3(data, dataPos);
                dataPos += 12;
                this.Acceleration = new Vector3_1.Vector3(data, dataPos);
                dataPos += 12;
                this.Rotation = new Quaternion_1.Quaternion(data, dataPos);
                dataPos += 12;
                this.AngularVelocity = new Vector3_1.Vector3(data, dataPos);
                dataPos += 12;
                break;
            case 48:
                this.CollisionPlane = new Vector4_1.Vector4(data, dataPos);
                dataPos += 16;
            // falls through
            case 32:
                this.Position = new Vector3_1.Vector3([
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos), -0.5 * 256.0, 1.5 * 256.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 2), -0.5 * 256.0, 1.5 * 256.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 4), -256.0, 3.0 * 256.0)
                ]);
                dataPos += 6;
                this.Velocity = new Vector3_1.Vector3([
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos), -256.0, 256.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 2), -256.0, 256.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 4), -256.0, 256.0)
                ]);
                dataPos += 6;
                this.Acceleration = new Vector3_1.Vector3([
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos), -256.0, 256.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 2), -256.0, 256.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 4), -256.0, 256.0)
                ]);
                dataPos += 6;
                this.Rotation = new Quaternion_1.Quaternion([
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos), -1.0, 1.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 2), -1.0, 1.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 4), -1.0, 1.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 4), -1.0, 1.0)
                ]);
                dataPos += 8;
                this.AngularVelocity = new Vector3_1.Vector3([
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos), -256.0, 256.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 2), -256.0, 256.0),
                    Utils_1.Utils.UInt16ToFloat(data.readUInt16LE(dataPos + 4), -256.0, 256.0)
                ]);
                dataPos += 6;
                break;
            case 16:
                this.Position = new Vector3_1.Vector3([
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0)
                ]);
                this.Velocity = new Vector3_1.Vector3([
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0)
                ]);
                this.Acceleration = new Vector3_1.Vector3([
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0)
                ]);
                this.Rotation = new Quaternion_1.Quaternion([
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -1.0, 1.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -1.0, 1.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -1.0, 1.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -1.0, 1.0)
                ]);
                this.AngularVelocity = new Vector3_1.Vector3([
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0),
                    Utils_1.Utils.ByteToFloat(data.readUInt8(dataPos++), -256.0, 256.0)
                ]);
                break;
        }
    }
    // noinspection JSUnusedGlobalSymbols
    async deRezObject(destination, transactionID, destFolder) {
        return GameObject.deRezObjects(this.region, [this], destination, transactionID, destFolder);
    }
    // noinspection JSUnusedGlobalSymbols
    async takeToInventory(folder) {
        return GameObject.takeManyToInventory(this.region, [this], folder);
    }
    async dropInventoryIntoContents(inventoryItem) {
        const transactionID = UUID_1.UUID.zero();
        if (inventoryItem instanceof UUID_1.UUID) {
            const item = await this.region.agent.inventory.fetchInventoryItem(inventoryItem);
            if (item === null) {
                throw new Error('Failed to drop inventory into object contents - Inventory item ' + inventoryItem.toString() + ' not found');
            }
            inventoryItem = item;
        }
        const msg = new UpdateTaskInventory_1.UpdateTaskInventoryMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.UpdateData = {
            Key: 0,
            LocalID: this.ID
        };
        msg.InventoryData = {
            ItemID: inventoryItem.itemID,
            FolderID: inventoryItem.parentID,
            CreatorID: inventoryItem.permissions.creator,
            OwnerID: this.region.agent.agentID,
            GroupID: inventoryItem.permissions.group,
            BaseMask: inventoryItem.permissions.baseMask,
            OwnerMask: inventoryItem.permissions.ownerMask,
            GroupMask: inventoryItem.permissions.groupMask,
            EveryoneMask: inventoryItem.permissions.everyoneMask,
            NextOwnerMask: inventoryItem.permissions.nextOwnerMask,
            GroupOwned: inventoryItem.permissions.groupOwned ?? false,
            TransactionID: transactionID,
            Type: inventoryItem.type,
            InvType: inventoryItem.inventoryType,
            Flags: inventoryItem.flags,
            SaleType: inventoryItem.saleType,
            SalePrice: inventoryItem.salePrice,
            Name: Utils_1.Utils.StringToBuffer(inventoryItem.name),
            Description: Utils_1.Utils.StringToBuffer(inventoryItem.description),
            CreationDate: inventoryItem.created.getTime() / 1000,
            CRC: inventoryItem.getCRC()
        };
        const serial = this.inventorySerial;
        this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return this.waitForInventoryUpdate(serial);
    }
    async waitForInventoryUpdate(inventorySerial) {
        // We need to select the object, or we won't get the objectProperties message
        await this.deselect();
        void this.select();
        await this.region.circuit.waitForMessage(Message_1.Message.ObjectProperties, 10000, (message) => {
            for (const obj of message.ObjectData) {
                if (obj.ObjectID.equals(this.FullID)) {
                    if (inventorySerial === undefined) {
                        inventorySerial = this.inventorySerial;
                    }
                    if (obj.InventorySerial > inventorySerial) {
                        return FilterResponse_1.FilterResponse.Finish;
                    }
                }
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        await this.deselect();
    }
    async select() {
        const selectObject = new ObjectSelect_1.ObjectSelectMessage();
        selectObject.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        selectObject.ObjectData = [{
                ObjectLocalID: this.ID
            }];
        const ack = this.region.circuit.sendMessage(selectObject, PacketFlags_1.PacketFlags.Reliable);
        return this.region.circuit.waitForAck(ack, 10000);
    }
    async deselect() {
        const deselectObject = new ObjectDeselect_1.ObjectDeselectMessage();
        deselectObject.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        deselectObject.ObjectData = [{
                ObjectLocalID: this.ID
            }];
        const ack = this.region.circuit.sendMessage(deselectObject, PacketFlags_1.PacketFlags.Reliable);
        return this.region.circuit.waitForAck(ack, 10000);
    }
    // noinspection JSUnusedGlobalSymbols
    async removeTaskInventory(item) {
        if (typeof item === 'string') {
            for (const invItem of this.inventory) {
                if (invItem.name === item) {
                    item = invItem.itemID;
                    break;
                }
            }
        }
        if (typeof item === 'string') {
            throw new Error('Task inventory item not found');
        }
        const msg = new RemoveTaskInventory_1.RemoveTaskInventoryMessage();
        msg.AgentData = {
            AgentID: this.region.agent.agentID,
            SessionID: this.region.circuit.sessionID
        };
        msg.InventoryData = {
            LocalID: this.ID,
            ItemID: item
        };
        this.region.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        await this.waitForInventoryUpdate(this.inventorySerial);
    }
    static partFromXMLJS(obj, isRoot) {
        const go = new GameObject();
        go.Flags = 0;
        let prop = '';
        if (Utils_1.Utils.getFromXMLJS(obj, 'AllowedDrop') !== undefined) {
            go.Flags = go.Flags | PrimFlags_1.PrimFlags.AllowInventoryDrop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'CreatorID')) !== undefined) {
            go.creatorID = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'FolderID')) !== undefined) {
            go.folderID = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'InventorySerial')) !== undefined) {
            go.inventorySerial = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'UUID')) !== undefined) {
            go.FullID = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'LocalId')) !== undefined) {
            go.ID = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'Name')) !== undefined) {
            go.name = String(prop);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'Material')) !== undefined) {
            go.Material = prop;
        }
        if ((prop = Vector3_1.Vector3.fromXMLJS(obj, 'GroupPosition')) !== undefined) {
            if (isRoot) {
                go.Position = prop;
            }
        }
        if ((prop = Vector3_1.Vector3.fromXMLJS(obj, 'OffsetPosition')) !== undefined) {
            if (!isRoot) {
                go.Position = prop;
            }
        }
        if ((prop = Quaternion_1.Quaternion.fromXMLJS(obj, 'RotationOffset')) !== undefined) {
            go.Rotation = prop;
        }
        if ((prop = Vector3_1.Vector3.fromXMLJS(obj, 'Velocity')) !== undefined) {
            go.Velocity = prop;
        }
        if ((prop = Vector3_1.Vector3.fromXMLJS(obj, 'AngularVelocity')) !== undefined) {
            go.AngularVelocity = prop;
        }
        if ((prop = Vector3_1.Vector3.fromXMLJS(obj, 'Acceleration')) !== undefined) {
            go.Acceleration = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'Description')) !== undefined) {
            go.description = String(prop);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'Text')) !== undefined) {
            go.Text = String(prop);
        }
        if ((prop = Color4_1.Color4.fromXMLJS(obj, 'Color')) !== undefined) {
            go.TextColor = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'SitName')) !== undefined) {
            go.sitName = String(prop);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'TouchName')) !== undefined) {
            go.touchName = String(prop);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'ClickAction')) !== undefined) {
            go.ClickAction = prop;
        }
        if ((prop = Vector3_1.Vector3.fromXMLJS(obj, 'Scale')) !== undefined) {
            go.Scale = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'ParentID')) !== undefined) {
            go.ParentID = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'Category')) !== undefined) {
            go.category = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'SalePrice')) !== undefined) {
            go.salePrice = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'ObjectSaleType')) !== undefined) {
            go.saleType = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'OwnershipCost')) !== undefined) {
            go.ownershipCost = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'GroupID')) !== undefined) {
            go.groupID = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'OwnerID')) !== undefined) {
            go.OwnerID = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'LastOwnerID')) !== undefined) {
            go.lastOwnerID = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'BaseMask')) !== undefined) {
            go.baseMask = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'OwnerMask')) !== undefined) {
            go.ownerMask = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'GroupMask')) !== undefined) {
            go.groupMask = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'EveryoneMask')) !== undefined) {
            go.everyoneMask = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'NextOwnerMask')) !== undefined) {
            go.nextOwnerMask = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'Flags')) !== undefined) {
            let flags = 0;
            if (typeof prop === 'string') {
                const flagList = prop.split(' ');
                for (const flag of flagList) {
                    const f = String(flag);
                    if (PrimFlags_1.PrimFlags[f]) {
                        flags = flags | parseInt(PrimFlags_1.PrimFlags[f], 10);
                    }
                }
            }
            go.Flags = flags;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'TextureAnimation')) !== undefined) {
            const buf = Buffer.from(prop, 'base64');
            go.textureAnim = TextureAnim_1.TextureAnim.from(buf);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'ParticleSystem')) !== undefined) {
            const buf = Buffer.from(prop, 'base64');
            go.Particles = ParticleSystem_1.ParticleSystem.from(buf);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'PhysicsShapeType')) !== undefined) {
            go.physicsShapeType = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'SoundID')) !== undefined) {
            go.Sound = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'SoundGain')) !== undefined) {
            go.SoundGain = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'SoundFlags')) !== undefined) {
            go.SoundFlags = prop;
        }
        if ((prop = UUID_1.UUID.fromXMLJS(obj, 'SoundRadius')) !== undefined) {
            go.SoundRadius = prop;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'Shape')) !== undefined) {
            const shape = prop;
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'ProfileCurve')) !== undefined) {
                go.ProfileCurve = prop;
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'TextureEntry')) !== undefined) {
                const buf = Buffer.from(prop, 'base64');
                go.TextureEntry = TextureEntry_1.TextureEntry.from(buf);
            }
            if (go.TextureEntry && shape.MatOvrd !== undefined && Array.isArray(shape.MatOvrd) && shape.MatOvrd.length > 0) {
                const tex = Buffer.from(shape.MatOvrd[0], 'base64');
                let pos = 0;
                const entryCount = tex.readUInt8(pos++);
                for (let x = 0; x < entryCount; x++) {
                    const te_index = tex.readUInt8(pos++);
                    const len = tex.readUInt16LE(pos++);
                    pos++;
                    const json = tex.subarray(pos, pos + len).toString('utf-8');
                    pos = pos + len;
                    go.TextureEntry.gltfMaterialOverrides.set(te_index, LLGLTFMaterialOverride_1.LLGLTFMaterialOverride.fromFullMaterialJSON(json));
                }
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathBegin')) !== undefined) {
                go.PathBegin = Utils_1.Utils.unpackBeginCut(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathCurve')) !== undefined) {
                go.PathCurve = prop;
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathEnd')) !== undefined) {
                go.PathEnd = Utils_1.Utils.unpackEndCut(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathRadiusOffset')) !== undefined) {
                go.PathRadiusOffset = Utils_1.Utils.unpackPathTwist(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathRevolutions')) !== undefined) {
                go.PathRevolutions = Utils_1.Utils.unpackPathRevolutions(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathScaleX')) !== undefined) {
                go.PathScaleX = Utils_1.Utils.unpackPathScale(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathScaleY')) !== undefined) {
                go.PathScaleY = Utils_1.Utils.unpackPathScale(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathShearX')) !== undefined) {
                go.PathShearX = Utils_1.Utils.unpackPathShear(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathShearY')) !== undefined) {
                go.PathShearY = Utils_1.Utils.unpackPathShear(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathSkew')) !== undefined) {
                go.PathSkew = Utils_1.Utils.unpackPathShear(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathTaperX')) !== undefined) {
                go.PathTaperX = Utils_1.Utils.unpackPathTaper(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathTaperY')) !== undefined) {
                go.PathTaperY = Utils_1.Utils.unpackPathTaper(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathTwist')) !== undefined) {
                go.PathTwist = Utils_1.Utils.unpackPathTwist(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PathTwistBegin')) !== undefined) {
                go.PathTwistBegin = Utils_1.Utils.unpackPathTwist(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'PCode')) !== undefined) {
                go.PCode = prop;
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'ProfileBegin')) !== undefined) {
                go.ProfileBegin = Utils_1.Utils.unpackBeginCut(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'ProfileEnd')) !== undefined) {
                go.ProfileEnd = Utils_1.Utils.unpackEndCut(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'ProfileHollow')) !== undefined) {
                go.ProfileHollow = Utils_1.Utils.unpackProfileHollow(prop);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'State')) !== undefined) {
                go.attachmentPoint = parseInt(prop, 10);
                const mask = 0xf << 4 >>> 0;
                go.State = (((prop & mask) >>> 4) | ((prop & ~mask) << 4)) >>> 0;
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'ProfileShape')) !== undefined) {
                if (go.ProfileCurve === undefined) {
                    go.ProfileCurve = 0;
                }
                go.ProfileCurve = go.ProfileCurve | parseInt(ProfileShape_1.ProfileShape[prop], 10);
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'HollowShape')) !== undefined) {
                if (go.ProfileCurve === undefined) {
                    go.ProfileCurve = 0;
                }
                go.ProfileCurve = go.ProfileCurve | parseInt(HoleType_1.HoleType[prop], 10);
            }
            if (Utils_1.Utils.getFromXMLJS(shape, 'SculptEntry') !== undefined) {
                const type = Utils_1.Utils.getFromXMLJS(shape, 'SculptType');
                if (type !== false && type !== undefined) {
                    const id = UUID_1.UUID.fromXMLJS(shape, 'SculptTexture');
                    if (id instanceof UUID_1.UUID) {
                        if (go.extraParams === undefined) {
                            go.extraParams = new ExtraParams_1.ExtraParams();
                        }
                        // noinspection JSBitwiseOperatorUsage
                        if (type & SculptType_1.SculptType.Mesh) {
                            go.extraParams.setMeshData(type, id);
                        }
                        else {
                            go.extraParams.setSculptData(type, id);
                        }
                    }
                }
            }
            if (Utils_1.Utils.getFromXMLJS(shape, 'FlexiEntry') !== undefined) {
                const flexiSoftness = Utils_1.Utils.getFromXMLJS(shape, 'FlexiSoftness');
                const flexiTension = Utils_1.Utils.getFromXMLJS(shape, 'FlexiTension');
                const flexiDrag = Utils_1.Utils.getFromXMLJS(shape, 'FlexiDrag');
                const flexiGravity = Utils_1.Utils.getFromXMLJS(shape, 'FlexiGravity');
                const flexiWind = Utils_1.Utils.getFromXMLJS(shape, 'FlexiWind');
                const flexiForceX = Utils_1.Utils.getFromXMLJS(shape, 'FlexiForceX');
                const flexiForceY = Utils_1.Utils.getFromXMLJS(shape, 'FlexiForceY');
                const flexiForceZ = Utils_1.Utils.getFromXMLJS(shape, 'FlexiForceZ');
                if (flexiSoftness !== false &&
                    flexiTension !== false &&
                    flexiDrag !== false &&
                    flexiGravity !== false &&
                    flexiWind !== false &&
                    flexiForceX !== false &&
                    flexiForceY !== false &&
                    flexiForceZ !== false) {
                    let forceX = Number(flexiForceX);
                    let forceY = Number(flexiForceY);
                    let forceZ = Number(flexiForceZ);
                    if (isNaN(forceX)) {
                        forceX = 0;
                    }
                    if (isNaN(forceY)) {
                        forceY = 0;
                    }
                    if (isNaN(forceZ)) {
                        forceZ = 0;
                    }
                    if (go.extraParams === undefined) {
                        go.extraParams = new ExtraParams_1.ExtraParams();
                    }
                    go.extraParams.setFlexiData(flexiSoftness, flexiTension, flexiDrag, flexiGravity, flexiWind, new Vector3_1.Vector3([forceX, forceY, forceZ]));
                }
            }
            if (Utils_1.Utils.getFromXMLJS(shape, 'LightEntry') !== undefined) {
                const lightColorR = Utils_1.Utils.getFromXMLJS(shape, 'LightColorR');
                const lightColorG = Utils_1.Utils.getFromXMLJS(shape, 'LightColorG');
                const lightColorB = Utils_1.Utils.getFromXMLJS(shape, 'LightColorB');
                const lightColorA = Utils_1.Utils.getFromXMLJS(shape, 'LightColorA');
                const lightRadius = Utils_1.Utils.getFromXMLJS(shape, 'LightRadius');
                const lightCutoff = Utils_1.Utils.getFromXMLJS(shape, 'LightCutoff');
                const lightFalloff = Utils_1.Utils.getFromXMLJS(shape, 'LightFalloff');
                const lightIntensity = Utils_1.Utils.getFromXMLJS(shape, 'LightIntensity');
                if (lightColorR !== false &&
                    lightColorG !== false &&
                    lightColorB !== false &&
                    lightColorA !== false &&
                    lightRadius !== false &&
                    lightCutoff !== false &&
                    lightFalloff !== false &&
                    lightIntensity !== false) {
                    if (go.extraParams === undefined) {
                        go.extraParams = new ExtraParams_1.ExtraParams();
                    }
                    go.extraParams.setLightData(new Color4_1.Color4(lightColorR, lightColorG, lightColorB, lightColorA), lightRadius, lightCutoff, lightFalloff, lightIntensity);
                }
            }
            if ((prop = Utils_1.Utils.getFromXMLJS(shape, 'ExtraParams')) !== undefined) {
                const buf = Buffer.from(prop, 'base64');
                go.extraParams = ExtraParams_1.ExtraParams.from(buf);
            }
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(obj, 'TaskInventory')) !== undefined) {
            if (prop.TaskInventoryItem !== undefined) {
                for (const invItemXML of prop.TaskInventoryItem) {
                    const invItem = new InventoryItem_1.InventoryItem(go);
                    let subProp = '';
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'AssetID')) !== undefined) {
                        invItem.assetID = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'BasePermissions')) !== undefined) {
                        invItem.permissions.baseMask = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'EveryonePermissions')) !== undefined) {
                        invItem.permissions.everyoneMask = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'GroupPermissions')) !== undefined) {
                        invItem.permissions.groupMask = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'NextPermissions')) !== undefined) {
                        invItem.permissions.nextOwnerMask = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'CurrentPermissions')) !== undefined) {
                        invItem.permissions.ownerMask = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'CreationDate')) !== undefined) {
                        invItem.created = new Date(parseInt(subProp, 10) * 1000);
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'CreatorID')) !== undefined) {
                        invItem.permissions.creator = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'Description')) !== undefined) {
                        invItem.description = String(subProp);
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'Flags')) !== undefined) {
                        invItem.flags = subProp;
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'GroupID')) !== undefined) {
                        invItem.permissions.group = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'InvType')) !== undefined) {
                        invItem.inventoryType = subProp;
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'ItemID')) !== undefined) {
                        invItem.itemID = subProp;
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'OldItemID')) !== undefined) {
                        invItem.oldItemID = subProp;
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'LastOwnerID')) !== undefined) {
                        invItem.permissions.lastOwner = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'Name')) !== undefined) {
                        invItem.name = String(subProp);
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'OwnerID')) !== undefined) {
                        invItem.permissions.owner = subProp;
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'ParentID')) !== undefined) {
                        invItem.parentID = subProp;
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'ParentPartID')) !== undefined) {
                        invItem.parentPartID = subProp;
                    }
                    if ((subProp = UUID_1.UUID.fromXMLJS(invItemXML, 'PermsGranter')) !== undefined) {
                        invItem.permsGranter = subProp;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'ScriptRunning')) !== undefined) {
                        invItem.scriptRunning = subProp === true;
                    }
                    if ((subProp = Utils_1.Utils.getFromXMLJS(invItemXML, 'ScriptMono')) !== undefined) {
                        invItem.scriptMono = subProp === true;
                    }
                    go.inventory.push(invItem);
                }
            }
        }
        return go;
    }
    async waitForTaskInventory() {
        const inventory = await this.region.circuit.waitForMessage(Message_1.Message.ReplyTaskInventory, 10000, (message) => {
            if (message.InventoryData.TaskID.equals(this.FullID)) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            else {
                return FilterResponse_1.FilterResponse.Match;
            }
        });
        if (inventory.InventoryData.Filename.length === 0) {
            // Inventory is empty
            this.inventory = [];
            this.resolvedInventory = true;
            return;
        }
        const fileName = Utils_1.Utils.BufferToStringSimple(inventory.InventoryData.Filename);
        const file = await this.region.circuit.XferFileDown(fileName, true, false, UUID_1.UUID.zero(), AssetType_1.AssetType.Unknown, true);
        this.inventory = [];
        if (file.length === 0) {
            if (this.Flags === undefined) {
                this.Flags = 0;
            }
            this.Flags = this.Flags | PrimFlags_1.PrimFlags.InventoryEmpty;
        }
        else {
            const str = file.toString('utf-8');
            const lineObj = {
                lines: str.replace(/\r\n/g, '\n').split('\n'),
                lineNum: 0,
                pos: 0
            };
            while (lineObj.lineNum < lineObj.lines.length) {
                const line = Utils_1.Utils.getNotecardLine(lineObj);
                const result = Utils_1.Utils.parseLine(line);
                if (result.key !== null) {
                    switch (result.key) {
                        case 'inv_object':
                            /*
                            let itemID = UUID.zero();
                            let parentID = UUID.zero();
                            let name = '';
                            let assetType: AssetType = AssetType.Unknown;

                            while (lineObj.lineNum < lineObj.lines.length)
                            {
                                result = Utils.parseLine(lineObj.lines[lineObj.lineNum++]);
                                if (result.key !== null)
                                {
                                    if (result.key === '{')
                                    {
                                        // do nothing
                                    }
                                    else if (result.key === '}')
                                    {
                                        break;
                                    }
                                    else if (result.key === 'obj_id')
                                    {
                                        itemID = new UUID(result.value);
                                    }
                                    else if (result.key === 'parent_id')
                                    {
                                        parentID = new UUID(result.value);
                                    }
                                    else if (result.key === 'type')
                                    {
                                        const typeString = result.value as any;
                                        assetType = parseInt(AssetTypeLL[typeString], 10);
                                    }
                                    else if (result.key === 'name')
                                    {
                                        name = result.value.substring(0, result.value.indexOf('|'));
                                    }
                                }
                            }

                            if (name !== 'Contents')
                            {
                                console.log('TODO: Do something useful with inv_objects')
                            }
                            */
                            break;
                        case 'inv_item':
                            this.inventory.push(InventoryItem_1.InventoryItem.fromEmbeddedAsset(lineObj, this, this.region.agent));
                            break;
                    }
                }
            }
            this.resolvedInventory = true;
        }
    }
    async getInventoryXML(xml, inv) {
        if (!inv.assetID.isZero() || !inv.itemID.isZero()) {
            const item = xml.ele('TaskInventoryItem');
            if (inv.inventoryType === InventoryType_1.InventoryType.Object && inv.assetID.isZero()) {
                inv.assetID = inv.itemID;
            }
            UUID_1.UUID.getXML(item.ele('AssetID'), inv.assetID);
            UUID_1.UUID.getXML(item.ele('ItemID'), inv.itemID);
            if (inv.permissions !== undefined) {
                item.ele('BasePermissions', inv.permissions.baseMask);
                item.ele('EveryonePermissions', inv.permissions.everyoneMask);
                item.ele('GroupPermissions', inv.permissions.groupMask);
                item.ele('NextPermissions', inv.permissions.nextOwnerMask);
                item.ele('CurrentPermissions', inv.permissions.ownerMask);
                item.ele('PermsMask', 0);
                UUID_1.UUID.getXML(item.ele('CreatorID'), inv.permissions.creator);
                UUID_1.UUID.getXML(item.ele('LastOwnerID'), inv.permissions.lastOwner);
                UUID_1.UUID.getXML(item.ele('OwnerID'), inv.permissions.owner);
                UUID_1.UUID.getXML(item.ele('GroupID'), inv.permissions.group);
            }
            item.ele('CreationDate', inv.created.getTime() / 1000);
            item.ele('Description', inv.description);
            item.ele('InvType', inv.inventoryType);
            // For wearables, OpenSim expects flags to include the wearable type
            if (inv.inventoryType === InventoryType_1.InventoryType.Wearable && !inv.assetID.isZero()) {
                try {
                    const type = (inv.type === AssetType_1.AssetType.Clothing) ? AssetType_1.AssetType.Clothing : AssetType_1.AssetType.Bodypart;
                    const data = await this.region.clientCommands.asset.downloadAsset(type, inv.assetID);
                    const wearable = new LLWearable_1.LLWearable(data.toString('utf-8'));
                    inv.flags = inv.flags | wearable.type;
                }
                catch (error) {
                    console.error(error);
                }
            }
            item.ele('Flags', inv.flags);
            UUID_1.UUID.getXML(item.ele('ParentID'), this.FullID);
            UUID_1.UUID.getXML(item.ele('ParentPartID'), this.FullID);
            item.ele('Type', inv.type);
            item.ele('Name', inv.name);
            if (inv.type === AssetType_1.AssetType.LSLText) {
                item.ele('ScriptRunning', inv.scriptRunning);
                item.ele('ScriptMono', inv.scriptMono);
            }
        }
    }
    async getXML(xml, rootPrim, linkNum, rootNode, skipInventory = false, skipResolve = false) {
        if (!skipResolve) {
            const resolver = this.region?.resolver;
            if (resolver !== undefined) {
                if (this.resolvedAt === undefined) {
                    try {
                        await resolver.resolveObjects([this], { includeTempObjects: true });
                    }
                    catch (e) {
                        Logger_1.Logger.Error(e);
                    }
                }
                if (!this.resolvedInventory && !skipInventory) {
                    try {
                        await resolver.getInventory(this);
                    }
                    catch (e) {
                        Logger_1.Logger.Error(e);
                    }
                }
                if (this.calculatedLandImpact === undefined) {
                    try {
                        await resolver.getCosts([this]);
                    }
                    catch (e) {
                        Logger_1.Logger.Error(e);
                    }
                }
            }
        }
        let root = xml;
        if (rootNode !== undefined) {
            root = xml.ele(rootNode);
        }
        const sceneObjectPart = root.ele('SceneObjectPart').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance').att('xmlns:xsd', 'http://www.w3.org/2001/XMLSchema');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        sceneObjectPart.ele('AllowedDrop', (this.Flags !== undefined && (this.Flags & PrimFlags_1.PrimFlags.AllowInventoryDrop) === PrimFlags_1.PrimFlags.AllowInventoryDrop) ? 'true' : 'false');
        UUID_1.UUID.getXML(sceneObjectPart.ele('CreatorID'), this.creatorID);
        UUID_1.UUID.getXML(sceneObjectPart.ele('FolderID'), this.folderID);
        sceneObjectPart.ele('InventorySerial', this.inventorySerial);
        UUID_1.UUID.getXML(sceneObjectPart.ele('UUID'), this.FullID);
        sceneObjectPart.ele('LocalId', this.ID);
        sceneObjectPart.ele('Name', this.name);
        sceneObjectPart.ele('Material', this.Material);
        if (this.region !== undefined) {
            sceneObjectPart.ele('RegionHandle', this.region.regionHandle.toString());
        }
        Vector3_1.Vector3.getXML(sceneObjectPart.ele('GroupPosition'), rootPrim.Position);
        if (rootPrim === this) {
            Vector3_1.Vector3.getXML(sceneObjectPart.ele('OffsetPosition'), Vector3_1.Vector3.getZero());
        }
        else {
            Vector3_1.Vector3.getXML(sceneObjectPart.ele('OffsetPosition'), this.Position);
        }
        Quaternion_1.Quaternion.getXML(sceneObjectPart.ele('RotationOffset'), this.Rotation);
        Vector3_1.Vector3.getXML(sceneObjectPart.ele('Velocity'), this.Velocity);
        Vector3_1.Vector3.getXML(sceneObjectPart.ele('AngularVelocity'), this.AngularVelocity);
        Vector3_1.Vector3.getXML(sceneObjectPart.ele('Acceleration'), this.Acceleration);
        sceneObjectPart.ele('Description', this.description);
        if (this.Text !== undefined && this.Text !== '') {
            sceneObjectPart.ele('Text', this.Text);
        }
        if (this.TextColor !== undefined) {
            Color4_1.Color4.getXML(sceneObjectPart.ele('Color'), this.TextColor);
        }
        sceneObjectPart.ele('SitName', this.sitName);
        sceneObjectPart.ele('TouchName', this.touchName);
        sceneObjectPart.ele('LinkNum', linkNum);
        sceneObjectPart.ele('ClickAction', this.ClickAction);
        const shape = sceneObjectPart.ele('Shape');
        {
            shape.ele('ProfileCurve', this.ProfileCurve);
            if (this.TextureEntry) {
                shape.ele('TextureEntry', this.TextureEntry.toBase64());
                if (this.TextureEntry.gltfMaterialOverrides !== undefined) {
                    const overrideKeys = Array.from(this.TextureEntry.gltfMaterialOverrides.keys());
                    const numEntries = overrideKeys.length;
                    if (numEntries > 0) {
                        const buf = [];
                        const num = Buffer.allocUnsafe(1);
                        num.writeUInt8(numEntries, 0);
                        buf.push(num);
                        for (const overrideKey of overrideKeys) {
                            const override = this.TextureEntry.gltfMaterialOverrides.get(overrideKey);
                            if (override === undefined) {
                                continue;
                            }
                            const header = Buffer.allocUnsafe(3);
                            header.writeUInt8(overrideKey, 0);
                            const json = override.getFullMaterialJSON();
                            header.writeUInt16LE(json.length, 1);
                            buf.push(header);
                            buf.push(Buffer.from(json, 'utf-8'));
                        }
                        shape.ele('MatOvrd', Buffer.concat(buf).toString('base64'));
                    }
                }
            }
            if (this.extraParams !== undefined) {
                shape.ele('ExtraParams', this.extraParams.toBase64());
            }
            shape.ele('PathBegin', Utils_1.Utils.packBeginCut(Utils_1.Utils.numberOrZero(this.PathBegin)));
            shape.ele('PathCurve', this.PathCurve);
            shape.ele('PathEnd', Utils_1.Utils.packEndCut(Utils_1.Utils.numberOrZero(this.PathEnd)));
            shape.ele('PathRadiusOffset', Utils_1.Utils.packPathTwist(Utils_1.Utils.numberOrZero(this.PathRadiusOffset)));
            shape.ele('PathRevolutions', Utils_1.Utils.packPathRevolutions(Utils_1.Utils.numberOrZero(this.PathRevolutions)));
            shape.ele('PathScaleX', Utils_1.Utils.packPathScale(Utils_1.Utils.numberOrZero(this.PathScaleX)));
            shape.ele('PathScaleY', Utils_1.Utils.packPathScale(Utils_1.Utils.numberOrZero(this.PathScaleY)));
            shape.ele('PathShearX', Utils_1.Utils.packPathShear(Utils_1.Utils.numberOrZero(this.PathShearX)));
            shape.ele('PathShearY', Utils_1.Utils.packPathShear(Utils_1.Utils.numberOrZero(this.PathShearY)));
            shape.ele('PathSkew', Utils_1.Utils.packPathTwist(Utils_1.Utils.numberOrZero(this.PathSkew)));
            shape.ele('PathTaperX', Utils_1.Utils.packPathTaper(Utils_1.Utils.numberOrZero(this.PathTaperX)));
            shape.ele('PathTaperY', Utils_1.Utils.packPathTaper(Utils_1.Utils.numberOrZero(this.PathTaperY)));
            shape.ele('PathTwist', Utils_1.Utils.packPathTwist(Utils_1.Utils.numberOrZero(this.PathTwist)));
            shape.ele('PathTwistBegin', Utils_1.Utils.packPathTwist(Utils_1.Utils.numberOrZero(this.PathTwistBegin)));
            shape.ele('PCode', this.PCode);
            shape.ele('ProfileBegin', Utils_1.Utils.packBeginCut(Utils_1.Utils.numberOrZero(this.ProfileBegin)));
            shape.ele('ProfileEnd', Utils_1.Utils.packEndCut(Utils_1.Utils.numberOrZero(this.ProfileEnd)));
            shape.ele('ProfileHollow', Utils_1.Utils.packProfileHollow(Utils_1.Utils.numberOrZero(this.ProfileHollow)));
            // This is wrong, but opensim expects it
            const mask = 0xf << 4 >>> 0;
            if (this.State === undefined) {
                this.State = 0;
            }
            let state = (((this.State & mask) >>> 4) | ((this.State & ~mask) << 4)) >>> 0;
            state = state | this.attachmentPoint;
            shape.ele('State', state);
            shape.ele('LastAttachPoint', 0);
            if (this.ProfileCurve !== undefined) {
                const profileShape = this.ProfileCurve & 0x0F;
                const holeType = this.ProfileCurve & 0xF0;
                shape.ele('ProfileShape', ProfileShape_1.ProfileShape[profileShape]);
                shape.ele('HollowShape', HoleType_1.HoleType[holeType]);
            }
            if (this.extraParams?.meshData !== null) {
                shape.ele('SculptType', this.extraParams.meshData.type);
                UUID_1.UUID.getXML(shape.ele('SculptTexture'), this.extraParams.meshData.meshData);
                shape.ele('SculptEntry', true);
            }
            else if (this.extraParams?.sculptData !== null) {
                shape.ele('SculptType', this.extraParams.sculptData.type);
                UUID_1.UUID.getXML(shape.ele('SculptTexture'), this.extraParams.sculptData.texture);
                shape.ele('SculptEntry', true);
            }
            else {
                shape.ele('SculptEntry', false);
            }
            if (this.extraParams?.flexibleData !== null) {
                shape.ele('FlexiSoftness', this.extraParams.flexibleData.Softness);
                shape.ele('FlexiTension', this.extraParams.flexibleData.Tension);
                shape.ele('FlexiDrag', this.extraParams.flexibleData.Drag);
                shape.ele('FlexiGravity', this.extraParams.flexibleData.Gravity);
                shape.ele('FlexiWind', this.extraParams.flexibleData.Wind);
                shape.ele('FlexiForceX', this.extraParams.flexibleData.Force.x);
                shape.ele('FlexiForceY', this.extraParams.flexibleData.Force.y);
                shape.ele('FlexiForceZ', this.extraParams.flexibleData.Force.z);
                shape.ele('FlexiEntry', true);
            }
            else {
                shape.ele('FlexiEntry', false);
            }
            if (this.extraParams?.lightData !== null) {
                shape.ele('LightColorR', this.extraParams.lightData.Color.red);
                shape.ele('LightColorG', this.extraParams.lightData.Color.green);
                shape.ele('LightColorB', this.extraParams.lightData.Color.blue);
                shape.ele('LightColorA', this.extraParams.lightData.Color.alpha);
                shape.ele('LightRadius', this.extraParams.lightData.Radius);
                shape.ele('LightCutoff', this.extraParams.lightData.Cutoff);
                shape.ele('LightFalloff', this.extraParams.lightData.Falloff);
                shape.ele('LightIntensity', this.extraParams.lightData.Intensity);
                shape.ele('LightEntry', true);
            }
            else {
                shape.ele('LightEntry', false);
            }
        }
        Vector3_1.Vector3.getXML(sceneObjectPart.ele('Scale'), this.Scale);
        sceneObjectPart.ele('ParentID', this.ParentID);
        sceneObjectPart.ele('CreationDate', Math.round((new Date()).getTime() / 1000));
        sceneObjectPart.ele('Category', this.category);
        if (this.IsAttachment) {
            Vector3_1.Vector3.getXML(sceneObjectPart.ele('AttachPos'), this.Position);
        }
        sceneObjectPart.ele('SalePrice', this.salePrice);
        sceneObjectPart.ele('ObjectSaleType', this.saleType);
        sceneObjectPart.ele('OwnershipCost', this.ownershipCost);
        UUID_1.UUID.getXML(sceneObjectPart.ele('GroupID'), this.groupID);
        UUID_1.UUID.getXML(sceneObjectPart.ele('OwnerID'), this.OwnerID);
        UUID_1.UUID.getXML(sceneObjectPart.ele('LastOwnerID'), this.lastOwnerID);
        sceneObjectPart.ele('BaseMask', this.baseMask);
        sceneObjectPart.ele('OwnerMask', this.ownerMask);
        sceneObjectPart.ele('GroupMask', this.groupMask);
        sceneObjectPart.ele('EveryoneMask', this.everyoneMask);
        sceneObjectPart.ele('NextOwnerMask', this.nextOwnerMask);
        const flags = [];
        if (this.Flags !== undefined) {
            for (const flag of Object.keys(PrimFlags_1.PrimFlags)) {
                const fl = PrimFlags_1.PrimFlags;
                const flagName = flag;
                const flagValue = fl[flagName];
                // noinspection JSBitwiseOperatorUsage
                if (this.Flags & flagValue) {
                    flags.push(flagName);
                }
            }
        }
        sceneObjectPart.ele('Flags', flags.join(' '));
        if (this.textureAnim !== undefined) {
            sceneObjectPart.ele('TextureAnimation', this.textureAnim.toBase64());
        }
        if (this.Particles) {
            sceneObjectPart.ele('ParticleSystem', this.Particles.toBase64());
        }
        if (this.physicsShapeType != null) {
            sceneObjectPart.ele('PhysicsShapeType', this.physicsShapeType);
        }
        if (this.Sound && !this.Sound.isZero()) {
            UUID_1.UUID.getXML(sceneObjectPart.ele('SoundID'), this.Sound);
            sceneObjectPart.ele('SoundGain', this.SoundGain);
            sceneObjectPart.ele('SoundFlags', this.SoundFlags);
            sceneObjectPart.ele('SoundRadius', this.SoundRadius);
            sceneObjectPart.ele('SoundQueueing', false);
        }
        if (this.inventory !== undefined && this.inventory.length > 0) {
            const inventory = sceneObjectPart.ele('TaskInventory');
            for (const inv of this.inventory) {
                await this.getInventoryXML(inventory, inv);
            }
        }
        if (this.linksetData !== undefined) {
            const lsData = sceneObjectPart.ele('LinksetData');
            for (const k of Array.from(this.linksetData.keys())) {
                const d = this.linksetData.get(k);
                if (d === undefined) {
                    continue;
                }
                const dataEntry = lsData.ele('LinksetDataEntry');
                dataEntry.ele('Key', k);
                dataEntry.ele('Value', d.value);
                dataEntry.ele('Hash', d.pass);
            }
        }
    }
}
exports.GameObject = GameObject;
//# sourceMappingURL=GameObject.js.map