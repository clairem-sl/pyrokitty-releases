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
exports.Inventory = void 0;
const UUID_1 = require("./UUID");
const InventoryFolder_1 = require("./InventoryFolder");
const LLSD = __importStar(require("@caspertech/llsd"));
const InventoryItem_1 = require("./InventoryItem");
const InventoryLibrary_1 = require("../enums/InventoryLibrary");
class Inventory {
    main = {
        skeleton: new Map()
    };
    library = {
        skeleton: new Map()
    };
    itemsByID = new Map();
    agent;
    constructor(agent) {
        this.agent = agent;
    }
    getRootFolderLibrary() {
        if (this.library.root === undefined) {
            return new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Library, this.library, this.agent);
        }
        const uuidStr = this.library.root.toString();
        const skel = this.library.skeleton.get(uuidStr);
        if (skel) {
            return skel;
        }
        else {
            return new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Library, this.library, this.agent);
        }
    }
    getRootFolderMain() {
        if (this.main.root === undefined) {
            return new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Main, this.main, this.agent);
        }
        const uuidStr = this.main.root.toString();
        const skel = this.main.skeleton.get(uuidStr);
        if (skel) {
            return skel;
        }
        else {
            return new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Main, this.main, this.agent);
        }
    }
    findFolderForType(type) {
        const root = this.main.skeleton;
        for (const f of root.values()) {
            if (f !== undefined && f.typeDefault === type) {
                return f.folderID;
            }
        }
        return this.getRootFolderMain().folderID;
    }
    findFolder(folderID) {
        const fol = this.main.skeleton.get(folderID.toString());
        if (fol !== undefined) {
            return fol;
        }
        for (const folder of this.main.skeleton.values()) {
            const result = folder.findFolder(folderID);
            if (result !== null) {
                return result;
            }
        }
        return null;
    }
    async fetchInventoryItem(item) {
        const params = {
            'agent_id': new LLSD.UUID(this.agent.agentID),
            'items': [
                {
                    'item_id': new LLSD.UUID(item),
                    'owner_id': new LLSD.UUID(this.agent.agentID)
                }
            ]
        };
        const response = await this.agent.currentRegion.caps.capsPostXML('FetchInventory2', params);
        if (response.items.length > 0) {
            const receivedItem = response.items[0];
            let folder = this.findFolder(new UUID_1.UUID(receivedItem.parent_id.toString()));
            if (folder === null) {
                folder = this.getRootFolderMain();
            }
            const invItem = new InventoryItem_1.InventoryItem(folder, this.agent);
            invItem.assetID = new UUID_1.UUID(receivedItem.asset_id.toString());
            invItem.inventoryType = parseInt(receivedItem.inv_type, 10);
            invItem.type = parseInt(receivedItem.type, 10);
            invItem.itemID = item;
            if (receivedItem.permissions.last_owner_id === undefined) {
                // TODO: OpenSim glitch
                receivedItem.permissions.last_owner_id = receivedItem.permissions.owner_id;
            }
            invItem.permissions = {
                baseMask: parseInt(receivedItem.permissions.base_mask, 10),
                nextOwnerMask: parseInt(receivedItem.permissions.next_owner_mask, 10),
                groupMask: parseInt(receivedItem.permissions.group_mask, 10),
                lastOwner: new UUID_1.UUID(receivedItem.permissions.last_owner_id.toString()),
                owner: new UUID_1.UUID(receivedItem.permissions.owner_id.toString()),
                creator: new UUID_1.UUID(receivedItem.permissions.creator_id.toString()),
                group: new UUID_1.UUID(receivedItem.permissions.group_id.toString()),
                ownerMask: parseInt(receivedItem.permissions.owner_mask, 10),
                everyoneMask: parseInt(receivedItem.permissions.everyone_mask, 10),
            };
            invItem.flags = parseInt(receivedItem.flags, 10);
            invItem.description = receivedItem.desc;
            invItem.name = receivedItem.name;
            invItem.created = new Date(receivedItem.created_at * 1000);
            invItem.parentID = new UUID_1.UUID(receivedItem.parent_id.toString());
            invItem.saleType = parseInt(receivedItem.sale_info.sale_type, 10);
            invItem.salePrice = parseInt(receivedItem.sale_info.sale_price, 10);
            const skel = this.main.skeleton.get(invItem.parentID.toString());
            if (skel !== undefined) {
                await skel.addItem(invItem);
            }
            return invItem;
        }
        else {
            return null;
        }
    }
}
exports.Inventory = Inventory;
//# sourceMappingURL=Inventory.js.map