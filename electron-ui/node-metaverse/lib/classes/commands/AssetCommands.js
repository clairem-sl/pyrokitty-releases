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
exports.AssetCommands = void 0;
const CommandsBase_1 = require("./CommandsBase");
const UUID_1 = require("../UUID");
const LLSD = __importStar(require("@caspertech/llsd"));
const Utils_1 = require("../Utils");
const TransferRequest_1 = require("../messages/TransferRequest");
const TransferChannelType_1 = require("../../enums/TransferChannelType");
const TransferSourceTypes_1 = require("../../enums/TransferSourceTypes");
const Message_1 = require("../../enums/Message");
const AssetType_1 = require("../../enums/AssetType");
const PacketFlags_1 = require("../../enums/PacketFlags");
const TransferStatus_1 = require("../../enums/TransferStatus");
const Material_1 = require("../public/Material");
const FilterResponse_1 = require("../../enums/FilterResponse");
const Logger_1 = require("../Logger");
class AssetCommands extends CommandsBase_1.CommandsBase {
    async downloadAsset(type, uuid) {
        if (typeof uuid === 'string') {
            uuid = new UUID_1.UUID(uuid);
        }
        try {
            switch (type) {
                case AssetType_1.AssetType.Texture:
                case AssetType_1.AssetType.Sound:
                case AssetType_1.AssetType.Animation:
                case AssetType_1.AssetType.Gesture:
                case AssetType_1.AssetType.Landmark:
                case AssetType_1.AssetType.Clothing:
                case AssetType_1.AssetType.Material:
                case AssetType_1.AssetType.Bodypart:
                case AssetType_1.AssetType.Mesh:
                case AssetType_1.AssetType.Settings:
                    {
                        return await this.currentRegion.caps.downloadAsset(uuid, type);
                    }
                default:
                    {
                        const transferParams = Buffer.allocUnsafe(20);
                        uuid.writeToBuffer(transferParams, 0);
                        transferParams.writeInt32LE(type, 16);
                        return await this.transfer(TransferChannelType_1.TransferChannelType.Asset, TransferSourceTypes_1.TransferSourceType.Asset, false, transferParams);
                    }
            }
        }
        catch (e) {
            if (e instanceof Error) {
                throw new Error('Failed to download ' + type + ' asset ' + uuid.toString() + ' - ' + e.message);
            }
            else {
                throw new Error('Failed to download ' + type + ' asset ' + uuid.toString() + ' - ' + String(e));
            }
        }
    }
    async copyInventoryFromNotecard(notecardID, folder, itemID, objectID = UUID_1.UUID.zero()) {
        const gotCap = await this.currentRegion.caps.isCapAvailable('CopyInventoryFromNotecard');
        if (gotCap) {
            const callbackID = Math.floor(Math.random() * 2147483647);
            const request = {
                'callback-id': callbackID,
                'folder-id': new LLSD.UUID(folder.folderID.toString()),
                'item-id': new LLSD.UUID(itemID.toString()),
                'notecard-id': new LLSD.UUID(notecardID.toString()),
                'object-id': new LLSD.UUID(objectID.toString())
            };
            // Dispatch request, don't wait
            void this.currentRegion.caps.capsPostXML('CopyInventoryFromNotecard', request);
            const evt = await Utils_1.Utils.waitOrTimeOut(this.currentRegion.clientEvents.onBulkUpdateInventoryEvent, 10000, (event) => {
                for (const item of event.itemData) {
                    if (item.callbackID === callbackID) {
                        return FilterResponse_1.FilterResponse.Finish;
                    }
                }
                return FilterResponse_1.FilterResponse.NoMatch;
            });
            for (const item of evt.itemData) {
                if (item.callbackID === callbackID) {
                    return item;
                }
            }
            throw new Error('No match');
        }
        else {
            throw new Error('CopyInventoryFromNotecard cap not available');
        }
    }
    async downloadInventoryAsset(itemID, ownerID, type, priority, objectID = UUID_1.UUID.zero(), assetID = UUID_1.UUID.zero(), outAssetID, sourceType = TransferSourceTypes_1.TransferSourceType.SimInventoryItem, channelType = TransferChannelType_1.TransferChannelType.Asset) {
        const transferParams = Buffer.allocUnsafe(100);
        let pos = 0;
        this.agent.agentID.writeToBuffer(transferParams, pos);
        pos = pos + 16;
        this.circuit.sessionID.writeToBuffer(transferParams, pos);
        pos = pos + 16;
        ownerID.writeToBuffer(transferParams, pos);
        pos = pos + 16;
        objectID.writeToBuffer(transferParams, pos);
        pos = pos + 16;
        itemID.writeToBuffer(transferParams, pos);
        pos = pos + 16;
        assetID.writeToBuffer(transferParams, pos);
        pos = pos + 16;
        transferParams.writeInt32LE(type, pos);
        return this.transfer(channelType, sourceType, priority, transferParams, outAssetID);
    }
    async getMaterials(uuids) {
        let uuidArray = [];
        let submittedUUIDS = {};
        for (const uuid of Object.keys(uuids)) {
            if (uuidArray.length > 49) {
                let attempts = 5;
                let err = null;
                while (uuidArray.length > 0 && attempts-- > 0) {
                    if (attempts < 4) {
                        await Utils_1.Utils.sleep(1000);
                    }
                    try {
                        await this.getMaterialsLimited(uuidArray, submittedUUIDS);
                        for (const uu of Object.keys(submittedUUIDS)) {
                            if (submittedUUIDS[uu] !== null) {
                                uuids[uu] = submittedUUIDS[uu];
                            }
                        }
                        uuidArray = [];
                        submittedUUIDS = {};
                    }
                    catch (error) {
                        err = error;
                    }
                }
                if (uuidArray.length > 0) {
                    Logger_1.Logger.Error('Error fetching materials:');
                    Logger_1.Logger.Error(err);
                }
            }
            if (!submittedUUIDS[uuid]) {
                submittedUUIDS[uuid] = uuids[uuid];
                uuidArray.push(new LLSD.Binary(Array.from(new UUID_1.UUID(uuid).getBuffer())));
            }
        }
        try {
            let attempts = 5;
            let err = null;
            while (uuidArray.length > 0 && attempts-- > 0) {
                if (attempts < 4) {
                    await Utils_1.Utils.sleep(1000);
                }
                try {
                    await this.getMaterialsLimited(uuidArray, submittedUUIDS);
                    for (const uu of Object.keys(submittedUUIDS)) {
                        if (submittedUUIDS[uu] !== null) {
                            uuids[uu] = submittedUUIDS[uu];
                        }
                    }
                    uuidArray = [];
                    submittedUUIDS = {};
                }
                catch (error) {
                    err = error;
                }
            }
            if (uuidArray.length > 0) {
                Logger_1.Logger.Error('Error fetching materials:');
                Logger_1.Logger.Error(err);
            }
        }
        catch (error) {
            console.error(error);
        }
    }
    async transfer(channelType, sourceType, priority, transferParams, outAssetID) {
        return new Promise((resolve, reject) => {
            const transferID = UUID_1.UUID.random();
            const msg = new TransferRequest_1.TransferRequestMessage();
            msg.TransferInfo = {
                TransferID: transferID,
                ChannelType: channelType,
                SourceType: sourceType,
                Priority: 100.0 + (priority ? 1.0 : 0.0),
                Params: transferParams
            };
            let gotInfo = true;
            let expectedSize = 0;
            const packets = {};
            let subscription = undefined;
            let timeout = undefined;
            function cleanup() {
                if (subscription !== undefined) {
                    subscription.unsubscribe();
                    subscription = undefined;
                }
                if (timeout !== undefined) {
                    clearTimeout(timeout);
                    timeout = undefined;
                }
            }
            function placeTimeout() {
                timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Timeout'));
                }, 10000);
            }
            function resetTimeout() {
                if (timeout !== undefined) {
                    clearTimeout(timeout);
                }
                placeTimeout();
            }
            subscription = this.circuit.subscribeToMessages([
                Message_1.Message.TransferInfo,
                Message_1.Message.TransferAbort,
                Message_1.Message.TransferPacket
            ], (packet) => {
                try {
                    switch (packet.message.id) {
                        case Message_1.Message.TransferPacket:
                            {
                                const messg = packet.message;
                                if (!messg.TransferData.TransferID.equals(transferID)) {
                                    return;
                                }
                                resetTimeout();
                                packets[messg.TransferData.Packet] = messg.TransferData.Data;
                                switch (messg.TransferData.Status) {
                                    case TransferStatus_1.TransferStatus.Abort:
                                        cleanup();
                                        reject(new Error('Transfer Aborted'));
                                        break;
                                    case TransferStatus_1.TransferStatus.Error:
                                        cleanup();
                                        reject(new Error('Error'));
                                        break;
                                    case TransferStatus_1.TransferStatus.Skip:
                                        console.error('TransferPacket: Skip! not sure what this means');
                                        break;
                                    case TransferStatus_1.TransferStatus.InsufficientPermissions:
                                        cleanup();
                                        reject(new Error('Insufficient Permissions'));
                                        break;
                                    case TransferStatus_1.TransferStatus.NotFound:
                                        cleanup();
                                        reject(new Error('Not Found'));
                                        break;
                                    case TransferStatus_1.TransferStatus.OK:
                                    case TransferStatus_1.TransferStatus.Done:
                                        break;
                                }
                                break;
                            }
                        case Message_1.Message.TransferInfo:
                            {
                                const messg = packet.message;
                                if (!messg.TransferInfo.TransferID.equals(transferID)) {
                                    return;
                                }
                                resetTimeout();
                                const status = messg.TransferInfo.Status;
                                switch (status) {
                                    case TransferStatus_1.TransferStatus.OK:
                                        expectedSize = messg.TransferInfo.Size;
                                        gotInfo = true;
                                        if (outAssetID !== undefined) {
                                            outAssetID.assetID = new UUID_1.UUID(messg.TransferInfo.Params, 80);
                                        }
                                        break;
                                    case TransferStatus_1.TransferStatus.Abort:
                                        cleanup();
                                        reject(new Error('Transfer Aborted'));
                                        break;
                                    case TransferStatus_1.TransferStatus.Error:
                                        cleanup();
                                        reject(new Error('Error downloading asset'));
                                        // See if we get anything else
                                        break;
                                    case TransferStatus_1.TransferStatus.Skip:
                                        console.error('TransferInfo: Skip! not sure what this means');
                                        break;
                                    case TransferStatus_1.TransferStatus.InsufficientPermissions:
                                        cleanup();
                                        reject(new Error('Insufficient Permissions'));
                                        break;
                                    case TransferStatus_1.TransferStatus.NotFound:
                                        cleanup();
                                        reject(new Error('Not Found'));
                                        break;
                                    case TransferStatus_1.TransferStatus.Done:
                                        break;
                                }
                                break;
                            }
                        case Message_1.Message.TransferAbort:
                            {
                                const messg = packet.message;
                                if (!messg.TransferInfo.TransferID.equals(transferID)) {
                                    return;
                                }
                                resetTimeout();
                                cleanup();
                                reject(new Error('Transfer Aborted'));
                                return;
                            }
                        default:
                            break;
                    }
                    if (gotInfo) {
                        let gotSize = 0;
                        for (const packetNum of Object.keys(packets)) {
                            const pn = parseInt(packetNum, 10);
                            gotSize += packets[pn].length;
                        }
                        if (gotSize >= expectedSize) {
                            const packetNumbers = Object.keys(packets).sort((a, b) => {
                                return parseInt(a, 10) - parseInt(b, 10);
                            });
                            const buffers = [];
                            for (const pn of packetNumbers) {
                                buffers.push(packets[parseInt(pn, 10)]);
                            }
                            cleanup();
                            resolve(Buffer.concat(buffers));
                        }
                    }
                }
                catch (error) {
                    cleanup();
                    if (error instanceof Error) {
                        reject(error);
                    }
                    throw new Error('Unknown error: ' + String(error));
                }
            });
            placeTimeout();
            this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        });
    }
    async getMaterialsLimited(uuidArray, uuids) {
        const binary = LLSD.LLSD.formatBinary(uuidArray);
        const res = await Utils_1.Utils.deflate(Buffer.from(binary.toArray()));
        const result = await this.currentRegion.caps.capsPostXML('RenderMaterials', {
            'Zipped': LLSD.LLSD.asBinary(res.toString('base64'))
        });
        const resultZipped = Buffer.from(result.Zipped.octets);
        const reslt = await Utils_1.Utils.inflate(resultZipped);
        const binData = new LLSD.Binary(Array.from(reslt), 'BASE64');
        const llsdResult = LLSD.LLSD.parseBinary(binData);
        let obj = [];
        if (llsdResult.result !== undefined) {
            obj = llsdResult.result;
        }
        if (obj.length > 0) {
            for (const mat of obj) {
                if (mat.ID !== undefined) {
                    const nbuf = Buffer.from(mat.ID.toArray());
                    const nuuid = new UUID_1.UUID(nbuf, 0).toString();
                    if (uuids[nuuid] !== undefined) {
                        if (mat.Material !== undefined) {
                            uuids[nuuid] = Material_1.Material.fromLLSDObject(mat.Material);
                        }
                    }
                }
            }
        }
        else {
            throw new Error('Material data not found');
        }
    }
}
exports.AssetCommands = AssetCommands;
//# sourceMappingURL=AssetCommands.js.map