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
exports.InventoryFolder = void 0;
const LLSD = __importStar(require("@caspertech/llsd"));
const fsSync = __importStar(require("fs"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const FilterResponse_1 = require("../enums/FilterResponse");
const FolderType_1 = require("../enums/FolderType");
const InventoryItemFlags_1 = require("../enums/InventoryItemFlags");
const InventoryLibrary_1 = require("../enums/InventoryLibrary");
const InventorySortOrder_1 = require("../enums/InventorySortOrder");
const InventoryType_1 = require("../enums/InventoryType");
const Message_1 = require("../enums/Message");
const PacketFlags_1 = require("../enums/PacketFlags");
const PermissionMask_1 = require("../enums/PermissionMask");
const WearableType_1 = require("../enums/WearableType");
const InventoryItem_1 = require("./InventoryItem");
const LLWearable_1 = require("./LLWearable");
const Logger_1 = require("./Logger");
const AssetUploadRequest_1 = require("./messages/AssetUploadRequest");
const CreateInventoryFolder_1 = require("./messages/CreateInventoryFolder");
const CreateInventoryItem_1 = require("./messages/CreateInventoryItem");
const LLMesh_1 = require("./public/LLMesh");
const Utils_1 = require("./Utils");
const UUID_1 = require("./UUID");
const AssetTypeRegistry_1 = require("./AssetTypeRegistry");
const InventoryTypeRegistry_1 = require("./InventoryTypeRegistry");
class InventoryFolder {
    typeDefault;
    version;
    name;
    folderID;
    parentID;
    items = [];
    folders = [];
    cacheDir;
    agent;
    library;
    callbackID = 1;
    inventoryBase;
    constructor(lib, invBase, agent) {
        this.agent = agent;
        this.library = lib;
        this.inventoryBase = invBase;
        const cacheLocation = path.resolve(__dirname + '/cache');
        if (!fsSync.existsSync(cacheLocation)) {
            fsSync.mkdirSync(cacheLocation, 0o777);
        }
        this.cacheDir = path.resolve(cacheLocation + '/' + this.agent.agentID.toString());
        if (!fsSync.existsSync(this.cacheDir)) {
            fsSync.mkdirSync(this.cacheDir, 0o777);
        }
    }
    getChildFolders() {
        const children = [];
        const ofi = this.folderID.toString();
        for (const folder of this.inventoryBase.skeleton.values()) {
            if (folder !== undefined && folder.parentID.toString() === ofi) {
                children.push(folder);
            }
        }
        return children;
    }
    getChildFoldersRecursive() {
        const children = [];
        const toBrowse = [this.folderID];
        while (toBrowse.length > 0) {
            const uuid = toBrowse.pop();
            if (!uuid) {
                break;
            }
            const folder = this.inventoryBase.skeleton.get(uuid.toString());
            if (folder) {
                for (const child of folder.getChildFolders()) {
                    children.push(child);
                    toBrowse.push(child.folderID);
                }
            }
        }
        return children;
    }
    async createFolder(name, type) {
        const msg = new CreateInventoryFolder_1.CreateInventoryFolderMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.agent.currentRegion.circuit.sessionID
        };
        msg.FolderData = {
            FolderID: UUID_1.UUID.random(),
            ParentID: this.folderID,
            Type: type,
            Name: Utils_1.Utils.StringToBuffer(name),
        };
        const ack = this.agent.currentRegion.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        await this.agent.currentRegion.circuit.waitForAck(ack, 10000);
        const requestFolder = {
            folder_id: new LLSD.UUID(this.folderID),
            owner_id: new LLSD.UUID(this.agent.agentID),
            fetch_folders: true,
            fetch_items: false,
            sort_order: InventorySortOrder_1.InventorySortOrder.ByName
        };
        const requestedFolders = {
            'folders': [
                requestFolder
            ]
        };
        let cmd = 'FetchInventoryDescendents2';
        if (this.library === InventoryLibrary_1.InventoryLibrary.Library) {
            cmd = 'FetchLibDescendents2';
        }
        const folderContents = await this.agent.currentRegion.caps.capsPostXML(cmd, requestedFolders);
        if (folderContents.folders?.[0]?.categories && folderContents.folders[0].categories.length > 0) {
            for (const folder of folderContents.folders[0].categories) {
                let folderID = folder.category_id;
                if (folderID === undefined) {
                    folderID = folder.folder_id;
                }
                if (folderID === undefined) {
                    continue;
                }
                const foundFolderID = new UUID_1.UUID(folderID.toString());
                if (foundFolderID.equals(msg.FolderData.FolderID)) {
                    const newFolder = new InventoryFolder(this.library, this.agent.inventory.main, this.agent);
                    newFolder.typeDefault = parseInt(folder.type_default, 10);
                    newFolder.version = parseInt(folder.version, 10);
                    newFolder.name = String(folder.name);
                    newFolder.folderID = new UUID_1.UUID(folderID);
                    newFolder.parentID = new UUID_1.UUID(folder.parent_id);
                    this.folders.push(newFolder);
                    return newFolder;
                }
            }
        }
        throw new Error('Failed to create inventory folder');
    }
    async delete(saveCache = false) {
        const { caps } = this.agent.currentRegion;
        const invCap = await caps.getCapability('InventoryAPIv3');
        await this.agent.currentRegion.caps.requestDelete(`${invCap}/category/${this.folderID.toString()}`);
        const folders = this.getChildFoldersRecursive();
        for (const folder of folders) {
            this.inventoryBase.skeleton.delete(folder.folderID.toString());
        }
        if (saveCache) {
            for (const folder of folders) {
                const fileName = path.join(this.cacheDir + '/' + folder.folderID.toString());
                try {
                    const stat = await fs.stat(fileName);
                    if (stat.isFile()) {
                        await fs.unlink(fileName);
                    }
                }
                catch (_error) {
                    // ignore
                }
            }
        }
    }
    async removeItem(itemID, save = false) {
        const item = this.agent.inventory.itemsByID.get(itemID.toString());
        if (item) {
            this.agent.inventory.itemsByID.delete(itemID.toString());
            this.items = this.items.filter((filterItem) => {
                return !filterItem.itemID.equals(itemID);
            });
        }
        if (save) {
            await this.saveCache();
        }
    }
    async addItem(item, save = false) {
        if (this.agent.inventory.itemsByID.has(item.itemID.toString())) {
            await this.removeItem(item.itemID, false);
        }
        this.items.push(item);
        this.agent.inventory.itemsByID.set(item.itemID.toString(), item);
        if (save) {
            await this.saveCache();
        }
    }
    async populate(useCached = true) {
        if (!useCached) {
            await this.populateInternal();
            return;
        }
        try {
            await this.loadCache();
        }
        catch (_e) {
            await this.populateInternal();
        }
    }
    async uploadAsset(type, inventoryType, data, name, description, flags = InventoryItemFlags_1.InventoryItemFlags.None) {
        switch (inventoryType) {
            case InventoryType_1.InventoryType.Wearable:
                {
                    // Wearables have to be uploaded using the legacy method and then created
                    const invItemID = await this.uploadInventoryAssetLegacy(type, inventoryType, data, name, description, flags);
                    const uploadedItem = await this.agent.inventory.fetchInventoryItem(invItemID);
                    if (uploadedItem === null) {
                        throw new Error('Unable to get inventory item');
                    }
                    else {
                        await this.addItem(uploadedItem, false);
                    }
                    return uploadedItem;
                }
            case InventoryType_1.InventoryType.Landmark:
            case InventoryType_1.InventoryType.Notecard:
            case InventoryType_1.InventoryType.Gesture:
            case InventoryType_1.InventoryType.LSL:
            case InventoryType_1.InventoryType.Settings:
            case InventoryType_1.InventoryType.Material:
                {
                    // These types must be created first and then modified
                    const invItemID = await this.uploadInventoryItem(type, inventoryType, data, name, description, flags);
                    const item = await this.agent.inventory.fetchInventoryItem(invItemID);
                    if (item === null) {
                        throw new Error('Unable to get inventory item');
                    }
                    else {
                        await this.addItem(item, false);
                    }
                    return item;
                }
            default:
                break;
        }
        const uploadCost = await this.agent.currentRegion.getUploadCost();
        Logger_1.Logger.Info('[' + name + ']');
        const response = await this.agent.currentRegion.caps.capsPostXML('NewFileAgentInventory', {
            'folder_id': new LLSD.UUID(this.folderID.toString()),
            'asset_type': AssetTypeRegistry_1.AssetTypeRegistry.getTypeName(type),
            'inventory_type': InventoryTypeRegistry_1.InventoryTypeRegistry.getTypeName(inventoryType),
            'name': name,
            'description': description,
            'everyone_mask': PermissionMask_1.PermissionMask.All,
            'group_mask': PermissionMask_1.PermissionMask.All,
            'next_owner_mask': PermissionMask_1.PermissionMask.All,
            'expected_upload_cost': uploadCost
        });
        if (response.state === 'upload') {
            const uploadURL = response.uploader;
            const responseUpload = await this.agent.currentRegion.caps.capsRequestUpload(uploadURL, data);
            if (responseUpload.new_inventory_item !== undefined) {
                const invItemID = new UUID_1.UUID(responseUpload.new_inventory_item.toString());
                const item = await this.agent.inventory.fetchInventoryItem(invItemID);
                if (item === null) {
                    throw new Error('Unable to get inventory item');
                }
                else {
                    await this.addItem(item, false);
                }
                return item;
            }
            else {
                throw new Error('Unable to upload asset');
            }
        }
        else if (response.error) {
            throw new Error(response.error.message);
        }
        else {
            throw new Error('Unable to upload asset');
        }
    }
    checkCopyright(creatorID) {
        if (!creatorID.equals(this.agent.agentID) && !creatorID.isZero()) {
            throw new Error('Unable to upload - copyright violation');
        }
    }
    findFolder(id) {
        for (const folder of this.folders) {
            if (folder.folderID.equals(id)) {
                return folder;
            }
            const result = folder.findFolder(id);
            if (result !== null) {
                return result;
            }
        }
        return null;
    }
    async uploadMesh(name, description, mesh, confirmCostCallback) {
        const decodedMesh = await LLMesh_1.LLMesh.from(mesh);
        if (decodedMesh.creatorID !== undefined) {
            this.checkCopyright(decodedMesh.creatorID);
        }
        const faces = [];
        const faceCount = decodedMesh.lodLevels.high_lod.length;
        for (let x = 0; x < faceCount; x++) {
            faces.push({
                'diffuse_color': [1.000000000000001, 1.000000000000001, 1.000000000000001, 1.000000000000001],
                'fullbright': false
            });
        }
        const prim = {
            'face_list': faces,
            'position': [0.000000000000001, 0.000000000000001, 0.000000000000001],
            'rotation': [0.000000000000001, 0.000000000000001, 0.000000000000001, 1.000000000000001],
            'scale': [2.000000000000001, 2.000000000000001, 2.000000000000001],
            'material': 3,
            'physics_shape_type': 2,
            'mesh': 0
        };
        const assetResources = {
            'instance_list': [prim],
            'mesh_list': [new LLSD.Binary(Array.from(mesh))],
            'texture_list': [],
            'metric': 'MUT_Unspecified'
        };
        const uploadMap = {
            'name': String(name),
            'description': String(description),
            'asset_resources': assetResources,
            'asset_type': 'mesh',
            'inventory_type': 'object',
            'folder_id': new LLSD.UUID(this.folderID.toString()),
            'texture_folder_id': new LLSD.UUID(this.agent.inventory.findFolderForType(FolderType_1.FolderType.Texture)),
            'everyone_mask': PermissionMask_1.PermissionMask.All,
            'group_mask': PermissionMask_1.PermissionMask.All,
            'next_owner_mask': PermissionMask_1.PermissionMask.All
        };
        let result = null;
        try {
            result = await this.agent.currentRegion.caps.capsPostXML('NewFileAgentInventory', uploadMap);
        }
        catch (error) {
            console.error(error);
        }
        if (result.state === 'upload' && result.upload_price !== undefined) {
            const cost = result.upload_price;
            if (await confirmCostCallback(cost)) {
                const uploader = result.uploader;
                const uploadResult = await this.agent.currentRegion.caps.capsPerformXMLPost(uploader, assetResources);
                if (uploadResult.new_inventory_item && uploadResult.new_asset) {
                    const inventoryItem = new UUID_1.UUID(uploadResult.new_inventory_item.toString());
                    const item = await this.agent.inventory.fetchInventoryItem(inventoryItem);
                    if (item !== null) {
                        item.assetID = new UUID_1.UUID(uploadResult.new_asset.toString());
                        await this.addItem(item, false);
                        return item;
                    }
                    else {
                        throw new Error('Unable to locate inventory item following mesh upload');
                    }
                }
                else {
                    throw new Error('Upload failed - no new inventory item returned');
                }
            }
            throw new Error('Upload cost declined');
        }
        else {
            console.log(result);
            console.log(JSON.stringify(result.error));
            throw new Error('Upload failed');
        }
    }
    async saveCache() {
        const json = {
            version: this.version,
            childItems: this.items,
            childFolders: this.folders
        };
        const fileName = path.join(this.cacheDir + '/' + this.folderID.toString() + '.json');
        const replacer = (key, value) => {
            if (key === 'container' || key === 'agent' || key === 'folders' || key === 'items' || key === 'cacheDir' || key === 'inventoryBase') {
                return undefined;
            }
            return value;
        };
        await fs.writeFile(fileName, JSON.stringify(json, replacer));
    }
    async loadCache() {
        const fileName = path.join(this.cacheDir + '/' + this.folderID.toString() + ".json");
        try {
            const data = await fs.readFile(fileName);
            const json = JSON.parse(data.toString('utf8'));
            if (json.version >= this.version) {
                this.items = [];
                for (const folder of json.childFolders) {
                    let f = this.findFolder(new UUID_1.UUID(folder.folderID.mUUID));
                    if (f !== null) {
                        continue;
                    }
                    f = new InventoryFolder(this.library, this.inventoryBase, this.agent);
                    f.parentID = this.folderID;
                    f.typeDefault = folder.typeDefault;
                    f.version = folder.version;
                    f.name = folder.name;
                    f.folderID = new UUID_1.UUID(folder.folderID.mUUID);
                    this.folders.push(f);
                }
                for (const item of json.childItems) {
                    const i = new InventoryItem_1.InventoryItem(this, this.agent);
                    i.created = new Date(item.created);
                    i.assetID = new UUID_1.UUID(item.assetID.mUUID);
                    i.parentID = this.folderID;
                    i.itemID = new UUID_1.UUID(item.itemID.mUUID);
                    i.permissions = {
                        lastOwner: new UUID_1.UUID(item.permissions.lastOwner.mUUID),
                        owner: new UUID_1.UUID(item.permissions.owner.mUUID),
                        creator: new UUID_1.UUID(item.permissions.creator.mUUID),
                        group: new UUID_1.UUID(item.permissions.group.mUUID),
                        baseMask: item.permissions.baseMask,
                        groupMask: item.permissions.groupMask,
                        nextOwnerMask: item.permissions.nextOwnerMask,
                        ownerMask: item.permissions.ownerMask,
                        everyoneMask: item.permissions.everyoneMask
                    };
                    i.inventoryType = item.inventoryType;
                    i.name = item.name;
                    i.metadata = item.metadata;
                    i.salePrice = item.salePrice;
                    i.saleType = item.saleType;
                    i.flags = item.flags;
                    i.description = item.description;
                    i.type = item.type;
                    await this.addItem(i, false);
                }
            }
            else {
                throw new Error('Old version');
            }
        }
        catch (_error) {
            throw new Error('Cache miss');
        }
    }
    async populateInternal() {
        const requestFolder = {
            folder_id: new LLSD.UUID(this.folderID),
            owner_id: new LLSD.UUID(this.agent.agentID),
            fetch_folders: true,
            fetch_items: true,
            sort_order: InventorySortOrder_1.InventorySortOrder.ByName
        };
        const requestedFolders = {
            'folders': [
                requestFolder
            ]
        };
        let cmd = 'FetchInventoryDescendents2';
        if (this.library === InventoryLibrary_1.InventoryLibrary.Library) {
            cmd = 'FetchLibDescendents2';
        }
        const folderContents = await this.agent.currentRegion.caps.capsPostXML(cmd, requestedFolders);
        for (const folder of folderContents.folders[0].categories) {
            let folderIDStr = folder.category_id;
            if (folderIDStr === undefined) {
                folderIDStr = folder.folder_id;
            }
            const folderID = new UUID_1.UUID(folderIDStr);
            let found = false;
            for (const fld of this.folders) {
                if (fld.folderID.equals(folderID)) {
                    found = true;
                    break;
                }
            }
            if (found) {
                continue;
            }
            const newFolder = new InventoryFolder(this.library, this.agent.inventory.main, this.agent);
            newFolder.typeDefault = parseInt(folder.type_default, 10);
            newFolder.version = parseInt(folder.version, 10);
            newFolder.name = String(folder.name);
            newFolder.folderID = folderID;
            newFolder.parentID = new UUID_1.UUID(folder.parent_id);
            this.folders.push(newFolder);
        }
        if (folderContents.folders?.[0]?.items) {
            this.version = folderContents.folders[0].version;
            this.items = [];
            for (const item of folderContents.folders[0].items) {
                const invItem = new InventoryItem_1.InventoryItem(this, this.agent);
                invItem.assetID = new UUID_1.UUID(item.asset_id.toString());
                invItem.inventoryType = item.inv_type;
                invItem.name = item.name;
                invItem.salePrice = item.sale_info.sale_price;
                invItem.saleType = item.sale_info.sale_type;
                invItem.created = new Date(item.created_at * 1000);
                invItem.parentID = new UUID_1.UUID(item.parent_id.toString());
                invItem.flags = item.flags;
                invItem.itemID = new UUID_1.UUID(item.item_id.toString());
                invItem.description = item.desc;
                invItem.type = item.type;
                if (item.permissions.last_owner_id === undefined) {
                    // TODO: OpenSim Glitch;
                    item.permissions.last_owner_id = item.permissions.owner_id;
                }
                invItem.permissions = {
                    baseMask: item.permissions.base_mask,
                    groupMask: item.permissions.group_mask,
                    nextOwnerMask: item.permissions.next_owner_mask,
                    ownerMask: item.permissions.owner_mask,
                    everyoneMask: item.permissions.everyone_mask,
                    lastOwner: new UUID_1.UUID(item.permissions.last_owner_id.toString()),
                    owner: new UUID_1.UUID(item.permissions.owner_id.toString()),
                    creator: new UUID_1.UUID(item.permissions.creator_id.toString()),
                    group: new UUID_1.UUID(item.permissions.group_id.toString())
                };
                await this.addItem(invItem, false);
            }
            await this.saveCache();
        }
    }
    async uploadInventoryAssetLegacy(assetType, inventoryType, data, name, description, flags) {
        const transactionID = UUID_1.UUID.random();
        const assetUploadMsg = new AssetUploadRequest_1.AssetUploadRequestMessage();
        assetUploadMsg.AssetBlock = {
            StoreLocal: false,
            Type: assetType,
            Tempfile: false,
            TransactionID: transactionID,
            AssetData: Buffer.allocUnsafe(0) // Initially empty; will be set later if data is small
        };
        const callbackID = ++this.callbackID;
        const createInventoryMsg = new CreateInventoryItem_1.CreateInventoryItemMessage();
        let wearableType = WearableType_1.WearableType.Shape;
        if (inventoryType === InventoryType_1.InventoryType.Wearable) {
            const wearable = new LLWearable_1.LLWearable(data.toString('utf-8'));
            wearableType = wearable.type;
        }
        else {
            const wearableInFlags = flags & InventoryItemFlags_1.InventoryItemFlags.FlagsSubtypeMask;
            if (wearableInFlags > 0) {
                wearableType = wearableInFlags;
            }
        }
        createInventoryMsg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.agent.currentRegion.circuit.sessionID
        };
        createInventoryMsg.InventoryBlock = {
            CallbackID: callbackID,
            FolderID: this.folderID,
            TransactionID: transactionID,
            NextOwnerMask: (1 << 13) | (1 << 14) | (1 << 15) | (1 << 19),
            Type: assetType,
            InvType: inventoryType,
            WearableType: wearableType,
            Name: Utils_1.Utils.StringToBuffer(name),
            Description: Utils_1.Utils.StringToBuffer(description)
        };
        try {
            const waitForResponse = this.agent.currentRegion.circuit.waitForMessage(Message_1.Message.UpdateCreateInventoryItem, 10000, (message) => {
                return message.InventoryData[0].CallbackID === callbackID
                    ? FilterResponse_1.FilterResponse.Finish
                    : FilterResponse_1.FilterResponse.NoMatch;
            });
            if (data.length + 100 < 1200) {
                assetUploadMsg.AssetBlock.AssetData = data;
                this.agent.currentRegion.circuit.sendMessage(assetUploadMsg, PacketFlags_1.PacketFlags.Reliable);
                this.agent.currentRegion.circuit.sendMessage(createInventoryMsg, PacketFlags_1.PacketFlags.Reliable);
            }
            else {
                this.agent.currentRegion.circuit.sendMessage(assetUploadMsg, PacketFlags_1.PacketFlags.Reliable);
                this.agent.currentRegion.circuit.sendMessage(createInventoryMsg, PacketFlags_1.PacketFlags.Reliable);
                const xferRequest = await this.agent.currentRegion.circuit.waitForMessage(Message_1.Message.RequestXfer, 10000);
                await this.agent.currentRegion.circuit.XferFileUp(xferRequest.XferID.ID, data);
            }
            const response = await waitForResponse;
            if (!response.InventoryData || response.InventoryData.length < 1) {
                throw new Error('Failed to create inventory item for wearable');
            }
            return response.InventoryData[0].ItemID;
        }
        catch (error) {
            throw new Error(`uploadInventoryAssetLegacy failed: ${String(error instanceof Error ? error.message : error)}`);
        }
    }
    async uploadInventoryItem(assetType, inventoryType, data, name, description, flags) {
        // Determine the wearable type based on flags
        let wearableType = WearableType_1.WearableType.Shape;
        const wearableInFlags = flags & InventoryItemFlags_1.InventoryItemFlags.FlagsSubtypeMask;
        if (wearableInFlags > 0) {
            wearableType = wearableInFlags;
        }
        // Generate transaction ID and callback ID
        const transactionID = UUID_1.UUID.zero();
        const callbackID = ++this.callbackID;
        // Create the CreateInventoryItemMessage
        const createInventoryMsg = new CreateInventoryItem_1.CreateInventoryItemMessage();
        createInventoryMsg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.agent.currentRegion.circuit.sessionID
        };
        createInventoryMsg.InventoryBlock = {
            CallbackID: callbackID,
            FolderID: this.folderID,
            TransactionID: transactionID,
            NextOwnerMask: (1 << 13) | (1 << 14) | (1 << 15) | (1 << 19),
            Type: assetType,
            InvType: inventoryType,
            WearableType: wearableType,
            Name: Utils_1.Utils.StringToBuffer(name),
            Description: Utils_1.Utils.StringToBuffer(description)
        };
        try {
            const createInventoryResponse = await this.agent.currentRegion.circuit.sendAndWaitForMessage(createInventoryMsg, PacketFlags_1.PacketFlags.Reliable, Message_1.Message.UpdateCreateInventoryItem, 10000, (message) => {
                return message.InventoryData[0].CallbackID === callbackID
                    ? FilterResponse_1.FilterResponse.Finish
                    : FilterResponse_1.FilterResponse.NoMatch;
            });
            if (!createInventoryResponse.InventoryData || createInventoryResponse.InventoryData.length < 1) {
                throw new Error('Failed to create inventory item');
            }
            const itemID = createInventoryResponse.InventoryData[0].ItemID;
            if (inventoryType === InventoryType_1.InventoryType.Notecard && data.length === 0) {
                // Empty notecard we can just leave as-is
                return itemID;
            }
            switch (inventoryType) {
                case InventoryType_1.InventoryType.Material:
                case InventoryType_1.InventoryType.Notecard:
                case InventoryType_1.InventoryType.Settings:
                case InventoryType_1.InventoryType.LSL:
                    {
                        await this.handleStandardInventoryUpload(inventoryType, itemID, data);
                        return itemID;
                    }
                case InventoryType_1.InventoryType.Gesture:
                    {
                        const isGestureCapAvailable = await this.agent.currentRegion.caps.isCapAvailable('UpdateGestureAgentInventory');
                        if (isGestureCapAvailable) {
                            await this.handleStandardInventoryUpload(inventoryType, itemID, data);
                            return itemID;
                        }
                        else {
                            // Fallback to legacy upload method if Gesture caps are not available
                            const invItemID = await this.uploadInventoryAssetLegacy(assetType, inventoryType, data, name, description, flags);
                            return invItemID;
                        }
                    }
                default:
                    throw new Error(`Currently unsupported CreateInventoryType: ${inventoryType}`);
            }
        }
        catch (error) {
            throw new Error(`uploadInventoryItem failed: ${String(error instanceof Error ? error.message : error)}`);
        }
    }
    /**
     * Handles the upload process for standard inventory types such as Notecard, Settings, Script, and LSL.
     * @param inventoryType The type of inventory item.
     * @param itemID The UUID of the created inventory item.
     * @param data The data buffer to upload.
     */
    async handleStandardInventoryUpload(inventoryType, itemID, data) {
        let xmlEndpoint = '';
        switch (inventoryType) {
            case InventoryType_1.InventoryType.Notecard:
                xmlEndpoint = 'UpdateNotecardAgentInventory';
                break;
            case InventoryType_1.InventoryType.Material:
                xmlEndpoint = 'UpdateMaterialAgentInventory';
                break;
            case InventoryType_1.InventoryType.Settings:
                xmlEndpoint = 'UpdateSettingsAgentInventory';
                break;
            case InventoryType_1.InventoryType.LSL:
                xmlEndpoint = 'UpdateScriptAgent';
                break;
            default:
                throw new Error(`Unsupported inventory type for standard upload: ${inventoryType}`);
        }
        try {
            const xmlPayload = {
                'item_id': new LLSD.UUID(itemID.toString()),
            };
            if (inventoryType === InventoryType_1.InventoryType.LSL) {
                xmlPayload.target = 'mono';
            }
            const result = await this.agent.currentRegion.caps.capsPostXML(xmlEndpoint, xmlPayload);
            if (!result.uploader) {
                throw new Error(`Invalid response when attempting to request upload URL for ${inventoryType}`);
            }
            const uploader = result.uploader;
            const uploadResult = await this.agent.currentRegion.caps.capsRequestUpload(uploader, data);
            if (uploadResult.state !== 'complete') {
                throw new Error('Asset upload failed');
            }
        }
        catch (error) {
            throw new Error(`Failed to upload inventory item (${inventoryType}): ${String(error instanceof Error ? error.message : error)}`);
        }
    }
}
exports.InventoryFolder = InventoryFolder;
//# sourceMappingURL=InventoryFolder.js.map