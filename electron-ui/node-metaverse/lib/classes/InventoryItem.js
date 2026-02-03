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
exports.InventoryItem = void 0;
const LLSD = __importStar(require("@caspertech/llsd"));
const builder = __importStar(require("xmlbuilder"));
const crypto = __importStar(require("crypto"));
const AssetType_1 = require("../enums/AssetType");
const FilterResponse_1 = require("../enums/FilterResponse");
const InventoryType_1 = require("../enums/InventoryType");
const Message_1 = require("../enums/Message");
const PacketFlags_1 = require("../enums/PacketFlags");
const PermissionMask_1 = require("../enums/PermissionMask");
const SaleTypeLL_1 = require("../enums/SaleTypeLL");
const InventoryFolder_1 = require("./InventoryFolder");
const DetachAttachmentIntoInv_1 = require("./messages/DetachAttachmentIntoInv");
const MoveInventoryItem_1 = require("./messages/MoveInventoryItem");
const MoveTaskInventory_1 = require("./messages/MoveTaskInventory");
const RemoveInventoryItem_1 = require("./messages/RemoveInventoryItem");
const RezObject_1 = require("./messages/RezObject");
const RezSingleAttachmentFromInv_1 = require("./messages/RezSingleAttachmentFromInv");
const UpdateInventoryItem_1 = require("./messages/UpdateInventoryItem");
const UpdateTaskInventory_1 = require("./messages/UpdateTaskInventory");
const Utils_1 = require("./Utils");
const UUID_1 = require("./UUID");
const Vector3_1 = require("./Vector3");
const CopyInventoryItem_1 = require("./messages/CopyInventoryItem");
const AssetTypeRegistry_1 = require("./AssetTypeRegistry");
const InventoryTypeRegistry_1 = require("./InventoryTypeRegistry");
const GameObject_1 = require("./public/GameObject");
const GetScriptRunning_1 = require("./messages/GetScriptRunning");
const ScriptRunningReply_1 = require("./messages/ScriptRunningReply");
const SetScriptRunning_1 = require("./messages/SetScriptRunning");
class InventoryItem {
    container;
    agent;
    assetID = UUID_1.UUID.zero();
    inventoryType;
    name;
    metadata;
    salePrice;
    saleType;
    created;
    parentID;
    flags;
    itemID;
    oldItemID;
    parentPartID;
    permsGranter;
    description;
    type;
    callbackID;
    scriptRunning;
    scriptMono;
    permissions = {
        baseMask: 0,
        groupMask: 0,
        nextOwnerMask: 0,
        ownerMask: 0,
        everyoneMask: 0,
        lastOwner: UUID_1.UUID.zero(),
        owner: UUID_1.UUID.zero(),
        creator: UUID_1.UUID.zero(),
        group: UUID_1.UUID.zero(),
        groupOwned: false
    };
    constructor(container, agent) {
        this.container = container;
        this.agent = agent;
    }
    static fromEmbeddedAsset(lineObj, container, agent) {
        const item = new InventoryItem(container, agent);
        let contMetadata = false;
        let contName = false;
        let contDesc = false;
        while (lineObj.lineNum < lineObj.lines.length) {
            let line = Utils_1.Utils.getNotecardLine(lineObj);
            if (contMetadata) {
                const idx = line.indexOf('|');
                if (idx !== -1) {
                    item.metadata += '\n' + line.substring(0, idx);
                    line = line.substring(idx + 1);
                    contMetadata = false;
                    if (line.length === 0) {
                        continue;
                    }
                }
                else {
                    item.metadata += line;
                    continue;
                }
            }
            if (contName) {
                const idx = line.indexOf('|');
                if (idx !== -1) {
                    item.name += '\n' + line.substring(0, idx);
                    line = line.substring(idx + 1);
                    contName = false;
                    if (line.length === 0) {
                        continue;
                    }
                }
                else {
                    item.name += line;
                    continue;
                }
            }
            if (contDesc) {
                const idx = line.indexOf('|');
                if (idx !== -1) {
                    item.description += '\n' + line.substring(0, idx);
                    line = line.substring(idx + 1);
                    contDesc = false;
                    if (line.length === 0) {
                        continue;
                    }
                }
                else {
                    item.description += line;
                    continue;
                }
            }
            let result = Utils_1.Utils.parseLine(line);
            if (result.key !== null) {
                if (result.key === '{') {
                    // do nothing
                }
                else if (result.key === '}') {
                    break;
                }
                else if (result.key === 'item_id') {
                    item.itemID = new UUID_1.UUID(result.value);
                }
                else if (result.key === 'parent_id') {
                    item.parentID = new UUID_1.UUID(result.value);
                }
                else if (result.key === 'permissions') {
                    while (lineObj.lineNum < lineObj.lines.length) {
                        result = Utils_1.Utils.parseLine(Utils_1.Utils.getNotecardLine(lineObj));
                        if (result.key !== null) {
                            if (result.key === '{') {
                                // do nothing
                            }
                            else if (result.key === '}') {
                                break;
                            }
                            else if (result.key === 'creator_mask') {
                                item.permissions.baseMask = parseInt(result.value, 16);
                            }
                            else if (result.key === 'base_mask') {
                                item.permissions.baseMask = parseInt(result.value, 16);
                            }
                            else if (result.key === 'owner_mask') {
                                item.permissions.ownerMask = parseInt(result.value, 16);
                            }
                            else if (result.key === 'group_mask') {
                                item.permissions.groupMask = parseInt(result.value, 16);
                            }
                            else if (result.key === 'everyone_mask') {
                                item.permissions.everyoneMask = parseInt(result.value, 16);
                            }
                            else if (result.key === 'next_owner_mask') {
                                item.permissions.nextOwnerMask = parseInt(result.value, 16);
                            }
                            else if (result.key === 'creator_id') {
                                item.permissions.creator = new UUID_1.UUID(result.value);
                            }
                            else if (result.key === 'owner_id') {
                                item.permissions.owner = new UUID_1.UUID(result.value);
                            }
                            else if (result.key === 'last_owner_id') {
                                item.permissions.lastOwner = new UUID_1.UUID(result.value);
                            }
                            else if (result.key === 'group_id') {
                                item.permissions.group = new UUID_1.UUID(result.value);
                            }
                            else if (result.key === 'group_owned') {
                                const val = parseInt(result.value, 10);
                                item.permissions.groupOwned = (val !== 0);
                            }
                            else {
                                console.log('Unrecognised key (4): ' + result.key);
                            }
                        }
                    }
                }
                else if (result.key === 'sale_info') {
                    while (lineObj.lineNum < lineObj.lines.length) {
                        result = Utils_1.Utils.parseLine(Utils_1.Utils.getNotecardLine(lineObj));
                        if (result.key !== null) {
                            if (result.key === '{') {
                                // do nothing
                            }
                            else if (result.key === '}') {
                                break;
                            }
                            else if (result.key === 'sale_type') {
                                const typeString = result.value;
                                item.saleType = parseInt(SaleTypeLL_1.SaleTypeLL[typeString], 10);
                            }
                            else if (result.key === 'sale_price') {
                                item.salePrice = parseInt(result.value, 10);
                            }
                            else {
                                console.log('Unrecognised key (3): ' + result.key);
                            }
                        }
                    }
                }
                else if (result.key === 'shadow_id') {
                    item.assetID = new UUID_1.UUID(result.value).bitwiseXor(new UUID_1.UUID('3c115e51-04f4-523c-9fa6-98aff1034730'));
                }
                else if (result.key === 'asset_id') {
                    item.assetID = new UUID_1.UUID(result.value);
                }
                else if (result.key === 'type') {
                    const typeString = result.value;
                    const type = AssetTypeRegistry_1.AssetTypeRegistry.getTypeFromTypeName(typeString);
                    if (type !== undefined) {
                        item.type = type.type;
                    }
                }
                else if (result.key === 'inv_type') {
                    const t = InventoryTypeRegistry_1.InventoryTypeRegistry.getTypeFromTypeName(String(result.value));
                    item.inventoryType = t?.type ?? InventoryType_1.InventoryType.Unknown;
                }
                else if (result.key === 'flags') {
                    item.flags = parseInt(result.value, 16);
                }
                else if (result.key === 'name') {
                    if (result.value.includes('|')) {
                        item.name = result.value.substring(0, result.value.indexOf('|'));
                    }
                    else {
                        contName = true;
                        item.name = result.value;
                    }
                }
                else if (result.key === 'desc') {
                    if (result.value.includes('|')) {
                        item.description = result.value.substring(0, result.value.indexOf('|'));
                    }
                    else {
                        contDesc = true;
                        item.description = result.value;
                    }
                }
                else if (result.key === 'creation_date') {
                    item.created = new Date(parseInt(result.value, 10) * 1000);
                }
                else if (result.key === 'metadata') {
                    if (result.value.includes('|')) {
                        item.metadata = result.value.substring(0, result.value.indexOf('|'));
                    }
                    else {
                        contMetadata = true;
                        item.metadata = result.value;
                    }
                }
                else {
                    console.log('Unrecognised key (2): ' + result.key);
                }
            }
        }
        return item;
    }
    static async fromXML(xml) {
        const parsed = await Utils_1.Utils.parseXML(xml);
        if (!parsed.InventoryItem) {
            throw new Error('InventoryItem not found');
        }
        const inventoryItem = new InventoryItem();
        const result = parsed.InventoryItem;
        let prop = null;
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'Name')) !== undefined) {
            inventoryItem.name = prop.toString();
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'ID')) !== undefined) {
            try {
                inventoryItem.itemID = new UUID_1.UUID(prop.toString());
            }
            catch (error) {
                console.error(error);
            }
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'InvType')) !== undefined) {
            inventoryItem.inventoryType = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'Type')) !== undefined) {
            inventoryItem.type = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'ScriptRunning')) !== undefined) {
            inventoryItem.scriptRunning = prop === true;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'ScriptMono')) !== undefined) {
            inventoryItem.scriptMono = prop === true;
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'CreatorUUID')) !== undefined) {
            try {
                inventoryItem.permissions.creator = new UUID_1.UUID(prop.toString());
            }
            catch (err) {
                console.error(err);
            }
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'CreationDate')) !== undefined) {
            try {
                inventoryItem.created = new Date(parseInt(prop, 10) * 1000);
            }
            catch (err) {
                console.error(err);
            }
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'Owner')) !== undefined) {
            try {
                inventoryItem.permissions.owner = new UUID_1.UUID(prop.toString());
            }
            catch (err) {
                console.error(err);
            }
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'Description')) !== undefined) {
            inventoryItem.description = prop.toString();
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'AssetType')) !== undefined) {
            inventoryItem.type = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'AssetID')) !== undefined) {
            try {
                inventoryItem.assetID = new UUID_1.UUID(prop.toString());
            }
            catch (err) {
                console.error(err);
            }
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'SaleType')) !== undefined) {
            inventoryItem.saleType = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'SalePrice')) !== undefined) {
            inventoryItem.salePrice = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'BasePermissions')) !== undefined) {
            inventoryItem.permissions.baseMask = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'CurrentPermissions')) !== undefined) {
            inventoryItem.permissions.ownerMask = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'EveryonePermissions')) !== undefined) {
            inventoryItem.permissions.everyoneMask = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'NextPermissions')) !== undefined) {
            inventoryItem.permissions.nextOwnerMask = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'Flags')) !== undefined) {
            inventoryItem.flags = parseInt(prop, 10);
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'GroupID')) !== undefined) {
            try {
                inventoryItem.permissions.group = new UUID_1.UUID(prop.toString());
            }
            catch (err) {
                console.error(err);
            }
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'LastOwner')) !== undefined) {
            try {
                inventoryItem.permissions.lastOwner = new UUID_1.UUID(prop.toString());
            }
            catch (err) {
                console.error(err);
            }
        }
        if ((prop = Utils_1.Utils.getFromXMLJS(result, 'GroupOwned')) !== undefined) {
            inventoryItem.permissions.groupOwned = parseInt(prop, 10) > 0;
        }
        return inventoryItem;
    }
    toAsset(indent = '') {
        const lines = [];
        lines.push('{');
        lines.push('\titem_id\t' + this.itemID.toString());
        lines.push('\tparent_id\t' + this.parentID.toString());
        lines.push('permissions 0');
        lines.push('{');
        lines.push('\tbase_mask\t' + Utils_1.Utils.numberToFixedHex(this.permissions.baseMask));
        lines.push('\towner_mask\t' + Utils_1.Utils.numberToFixedHex(this.permissions.ownerMask));
        lines.push('\tgroup_mask\t' + Utils_1.Utils.numberToFixedHex(this.permissions.groupMask));
        lines.push('\teveryone_mask\t' + Utils_1.Utils.numberToFixedHex(this.permissions.everyoneMask));
        lines.push('\tnext_owner_mask\t' + Utils_1.Utils.numberToFixedHex(this.permissions.nextOwnerMask));
        lines.push('\tcreator_id\t' + this.permissions.creator.toString());
        lines.push('\towner_id\t' + this.permissions.owner.toString());
        lines.push('\tlast_owner_id\t' + this.permissions.lastOwner.toString());
        lines.push('\tgroup_id\t' + this.permissions.group.toString());
        lines.push('}');
        lines.push('\tasset_id\t' + this.assetID.toString());
        lines.push('\ttype\t' + AssetTypeRegistry_1.AssetTypeRegistry.getTypeName(this.type));
        lines.push('\tinv_type\t' + InventoryTypeRegistry_1.InventoryTypeRegistry.getTypeName(this.inventoryType));
        lines.push('\tflags\t' + Utils_1.Utils.numberToFixedHex(this.flags));
        lines.push('sale_info\t0');
        lines.push('{');
        switch (this.saleType) {
            case 0:
                lines.push('\tsale_type\tnot');
                break;
            case 1:
                lines.push('\tsale_type\torig');
                break;
            case 2:
                lines.push('\tsale_type\tcopy');
                break;
            case 3:
                lines.push('\tsale_type\tcntn');
                break;
        }
        lines.push('\tsale_price\t' + this.salePrice);
        lines.push('}');
        lines.push('\tname\t' + this.name + '|');
        lines.push('\tdesc\t' + this.description + '|');
        lines.push('\tcreation_date\t' + Math.floor(this.created.getTime() / 1000));
        lines.push('}');
        return indent + lines.join('\n' + indent);
    }
    getCRC() {
        let crc = 0;
        crc = crc + this.itemID.CRC() >>> 0;
        crc = crc + this.parentID.CRC() >>> 0;
        crc = crc + this.permissions.creator.CRC() >>> 0;
        crc = crc + this.permissions.owner.CRC() >>> 0;
        crc = crc + this.permissions.group.CRC() >>> 0;
        crc = crc + this.permissions.baseMask >>> 0;
        crc = crc + this.permissions.ownerMask >>> 0;
        crc = crc + this.permissions.everyoneMask >>> 0;
        crc = crc + this.permissions.groupMask >>> 0;
        crc = crc + this.assetID.CRC() >>> 0;
        crc = crc + this.type >>> 0;
        crc = crc + this.inventoryType >>> 0;
        crc = crc + this.flags >>> 0;
        crc = crc + this.salePrice >>> 0;
        crc = crc + (this.saleType * 0x07073096 >>> 0) >>> 0;
        crc = crc + Math.round(this.created.getTime() / 1000) >>> 0;
        return crc;
    }
    async update() {
        if (this.agent === undefined) {
            throw new Error('This inventoryItem is local only and cannot be updated');
        }
        const msg = new UpdateInventoryItem_1.UpdateInventoryItemMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.agent.currentRegion.circuit.sessionID,
            TransactionID: UUID_1.UUID.random()
        };
        msg.InventoryData = [{
                ItemID: this.itemID,
                FolderID: this.parentID,
                CreatorID: this.permissions.creator,
                OwnerID: this.permissions.owner,
                GroupID: this.permissions.group,
                BaseMask: this.permissions.baseMask,
                OwnerMask: this.permissions.ownerMask,
                GroupMask: this.permissions.groupMask,
                EveryoneMask: this.permissions.everyoneMask,
                NextOwnerMask: this.permissions.nextOwnerMask,
                GroupOwned: this.permissions.groupOwned ?? false,
                TransactionID: UUID_1.UUID.zero(),
                CallbackID: 0,
                Type: this.type,
                InvType: this.inventoryType,
                Flags: this.flags,
                SaleType: this.saleType,
                SalePrice: this.salePrice,
                Name: Utils_1.Utils.StringToBuffer(this.name),
                Description: Utils_1.Utils.StringToBuffer(this.description),
                CreationDate: this.created.getTime() / 1000,
                CRC: this.getCRC()
            }];
        const ack = this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return this.agent.currentRegion.circuit.waitForAck(ack, 10000);
    }
    async moveToFolder(targetFolder) {
        if (this.agent !== undefined) {
            if (this.container instanceof GameObject_1.GameObject) {
                const msg = new MoveTaskInventory_1.MoveTaskInventoryMessage();
                msg.AgentData = {
                    AgentID: this.agent.agentID,
                    SessionID: this.agent.currentRegion.circuit.sessionID,
                    FolderID: targetFolder.folderID
                };
                msg.InventoryData = {
                    LocalID: this.container.ID,
                    ItemID: this.itemID
                };
                this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
                const response = await this.agent.currentRegion.circuit.waitForMessage(Message_1.Message.UpdateCreateInventoryItem, 10000, (message) => {
                    for (const inv of message.InventoryData) {
                        if (Utils_1.Utils.BufferToStringSimple(inv.Name) === this.name) {
                            return FilterResponse_1.FilterResponse.Finish;
                        }
                    }
                    return FilterResponse_1.FilterResponse.NoMatch;
                });
                for (const inv of response.InventoryData) {
                    if (Utils_1.Utils.BufferToStringSimple(inv.Name) === this.name) {
                        const item = await this.agent.inventory.fetchInventoryItem(inv.ItemID);
                        if (item === null) {
                            throw new Error('Unable to get inventory item after move');
                        }
                        if (!item.parentID.equals(targetFolder.folderID)) {
                            await item.moveToFolder(targetFolder);
                        }
                        return item;
                    }
                }
                throw new Error('Unable to get inventory item after move');
            }
            else {
                const msg = new MoveInventoryItem_1.MoveInventoryItemMessage();
                msg.AgentData = {
                    AgentID: this.agent.agentID,
                    SessionID: this.agent.currentRegion.circuit.sessionID,
                    Stamp: false
                };
                msg.InventoryData = [
                    {
                        ItemID: this.itemID,
                        FolderID: targetFolder.folderID,
                        NewName: Buffer.alloc(0)
                    }
                ];
                const ack = this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
                await this.agent.currentRegion.circuit.waitForAck(ack, 10000);
                const item = await this.agent.inventory.fetchInventoryItem(this.itemID);
                if (item === null) {
                    throw new Error('Unable to find inventory item after move');
                }
                return item;
            }
        }
        else {
            throw new Error('This inventoryItem is local only and cannot be moved to a folder');
        }
    }
    async delete() {
        if (this.agent !== undefined) {
            const msg = new RemoveInventoryItem_1.RemoveInventoryItemMessage();
            msg.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.agent.currentRegion.circuit.sessionID
            };
            msg.InventoryData = [
                {
                    ItemID: this.itemID
                }
            ];
            const ack = this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
            return this.agent.currentRegion.circuit.waitForAck(ack, 10000);
        }
        else {
            throw new Error('This inventoryItem is local only and cannot be deleted');
        }
    }
    // noinspection JSUnusedGlobalSymbols
    exportXML() {
        const document = builder.create('InventoryItem');
        document.ele('Name', this.name);
        document.ele('ID', this.itemID.toString());
        document.ele('InvType', this.inventoryType);
        document.ele('CreatorUUID', this.permissions.creator.toString());
        document.ele('CreationDate', this.created.getTime() / 1000);
        document.ele('Owner', this.permissions.owner.toString());
        document.ele('LastOwner', this.permissions.lastOwner.toString());
        document.ele('Description', this.description);
        document.ele('AssetType', this.type);
        document.ele('AssetID', this.assetID.toString());
        document.ele('SaleType', this.saleType);
        document.ele('SalePrice', this.salePrice);
        document.ele('BasePermissions', this.permissions.baseMask);
        document.ele('CurrentPermissions', this.permissions.ownerMask);
        document.ele('EveryonePermissions', this.permissions.everyoneMask);
        document.ele('NextPermissions', this.permissions.nextOwnerMask);
        document.ele('Flags', this.flags);
        document.ele('GroupID', this.permissions.group.toString());
        document.ele('GroupOwned', this.permissions.groupOwned);
        if (this.type === AssetType_1.AssetType.LSLText) {
            document.ele('ScriptRunning', this.scriptRunning);
            document.ele('ScriptMono', this.scriptMono);
        }
        return document.end({ pretty: true, allowEmpty: true });
    }
    // noinspection JSUnusedGlobalSymbols
    async detachFromAvatar() {
        if (this.agent === undefined) {
            throw new Error('This inventory item was created locally. Please import to the grid.');
        }
        const msg = new DetachAttachmentIntoInv_1.DetachAttachmentIntoInvMessage();
        msg.ObjectData = {
            AgentID: this.agent.agentID,
            ItemID: this.itemID
        };
        const ack = this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return this.agent.currentRegion.circuit.waitForAck(ack, 10000);
    }
    // noinspection JSUnusedGlobalSymbols
    async attachToAvatar(attachPoint, timeout = 10000) {
        return new Promise((resolve, reject) => {
            if (this.agent === undefined) {
                throw new Error('This inventory item was created locally. Please import to the grid.');
            }
            const rsafi = new RezSingleAttachmentFromInv_1.RezSingleAttachmentFromInvMessage();
            rsafi.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.agent.currentRegion.circuit.sessionID
            };
            rsafi.ObjectData = {
                ItemID: this.itemID,
                OwnerID: this.permissions.owner,
                AttachmentPt: 0x80 | attachPoint,
                ItemFlags: this.flags,
                GroupMask: this.permissions.groupMask,
                EveryoneMask: this.permissions.everyoneMask,
                NextOwnerMask: this.permissions.nextOwnerMask,
                Name: Utils_1.Utils.StringToBuffer(this.name),
                Description: Utils_1.Utils.StringToBuffer(this.description)
            };
            const avatar = this.agent.currentRegion.clientCommands.agent.getAvatar();
            if (avatar === undefined) {
                throw new Error('Avatar could not be found');
            }
            let subs = undefined;
            let tmout = undefined;
            subs = avatar.onAttachmentAdded.subscribe((obj) => {
                if (obj.name === this.name) {
                    if (subs !== undefined) {
                        subs.unsubscribe();
                        subs = undefined;
                    }
                    if (tmout !== undefined) {
                        clearTimeout(tmout);
                        tmout = undefined;
                    }
                    resolve(obj);
                }
            });
            setTimeout(() => {
                if (subs !== undefined) {
                    subs.unsubscribe();
                    subs = undefined;
                }
                if (tmout !== undefined) {
                    clearTimeout(tmout);
                    tmout = undefined;
                }
                reject(new Error('Attach to avatar timed out'));
            }, timeout);
            this.agent.currentRegion.circuit.sendMessage(rsafi, PacketFlags_1.PacketFlags.Reliable);
        });
    }
    // noinspection JSUnusedGlobalSymbols
    async rezGroupInWorld(position) {
        return new Promise((resolve, reject) => {
            if (this.agent === undefined) {
                reject(new Error('This InventoryItem is local only, so cant rez'));
                return;
            }
            const queryID = UUID_1.UUID.random();
            const msg = new RezObject_1.RezObjectMessage();
            msg.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.agent.currentRegion.circuit.sessionID,
                GroupID: UUID_1.UUID.zero()
            };
            msg.RezData = {
                FromTaskID: (this.container instanceof GameObject_1.GameObject) ? this.container.FullID : UUID_1.UUID.zero(),
                BypassRaycast: 1,
                RayStart: position,
                RayEnd: position,
                RayTargetID: UUID_1.UUID.zero(),
                RayEndIsIntersection: false,
                RezSelected: true,
                RemoveItem: false,
                ItemFlags: this.flags,
                GroupMask: PermissionMask_1.PermissionMask.All,
                EveryoneMask: PermissionMask_1.PermissionMask.All,
                NextOwnerMask: PermissionMask_1.PermissionMask.All,
            };
            msg.InventoryData = {
                ItemID: this.itemID,
                FolderID: this.parentID,
                CreatorID: this.permissions.creator,
                OwnerID: this.permissions.owner,
                GroupID: this.permissions.group,
                BaseMask: this.permissions.baseMask,
                OwnerMask: this.permissions.ownerMask,
                GroupMask: this.permissions.groupMask,
                EveryoneMask: this.permissions.everyoneMask,
                NextOwnerMask: this.permissions.nextOwnerMask,
                GroupOwned: false,
                TransactionID: queryID,
                Type: this.type,
                InvType: this.inventoryType,
                Flags: this.flags,
                SaleType: this.saleType,
                SalePrice: this.salePrice,
                Name: Utils_1.Utils.StringToBuffer(this.name),
                Description: Utils_1.Utils.StringToBuffer(this.description),
                CreationDate: Math.round(this.created.getTime() / 1000),
                CRC: 0,
            };
            let objSub = undefined;
            const agent = this.agent;
            const gotObjects = [];
            objSub = this.agent.currentRegion.clientEvents.onNewObjectEvent.subscribe((evt) => {
                (async () => {
                    if (evt.createSelected && !evt.object.resolvedAt) {
                        // We need to get the full ObjectProperties so we can be sure this is or isn't a rez from inventory
                        await agent.currentRegion.clientCommands.region.resolveObject(evt.object, {});
                    }
                    if (evt.createSelected && !evt.object.claimedForBuild) {
                        if (evt.object.itemID?.equals(this.itemID)) {
                            evt.object.claimedForBuild = true;
                            gotObjects.push(evt.object);
                        }
                    }
                })().catch((_e) => {
                    // ignore
                });
            });
            // We have no way of knowing when the cluster is finished rezzing, so we just wait for 30 seconds
            setTimeout(() => {
                if (objSub !== undefined) {
                    objSub.unsubscribe();
                    objSub = undefined;
                }
                if (gotObjects.length > 0) {
                    resolve(gotObjects);
                }
                else {
                    reject(new Error('No objects arrived'));
                }
            }, 30000);
            // Move the camera to look directly at prim for faster capture
            const camLocation = new Vector3_1.Vector3(position);
            camLocation.z += (5) + 1;
            this.agent.currentRegion.clientCommands.agent.setCamera(camLocation, position, 256, new Vector3_1.Vector3([-1.0, 0, 0]), new Vector3_1.Vector3([0.0, 1.0, 0]));
            this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        });
    }
    async rezInWorld(position, objectScale) {
        return new Promise((resolve, reject) => {
            if (this.agent === undefined) {
                reject(new Error('This InventoryItem is local only, so cant rez'));
                return;
            }
            const queryID = UUID_1.UUID.random();
            const msg = new RezObject_1.RezObjectMessage();
            msg.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.agent.currentRegion.circuit.sessionID,
                GroupID: UUID_1.UUID.zero()
            };
            msg.RezData = {
                FromTaskID: (this.container instanceof GameObject_1.GameObject) ? this.container.FullID : UUID_1.UUID.zero(),
                BypassRaycast: 1,
                RayStart: position,
                RayEnd: position,
                RayTargetID: UUID_1.UUID.zero(),
                RayEndIsIntersection: false,
                RezSelected: true,
                RemoveItem: false,
                ItemFlags: this.flags,
                GroupMask: PermissionMask_1.PermissionMask.All,
                EveryoneMask: PermissionMask_1.PermissionMask.All,
                NextOwnerMask: PermissionMask_1.PermissionMask.All,
            };
            msg.InventoryData = {
                ItemID: this.itemID,
                FolderID: this.parentID,
                CreatorID: this.permissions.creator,
                OwnerID: this.permissions.owner,
                GroupID: this.permissions.group,
                BaseMask: this.permissions.baseMask,
                OwnerMask: this.permissions.ownerMask,
                GroupMask: this.permissions.groupMask,
                EveryoneMask: this.permissions.everyoneMask,
                NextOwnerMask: this.permissions.nextOwnerMask,
                GroupOwned: false,
                TransactionID: queryID,
                Type: this.type,
                InvType: this.inventoryType,
                Flags: this.flags,
                SaleType: this.saleType,
                SalePrice: this.salePrice,
                Name: Utils_1.Utils.StringToBuffer(this.name),
                Description: Utils_1.Utils.StringToBuffer(this.description),
                CreationDate: Math.round(this.created.getTime() / 1000),
                CRC: 0,
            };
            let objSub = undefined;
            let timeout = setTimeout(() => {
                if (objSub !== undefined) {
                    objSub.unsubscribe();
                    objSub = undefined;
                }
                if (timeout !== undefined) {
                    clearTimeout(timeout);
                    timeout = undefined;
                }
                reject(new Error('Prim never arrived'));
            }, 10000);
            let claimedPrim = false;
            const agent = this.agent;
            objSub = this.agent.currentRegion.clientEvents.onNewObjectEvent.subscribe((evt) => {
                (async () => {
                    if (evt.createSelected && !evt.object.resolvedAt) {
                        // We need to get the full ObjectProperties so we can be sure this is or isn't a rez from inventory
                        await agent.currentRegion.clientCommands.region.resolveObject(evt.object, {});
                    }
                    if (evt.createSelected && !evt.object.claimedForBuild && !claimedPrim) {
                        if (evt.object.itemID?.equals(this.itemID)) {
                            if (objSub !== undefined) {
                                objSub.unsubscribe();
                                objSub = undefined;
                            }
                            if (timeout !== undefined) {
                                clearTimeout(timeout);
                                timeout = undefined;
                            }
                            evt.object.claimedForBuild = true;
                            claimedPrim = true;
                            resolve(evt.object);
                        }
                    }
                })().catch((_e) => {
                    // ignore
                });
            });
            // Move the camera to look directly at prim for faster capture
            let height = 10;
            if (objectScale !== undefined) {
                height = objectScale.z;
            }
            const camLocation = new Vector3_1.Vector3(position);
            camLocation.z += (height / 2) + 1;
            this.agent.currentRegion.clientCommands.agent.setCamera(camLocation, position, height, new Vector3_1.Vector3([-1.0, 0, 0]), new Vector3_1.Vector3([0.0, 1.0, 0]));
            this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        });
    }
    // noinspection JSUnusedGlobalSymbols
    async rename(newName) {
        this.name = newName;
        if (this.agent === undefined) {
            return;
        }
        if (this.container instanceof GameObject_1.GameObject) {
            const msg = new UpdateTaskInventory_1.UpdateTaskInventoryMessage();
            if (this.description == '') {
                this.description = '(No Description)';
            }
            msg.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.agent.currentRegion.circuit.sessionID
            };
            msg.UpdateData = {
                Key: 0,
                LocalID: this.container.ID
            };
            msg.InventoryData = {
                ItemID: this.itemID,
                FolderID: this.parentID,
                CreatorID: this.permissions.creator,
                OwnerID: this.agent.agentID,
                GroupID: this.permissions.group,
                BaseMask: this.permissions.baseMask,
                OwnerMask: this.permissions.ownerMask,
                GroupMask: this.permissions.groupMask,
                EveryoneMask: this.permissions.everyoneMask,
                NextOwnerMask: this.permissions.nextOwnerMask,
                GroupOwned: this.permissions.groupOwned ?? false,
                TransactionID: UUID_1.UUID.zero(),
                Type: this.type,
                InvType: this.inventoryType,
                Flags: this.flags,
                SaleType: this.saleType,
                SalePrice: this.salePrice,
                Name: Utils_1.Utils.StringToBuffer(this.name),
                Description: Utils_1.Utils.StringToBuffer(this.description),
                CreationDate: this.created.getTime() / 1000,
                CRC: this.getCRC()
            };
            return this.agent.currentRegion.circuit.waitForAck(this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable), 10000);
        }
        else if (this.container instanceof InventoryFolder_1.InventoryFolder) {
            this.name = newName;
            return this.update();
        }
        else {
            throw new Error('Item has no container, cannot be renamed');
        }
    }
    // noinspection JSUnusedGlobalSymbols
    async isScriptRunning() {
        if (this.type !== AssetType_1.AssetType.LSLText) {
            throw new Error('Item is not a script');
        }
        if (!(this.container instanceof GameObject_1.GameObject)) {
            throw new Error('Script can only be running inside a GameObject container');
        }
        const isr = new GetScriptRunning_1.GetScriptRunningMessage();
        isr.Script = {
            ObjectID: this.container.FullID,
            ItemID: this.itemID
        };
        const objID = this.container.FullID;
        const event = this.container.region.clientEvents.waitForEvent(this.container.region.clientEvents.onScriptRunningReply, (evt) => {
            if (evt.ItemID.equals(this.itemID) &&
                evt.ObjectID.equals(objID)) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        const legacy = this.container.region.circuit.sendAndWaitForMessage(isr, PacketFlags_1.PacketFlags.Reliable, Message_1.Message.ScriptRunningReply, 10000, (message) => {
            if (message.Script.ItemID.equals(this.itemID) &&
                message.Script.ObjectID.equals(objID)) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        const result = await Promise.race([event, legacy]);
        if (result instanceof ScriptRunningReply_1.ScriptRunningReplyMessage) {
            this.scriptRunning = result.Script.Running;
        }
        else {
            this.scriptRunning = result.Running;
            this.scriptMono = result.Mono;
        }
        return this.scriptRunning;
    }
    async copyTo(target, name) {
        const msg = new CopyInventoryItem_1.CopyInventoryItemMessage();
        if (this.agent === undefined) {
            throw new Error('No active agent');
        }
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.agent.currentRegion.circuit.sessionID
        };
        const bytes = crypto.randomBytes(4);
        const callbackID = bytes.readUInt32LE(0);
        msg.InventoryData = [{
                CallbackID: callbackID,
                OldAgentID: this.agent.agentID,
                OldItemID: this.itemID,
                NewFolderID: target.folderID,
                NewName: Utils_1.Utils.StringToBuffer(name)
            }];
        this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const cbMsg = await this.waitForCallbackID(callbackID);
        for (const cbItem of cbMsg.itemData) {
            if (cbItem.callbackID === callbackID) {
                const item = await this.agent.inventory.fetchInventoryItem(cbItem.itemID);
                if (item !== null) {
                    return item;
                }
            }
        }
        throw new Error('Unable to locate inventory item after copy');
    }
    // noinspection JSUnusedGlobalSymbols
    async updateScript(scriptAsset, running = true, target = 'mono') {
        if (this.agent === undefined) {
            throw new Error('This item was created locally and can\'t be updated');
        }
        if (this.container instanceof GameObject_1.GameObject) {
            try {
                const result = await this.agent.currentRegion.caps.capsPostXML('UpdateScriptTask', {
                    'item_id': new LLSD.UUID(this.itemID.toString()),
                    'task_id': new LLSD.UUID(this.container.FullID.toString()),
                    'is_script_running': running ? 1 : 0,
                    'target': target
                });
                if (result.uploader) {
                    const uploader = result.uploader;
                    const uploadResult = await this.agent.currentRegion.caps.capsRequestUpload(uploader, scriptAsset);
                    if (uploadResult.state && uploadResult.state === 'complete') {
                        return new UUID_1.UUID(uploadResult.new_asset.toString());
                    }
                }
                throw new Error('Asset upload failed');
            }
            catch (err) {
                console.error(err);
                throw err;
            }
        }
        else {
            throw new Error('Agent inventory not supported just yet');
        }
    }
    async setScriptRunning(running) {
        if (this.agent === undefined) {
            throw new Error('This item was created locally and can\'t be updated');
        }
        if (this.type !== AssetType_1.AssetType.LSLText) {
            throw new Error('This is not a script');
        }
        if (this.container instanceof GameObject_1.GameObject) {
            const msg = new SetScriptRunning_1.SetScriptRunningMessage();
            msg.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.agent.currentRegion.circuit.sessionID,
            };
            msg.Script = {
                ObjectID: this.container.FullID,
                ItemID: this.itemID,
                Running: running
            };
            const ack = this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
            return this.agent.currentRegion.circuit.waitForAck(ack, 10000);
        }
        else {
            throw new Error('Script must be in an object to set state');
        }
    }
    async waitForCallbackID(callbackID) {
        if (!this.agent) {
            throw new Error('No active agent');
        }
        return Utils_1.Utils.waitOrTimeOut(this.agent.currentRegion.clientEvents.onBulkUpdateInventoryEvent, 10000, (event) => {
            for (const item of event.itemData) {
                if (item.callbackID === callbackID) {
                    return FilterResponse_1.FilterResponse.Finish;
                }
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
    }
}
exports.InventoryItem = InventoryItem;
//# sourceMappingURL=InventoryItem.js.map