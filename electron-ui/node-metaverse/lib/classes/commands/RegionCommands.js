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
exports.RegionCommands = void 0;
const LLSD = __importStar(require("@caspertech/llsd"));
const micromatch = __importStar(require("micromatch"));
const SculptType_1 = require("../../enums/SculptType");
const FilterResponse_1 = require("../../enums/FilterResponse");
const InventoryType_1 = require("../../enums/InventoryType");
const Message_1 = require("../../enums/Message");
const PacketFlags_1 = require("../../enums/PacketFlags");
const PCode_1 = require("../../enums/PCode");
const PrimFlags_1 = require("../../enums/PrimFlags");
const BuildMap_1 = require("../BuildMap");
const EstateOwnerMessage_1 = require("../messages/EstateOwnerMessage");
const ObjectAdd_1 = require("../messages/ObjectAdd");
const ObjectDeGrab_1 = require("../messages/ObjectDeGrab");
const ObjectDeselect_1 = require("../messages/ObjectDeselect");
const ObjectGrab_1 = require("../messages/ObjectGrab");
const ObjectGrabUpdate_1 = require("../messages/ObjectGrabUpdate");
const ObjectSelect_1 = require("../messages/ObjectSelect");
const RegionHandleRequest_1 = require("../messages/RegionHandleRequest");
const GameObject_1 = require("../public/GameObject");
const Quaternion_1 = require("../Quaternion");
const Utils_1 = require("../Utils");
const UUID_1 = require("../UUID");
const Vector3_1 = require("../Vector3");
const CommandsBase_1 = require("./CommandsBase");
const PrimFacesHelper_1 = require("../PrimFacesHelper");
const Logger_1 = require("../Logger");
const AssetType_1 = require("../../enums/AssetType");
class RegionCommands extends CommandsBase_1.CommandsBase {
    // noinspection JSUnusedGlobalSymbols
    async getRegionHandle(regionID) {
        const { circuit } = this.currentRegion;
        const msg = new RegionHandleRequest_1.RegionHandleRequestMessage();
        msg.RequestBlock = {
            RegionID: regionID,
        };
        circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const responseMsg = await circuit.waitForMessage(Message_1.Message.RegionIDAndHandleReply, 10000, (filterMsg) => {
            if (filterMsg.ReplyBlock.RegionID.toString() === regionID.toString()) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            else {
                return FilterResponse_1.FilterResponse.NoMatch;
            }
        });
        return responseMsg.ReplyBlock.RegionHandle;
    }
    // noinspection JSUnusedGlobalSymbols
    async waitForHandshake(timeout = 10000) {
        return new Promise((resolve, reject) => {
            if (this.currentRegion.handshakeComplete) {
                resolve();
            }
            else {
                let handshakeSubscription = undefined;
                let timeoutTimer = undefined;
                handshakeSubscription = this.currentRegion.handshakeCompleteEvent.subscribe(() => {
                    if (timeoutTimer !== undefined) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = undefined;
                    }
                    if (handshakeSubscription !== undefined) {
                        handshakeSubscription.unsubscribe();
                        handshakeSubscription = undefined;
                        resolve();
                    }
                });
                timeoutTimer = setTimeout(() => {
                    if (handshakeSubscription !== undefined) {
                        handshakeSubscription.unsubscribe();
                        handshakeSubscription = undefined;
                    }
                    if (timeoutTimer !== undefined) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = undefined;
                        reject(new Error('Timeout'));
                    }
                }, timeout);
                if (this.currentRegion.handshakeComplete) {
                    if (handshakeSubscription !== undefined) {
                        handshakeSubscription.unsubscribe();
                        handshakeSubscription = undefined;
                    }
                    if (timeoutTimer !== undefined) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = undefined;
                    }
                    resolve();
                }
            }
        });
    }
    async estateMessage(method, params) {
        const msg = new EstateOwnerMessage_1.EstateOwnerMessageMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID,
            TransactionID: UUID_1.UUID.zero()
        };
        msg.MethodData = {
            Invoice: UUID_1.UUID.random(),
            Method: Utils_1.Utils.StringToBuffer(method),
        };
        msg.ParamList = [];
        for (const param of params) {
            msg.ParamList.push({
                Parameter: Utils_1.Utils.StringToBuffer(param)
            });
        }
        const sequenceID = this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return this.circuit.waitForAck(sequenceID, 10000);
    }
    async restartRegion(secs) {
        return this.estateMessage('restart', [String(secs)]);
    }
    async simulatorMessage(message) {
        return this.estateMessage('simulatormessage', [
            '-1',
            '-1',
            this.agent.agentID.toString(),
            this.agent.firstName + ' ' + this.agent.lastName,
            message
        ]);
    }
    async cancelRestart() {
        return this.restartRegion(-1);
    }
    getAvatarsInRegion() {
        return Array.from(this.currentRegion.agents.values());
    }
    async deselectObjects(objects) {
        // Limit to 255 objects at once
        const selectLimit = 255;
        if (objects.length > selectLimit) {
            for (let x = 0; x < objects.length; x += selectLimit) {
                const selectList = [];
                for (let y = 0; y < selectLimit; y++) {
                    if (x + y < objects.length) {
                        selectList.push(objects[x + y]);
                    }
                }
                await this.deselectObjects(selectList);
            }
            return;
        }
        else {
            const deselectObject = new ObjectDeselect_1.ObjectDeselectMessage();
            deselectObject.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.circuit.sessionID
            };
            deselectObject.ObjectData = [];
            const uuidMap = new Set();
            let skipped = 0;
            for (const obj of objects) {
                if (!(obj instanceof GameObject_1.GameObject)) {
                    skipped++;
                    continue;
                }
                const uuidStr = obj.FullID.toString();
                if (!uuidMap.has(uuidStr)) {
                    uuidMap.add(uuidStr);
                    deselectObject.ObjectData.push({
                        ObjectLocalID: obj.ID
                    });
                }
            }
            if (skipped > 0) {
                console.log('Skipped ' + String(skipped) + ' bad objects during deselection');
            }
            const sequenceID = this.circuit.sendMessage(deselectObject, PacketFlags_1.PacketFlags.Reliable);
            return this.circuit.waitForAck(sequenceID, 10000);
        }
    }
    // noinspection JSUnusedGlobalSymbols
    countObjects() {
        return this.currentRegion.objects.getNumberOfObjects();
    }
    // noinspection JSUnusedGlobalSymbols
    getTerrainTextures() {
        const textures = [];
        textures.push(this.currentRegion.terrainDetail0);
        textures.push(this.currentRegion.terrainDetail1);
        textures.push(this.currentRegion.terrainDetail2);
        textures.push(this.currentRegion.terrainDetail3);
        return textures;
    }
    // noinspection JSUnusedGlobalSymbols
    exportSettings() {
        return this.currentRegion.exportXML();
    }
    // noinspection JSUnusedGlobalSymbols
    async getTerrain() {
        await this.currentRegion.waitForTerrain();
        const buf = Buffer.allocUnsafe(262144);
        let pos = 0;
        for (let x = 0; x < 256; x++) {
            for (let y = 0; y < 256; y++) {
                buf.writeFloatLE(this.currentRegion.terrain[x][y], pos);
                pos = pos + 4;
            }
        }
        return buf;
    }
    async selectObjects(objects) {
        // Limit to 255 objects at once
        const selectLimit = 255;
        if (objects.length > selectLimit) {
            for (let x = 0; x < objects.length; x += selectLimit) {
                const selectList = [];
                for (let y = 0; y < selectLimit; y++) {
                    if (x + y < objects.length) {
                        selectList.push(objects[x + y]);
                    }
                }
                await this.selectObjects(selectList);
            }
            return;
        }
        else {
            const selectObject = new ObjectSelect_1.ObjectSelectMessage();
            selectObject.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.circuit.sessionID
            };
            selectObject.ObjectData = [];
            const uuidMap = new Map();
            let skipped = 0;
            for (const obj of objects) {
                if (!(obj instanceof GameObject_1.GameObject)) {
                    skipped++;
                    continue;
                }
                const uuidStr = obj.FullID.toString();
                if (!uuidMap.has(uuidStr)) {
                    uuidMap.set(uuidStr, obj);
                    selectObject.ObjectData.push({
                        ObjectLocalID: obj.ID
                    });
                }
            }
            if (skipped > 0) {
                console.log('Skipped ' + String(skipped) + ' bad objects during deselection');
            }
            // Create a map of our expected UUIDs
            this.circuit.sendMessage(selectObject, PacketFlags_1.PacketFlags.Reliable);
            try {
                await this.circuit.waitForMessage(Message_1.Message.ObjectProperties, 10000, (propertiesMessage) => {
                    let found = false;
                    for (const objData of propertiesMessage.ObjectData) {
                        const objDataUUID = objData.ObjectID.toString();
                        const obj = uuidMap.get(objDataUUID);
                        if (obj !== undefined) {
                            obj.creatorID = objData.CreatorID;
                            obj.creationDate = objData.CreationDate;
                            obj.baseMask = objData.BaseMask;
                            obj.ownerMask = objData.OwnerMask;
                            obj.groupMask = objData.GroupMask;
                            obj.everyoneMask = objData.EveryoneMask;
                            obj.nextOwnerMask = objData.NextOwnerMask;
                            obj.ownershipCost = objData.OwnershipCost;
                            obj.saleType = objData.SaleType;
                            obj.salePrice = objData.SalePrice;
                            obj.aggregatePerms = objData.AggregatePerms;
                            obj.aggregatePermTextures = objData.AggregatePermTextures;
                            obj.aggregatePermTexturesOwner = objData.AggregatePermTexturesOwner;
                            obj.category = objData.Category;
                            obj.inventorySerial = objData.InventorySerial;
                            obj.itemID = objData.ItemID;
                            obj.folderID = objData.FolderID;
                            obj.fromTaskID = objData.FromTaskID;
                            obj.groupID = objData.GroupID;
                            obj.OwnerID = objData.OwnerID;
                            obj.lastOwnerID = objData.LastOwnerID;
                            obj.name = Utils_1.Utils.BufferToStringSimple(objData.Name);
                            obj.description = Utils_1.Utils.BufferToStringSimple(objData.Description);
                            obj.touchName = Utils_1.Utils.BufferToStringSimple(objData.TouchName);
                            obj.sitName = Utils_1.Utils.BufferToStringSimple(objData.SitName);
                            obj.textureID = Utils_1.Utils.BufferToStringSimple(objData.TextureID);
                            obj.resolvedAt = new Date().getTime() / 1000;
                            uuidMap.delete(objDataUUID);
                            found = true;
                        }
                    }
                    if (Object.keys(uuidMap).length === 0) {
                        return FilterResponse_1.FilterResponse.Finish;
                    }
                    if (!found) {
                        return FilterResponse_1.FilterResponse.NoMatch;
                    }
                    else {
                        return FilterResponse_1.FilterResponse.Match;
                    }
                });
            }
            catch (_error) {
                // Ignore any errors
            }
        }
    }
    // noinspection JSUnusedGlobalSymbols
    getName() {
        return this.currentRegion.regionName;
    }
    async resolveObject(object, options) {
        return this.currentRegion.resolver.resolveObjects([object], options);
    }
    // noinspection JSUnusedGlobalSymbols
    async resolveObjects(objects, options) {
        return this.currentRegion.resolver.resolveObjects(objects, options);
    }
    // noinspection JSUnusedGlobalSymbols
    async fetchObjectInventory(object) {
        return this.currentRegion.resolver.getInventory(object);
    }
    // noinspection JSUnusedGlobalSymbols
    async fetchObjectInventories(objects) {
        return this.currentRegion.resolver.getInventories(objects);
    }
    // noinspection JSUnusedGlobalSymbols
    async fetchObjectCost(object) {
        return this.currentRegion.resolver.getCosts([object]);
    }
    // noinspection JSUnusedGlobalSymbols
    async fetchObjectCosts(objects) {
        return this.currentRegion.resolver.getCosts(objects);
    }
    // noinspection JSUnusedGlobalSymbols
    async buildObjectNew(obj, map, callback, costOnly = false, skipMove = false) {
        const buildMap = new BuildMap_1.BuildMap(map, callback, costOnly);
        this.gatherAssets(obj, buildMap);
        const bomTextures = [
            '5a9f4a74-30f2-821c-b88d-70499d3e7183',
            'ae2de45c-d252-50b8-5c6e-19f39ce79317',
            '24daea5f-0539-cfcf-047f-fbc40b2786ba',
            '52cc6bb6-2ee5-e632-d3ad-50197b1dcb8a',
            '43529ce8-7faa-ad92-165a-bc4078371687',
            '09aac1fb-6bce-0bee-7d44-caac6dbb6c63',
            'ff62763f-d60a-9855-890b-0c96f8f8cd98',
            '8e915e25-31d1-cc95-ae08-d58a47488251',
            '9742065b-19b5-297c-858a-29711d539043',
            '03642e83-2bd1-4eb9-34b4-4c47ed586d2d',
            'edd51b77-fc10-ce7a-4b3d-011dfc349e4f',
            'c228d1cf-4b5d-4ba8-84f4-899a0796aa97' // 'non existent asset'
        ];
        for (const bomTexture of bomTextures) {
            buildMap.assetMap.textures.delete(bomTexture);
        }
        await callback(map);
        if (costOnly) {
            return null;
        }
        let agentPos = new Vector3_1.Vector3([128, 128, 2048]);
        try {
            const agentLocalID = this.currentRegion.agent.localID;
            const agentObject = this.currentRegion.objects.getObjectByLocalID(agentLocalID);
            if (agentObject.Position !== undefined) {
                agentPos = new Vector3_1.Vector3(agentObject.Position);
            }
            else {
                throw new Error('Agent position is undefined');
            }
        }
        catch (_error) {
            console.warn('Unable to find avatar location, rezzing at ' + agentPos.toString());
        }
        agentPos.z += 2.0;
        buildMap.rezLocation = agentPos;
        // Set camera above target location for fast acquisition
        const campos = new Vector3_1.Vector3(agentPos);
        campos.z += 2.0;
        this.currentRegion.clientCommands.agent.setCamera(campos, agentPos, 10, new Vector3_1.Vector3([-1.0, 0, 0]), new Vector3_1.Vector3([0.0, 1.0, 0]));
        if (buildMap.primsNeeded > 0) {
            buildMap.primReservoir = await this.createPrims(buildMap.primsNeeded, agentPos);
        }
        let storedPosition = undefined;
        if (skipMove) {
            storedPosition = obj.Position;
            obj.Position = new Vector3_1.Vector3(buildMap.rezLocation);
        }
        const parts = [];
        parts.push(async () => {
            return {
                index: 1,
                object: await this.buildPart(obj, Vector3_1.Vector3.getZero(), Quaternion_1.Quaternion.getIdentity(), buildMap, true)
            };
        });
        if (obj.children) {
            if (obj.Position === undefined) {
                obj.Position = Vector3_1.Vector3.getZero();
            }
            if (obj.Rotation === undefined) {
                obj.Rotation = Quaternion_1.Quaternion.getIdentity();
            }
            let childIndex = 2;
            for (const child of obj.children) {
                if (child.Position !== undefined && child.Rotation !== undefined) {
                    const index = childIndex++;
                    parts.push(async () => {
                        return {
                            index,
                            object: await this.buildPart(child, new Vector3_1.Vector3(obj.Position), new Quaternion_1.Quaternion(obj.Rotation), buildMap, false)
                        };
                    });
                }
            }
        }
        let results = {
            results: [],
            errors: []
        };
        results = await Utils_1.Utils.promiseConcurrent(parts, 5, 0);
        if (results.errors.length > 0) {
            for (const err of results.errors) {
                console.error(err);
            }
        }
        let rootObj = null;
        for (const childObject of results.results) {
            if (childObject.object.isMarkedRoot) {
                rootObj = childObject.object;
                break;
            }
        }
        if (rootObj === null) {
            throw new Error('Failed to find root prim..');
        }
        const childPrims = [];
        results.results.sort((a, b) => {
            return a.index - b.index;
        });
        for (const childObject of results.results) {
            if (childObject.object !== rootObj) {
                childPrims.push(childObject.object);
            }
        }
        try {
            await rootObj.linkFrom(childPrims);
        }
        catch (err) {
            console.error('Link failed:');
            console.error(err);
        }
        if (storedPosition !== undefined) {
            obj.Position = storedPosition;
        }
        return rootObj;
    }
    // noinspection JSUnusedGlobalSymbols
    async getObjectByLocalID(id, resolve, waitFor = 0) {
        let obj = null;
        try {
            obj = this.currentRegion.objects.getObjectByLocalID(id);
        }
        catch (error) {
            if (waitFor > 0) {
                obj = await this.waitForObjectByLocalID(id, waitFor);
            }
            else {
                throw (error);
            }
        }
        if (resolve) {
            await this.currentRegion.resolver.resolveObjects([obj], {});
        }
        return obj;
    }
    // noinspection JSUnusedGlobalSymbols
    async getObjectByUUID(id, resolve, waitFor = 0) {
        let obj = null;
        try {
            obj = this.currentRegion.objects.getObjectByUUID(id);
        }
        catch (error) {
            if (waitFor > 0) {
                obj = await this.waitForObjectByUUID(id, waitFor);
            }
            else {
                throw (error);
            }
        }
        if (resolve) {
            await this.currentRegion.resolver.resolveObjects([obj], {});
        }
        return obj;
    }
    // noinspection JSUnusedGlobalSymbols
    async findObjectsByName(pattern, minX, maxX, minY, maxY, minZ, maxZ) {
        let objects = [];
        if (minX !== undefined && maxX !== undefined && minY !== undefined && maxY !== undefined && minZ !== undefined && maxZ !== undefined) {
            objects = await this.getObjectsInArea(minX, maxX, minY, maxY, minZ, maxZ, true);
        }
        else {
            objects = await this.getAllObjects({ resolve: true });
        }
        const idCheck = {};
        const matches = [];
        const it = function (go) {
            if (go.name !== undefined) {
                let match = false;
                if (pattern instanceof RegExp) {
                    if (pattern.test(go.name)) {
                        match = true;
                    }
                }
                else {
                    match = micromatch.isMatch(go.name, pattern, { nocase: true });
                }
                if (match) {
                    const fullID = go.FullID.toString();
                    if (!idCheck[fullID]) {
                        matches.push(go);
                        idCheck[fullID] = true;
                    }
                }
            }
            if (go.children && go.children.length > 0) {
                for (const child of go.children) {
                    it(child);
                }
            }
        };
        for (const go of objects) {
            it(go);
        }
        return matches;
    }
    async getParcelAt(x, y) {
        return this.currentRegion.getParcelProperties(x, y);
    }
    async getParcels() {
        return this.currentRegion.getParcels();
    }
    async getAllObjects(options) {
        const objs = this.currentRegion.objects.getAllObjects(options);
        if (options.resolve === true) {
            await this.currentRegion.resolver.resolveObjects(objs, options);
        }
        return objs;
    }
    async getObjectsInArea(minX, maxX, minY, maxY, minZ, maxZ, resolve = false) {
        const objs = this.currentRegion.objects.getObjectsInArea(minX, maxX, minY, maxY, minZ, maxZ);
        if (resolve) {
            await this.currentRegion.resolver.resolveObjects(objs, {});
        }
        return objs;
    }
    // noinspection JSUnusedGlobalSymbols
    async pruneObjects(checkList) {
        let uuids = [];
        let objects = [];
        const stillAlive = {};
        const checkObjects = async (uuidList, objectList) => {
            const objRef = {};
            for (const obj of objectList) {
                objRef[obj.FullID.toString()] = obj;
            }
            const result = await this.currentRegion.caps.capsPostXML('GetObjectCost', {
                'object_ids': uuidList
            });
            for (const u of Object.keys(result)) {
                stillAlive[u] = objRef[u];
            }
        };
        for (const o of checkList) {
            if (o.FullID !== undefined) {
                uuids.push(new LLSD.UUID(o.FullID));
                objects.push(o);
                if (uuids.length > 256) {
                    await checkObjects(uuids, objects);
                    uuids = [];
                    objects = [];
                }
            }
        }
        if (uuids.length > 0) {
            await checkObjects(uuids, objects);
        }
        const deadObjects = [];
        for (const o of checkList) {
            let found = false;
            if (o.FullID !== undefined) {
                const fullID = o.FullID.toString();
                if (stillAlive[fullID] !== undefined) {
                    found = true;
                }
            }
            if (!found) {
                deadObjects.push(o);
            }
        }
        return deadObjects;
    }
    // noinspection JSUnusedGlobalSymbols
    setPersist(persist) {
        this.currentRegion.objects.setPersist(persist);
    }
    async grabObject(localID, grabOffset = Vector3_1.Vector3.getZero(), uvCoordinate = Vector3_1.Vector3.getZero(), stCoordinate = Vector3_1.Vector3.getZero(), faceIndex = 0, position = Vector3_1.Vector3.getZero(), normal = Vector3_1.Vector3.getZero(), binormal = Vector3_1.Vector3.getZero()) {
        if (localID instanceof UUID_1.UUID) {
            const obj = this.currentRegion.objects.getObjectByUUID(localID);
            localID = obj.ID;
        }
        const msg = new ObjectGrab_1.ObjectGrabMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.ObjectData = {
            LocalID: localID,
            GrabOffset: grabOffset
        };
        msg.SurfaceInfo = [
            {
                UVCoord: uvCoordinate,
                STCoord: stCoordinate,
                FaceIndex: faceIndex,
                Position: position,
                Normal: normal,
                Binormal: binormal
            }
        ];
        const seqID = this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return this.circuit.waitForAck(seqID, 10000);
    }
    async deGrabObject(localID, _grabOffset = Vector3_1.Vector3.getZero(), uvCoordinate = Vector3_1.Vector3.getZero(), stCoordinate = Vector3_1.Vector3.getZero(), faceIndex = 0, position = Vector3_1.Vector3.getZero(), normal = Vector3_1.Vector3.getZero(), binormal = Vector3_1.Vector3.getZero()) {
        if (localID instanceof UUID_1.UUID) {
            const obj = this.currentRegion.objects.getObjectByUUID(localID);
            localID = obj.ID;
        }
        const msg = new ObjectDeGrab_1.ObjectDeGrabMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.ObjectData = {
            LocalID: localID
        };
        msg.SurfaceInfo = [
            {
                UVCoord: uvCoordinate,
                STCoord: stCoordinate,
                FaceIndex: faceIndex,
                Position: position,
                Normal: normal,
                Binormal: binormal
            }
        ];
        const seqID = this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return this.circuit.waitForAck(seqID, 10000);
    }
    // noinspection JSUnusedGlobalSymbols
    async dragGrabbedObject(localID, grabPosition, grabOffset = Vector3_1.Vector3.getZero(), uvCoordinate = Vector3_1.Vector3.getZero(), stCoordinate = Vector3_1.Vector3.getZero(), faceIndex = 0, position = Vector3_1.Vector3.getZero(), normal = Vector3_1.Vector3.getZero(), binormal = Vector3_1.Vector3.getZero()) {
        // For some reason this message takes a UUID when the others take a LocalID - wtf?
        if (!(localID instanceof UUID_1.UUID)) {
            const obj = this.currentRegion.objects.getObjectByLocalID(localID);
            localID = obj.FullID;
        }
        const msg = new ObjectGrabUpdate_1.ObjectGrabUpdateMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.ObjectData = {
            ObjectID: localID,
            GrabOffsetInitial: grabOffset,
            GrabPosition: grabPosition,
            TimeSinceLast: 0
        };
        msg.SurfaceInfo = [
            {
                UVCoord: uvCoordinate,
                STCoord: stCoordinate,
                FaceIndex: faceIndex,
                Position: position,
                Normal: normal,
                Binormal: binormal
            }
        ];
        const seqID = this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return this.circuit.waitForAck(seqID, 10000);
    }
    // noinspection JSUnusedGlobalSymbols
    async touchObject(localID, grabOffset = Vector3_1.Vector3.getZero(), uvCoordinate = Vector3_1.Vector3.getZero(), stCoordinate = Vector3_1.Vector3.getZero(), faceIndex = 0, position = Vector3_1.Vector3.getZero(), normal = Vector3_1.Vector3.getZero(), binormal = Vector3_1.Vector3.getZero()) {
        if (localID instanceof UUID_1.UUID) {
            const obj = this.currentRegion.objects.getObjectByUUID(localID);
            localID = obj.ID;
        }
        await this.grabObject(localID, grabOffset, uvCoordinate, stCoordinate, faceIndex, position, normal, binormal);
        return this.deGrabObject(localID, grabOffset, uvCoordinate, stCoordinate, faceIndex, position, normal, binormal);
    }
    // noinspection JSUnusedGlobalSymbols
    async rezPrims(count) {
        let agentPos = new Vector3_1.Vector3([128, 128, 2048]);
        try {
            const agentLocalID = this.currentRegion.agent.localID;
            const agentObject = this.currentRegion.objects.getObjectByLocalID(agentLocalID);
            if (agentObject.Position !== undefined) {
                agentPos = new Vector3_1.Vector3(agentObject.Position);
            }
            else {
                throw new Error('Agent position is undefined');
            }
        }
        catch (_error) {
            console.warn('Unable to find avatar location, rezzing at ' + agentPos.toString());
        }
        agentPos.z += 2.0;
        // Set camera above target location for fast acquisition
        const campos = new Vector3_1.Vector3(agentPos);
        campos.z += 2.0;
        this.currentRegion.clientCommands.agent.setCamera(campos, agentPos, 10, new Vector3_1.Vector3([-1.0, 0, 0]), new Vector3_1.Vector3([0.0, 1.0, 0]));
        return this.createPrims(count, agentPos);
    }
    async createPrims(count, position) {
        return new Promise((resolve, reject) => {
            const gatheredPrims = [];
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
                reject(new Error('Failed to gather ' + count + ' prims - only gathered ' + gatheredPrims.length));
            }, 30000);
            objSub = this.currentRegion.clientEvents.onNewObjectEvent.subscribe((evt) => {
                (async () => {
                    if (evt.object.resolvedAt === undefined) {
                        // We need to get the full ObjectProperties so we can be sure this is or isn't a rez from inventory
                        await this.resolveObject(evt.object, {});
                    }
                    if (evt.createSelected && !evt.object.claimedForBuild) {
                        if (evt.object.itemID === undefined || evt.object.itemID.isZero()) {
                            if (evt.object.PCode === PCode_1.PCode.Prim &&
                                evt.object.Material === 3 &&
                                evt.object.PathCurve === 16 &&
                                evt.object.ProfileCurve === 1 &&
                                evt.object.PathBegin === 0 &&
                                evt.object.PathEnd === 1 &&
                                evt.object.PathScaleX === 1 &&
                                evt.object.PathScaleY === 1 &&
                                evt.object.PathShearX === 0 &&
                                evt.object.PathShearY === 0 &&
                                evt.object.PathTwist === 0 &&
                                evt.object.PathTwistBegin === 0 &&
                                evt.object.PathRadiusOffset === 0 &&
                                evt.object.PathTaperX === 0 &&
                                evt.object.PathTaperY === 0 &&
                                evt.object.PathRevolutions === 1 &&
                                evt.object.PathSkew === 0 &&
                                evt.object.ProfileBegin === 0 &&
                                evt.object.ProfileHollow === 0) {
                                evt.object.claimedForBuild = true;
                                gatheredPrims.push(evt.object);
                                if (gatheredPrims.length === count) {
                                    if (objSub !== undefined) {
                                        objSub.unsubscribe();
                                        objSub = undefined;
                                    }
                                    if (timeout !== undefined) {
                                        clearTimeout(timeout);
                                        timeout = undefined;
                                    }
                                    resolve(gatheredPrims);
                                }
                            }
                        }
                    }
                })().catch((_e) => {
                    // ignore
                });
            });
            for (let x = 0; x < count; x++) {
                const msg = new ObjectAdd_1.ObjectAddMessage();
                msg.AgentData = {
                    AgentID: this.agent.agentID,
                    SessionID: this.circuit.sessionID,
                    GroupID: UUID_1.UUID.zero()
                };
                msg.ObjectData = {
                    PCode: PCode_1.PCode.Prim,
                    Material: 3,
                    AddFlags: PrimFlags_1.PrimFlags.CreateSelected,
                    PathCurve: 16,
                    ProfileCurve: 1,
                    PathBegin: 0,
                    PathEnd: 0,
                    PathScaleX: 100,
                    PathScaleY: 100,
                    PathShearX: 0,
                    PathShearY: 0,
                    PathTwist: 0,
                    PathTwistBegin: 0,
                    PathRadiusOffset: 0,
                    PathTaperX: 0,
                    PathTaperY: 0,
                    PathRevolutions: 0,
                    PathSkew: 0,
                    ProfileBegin: 0,
                    ProfileEnd: 0,
                    ProfileHollow: 0,
                    BypassRaycast: 1,
                    RayStart: position,
                    RayEnd: position,
                    RayTargetID: UUID_1.UUID.zero(),
                    RayEndIsIntersection: 0,
                    Scale: new Vector3_1.Vector3([0.5, 0.5, 0.5]),
                    Rotation: Quaternion_1.Quaternion.getIdentity(),
                    State: 0
                };
                this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
            }
        });
    }
    async waitForObjectByLocalID(localID, timeout) {
        return new Promise((resolve, reject) => {
            let tmr = null;
            const subscription = this.currentRegion.clientEvents.onNewObjectEvent.subscribe((event) => {
                if (event.localID === localID) {
                    if (tmr !== null) {
                        clearTimeout(tmr);
                    }
                    subscription.unsubscribe();
                    resolve(event.object);
                }
            });
            tmr = setTimeout(() => {
                subscription.unsubscribe();
                reject(new Error('Timeout'));
            }, timeout);
        });
    }
    async waitForObjectByUUID(objectID, timeout) {
        return new Promise((resolve, reject) => {
            let tmr = null;
            const subscription = this.currentRegion.clientEvents.onNewObjectEvent.subscribe((event) => {
                if (event.objectID.equals(objectID)) {
                    if (tmr !== null) {
                        clearTimeout(tmr);
                    }
                    subscription.unsubscribe();
                    resolve(event.object);
                }
            });
            tmr = setTimeout(() => {
                subscription.unsubscribe();
                reject(new Error('Timeout'));
            }, timeout);
        });
    }
    async buildPart(obj, posOffset, rotOffset, buildMap, markRoot = false) {
        // Calculate geometry
        const objectPosition = new Vector3_1.Vector3(obj.Position);
        const objectRotation = new Quaternion_1.Quaternion(obj.Rotation);
        const objectScale = new Vector3_1.Vector3(obj.Scale);
        let finalPos = Vector3_1.Vector3.getZero();
        let finalRot = Quaternion_1.Quaternion.getIdentity();
        if (posOffset.x === 0.0 && posOffset.y === 0.0 && posOffset.z === 0.0 && objectPosition !== undefined) {
            finalPos = new Vector3_1.Vector3(objectPosition);
            finalRot = new Quaternion_1.Quaternion(objectRotation);
        }
        else {
            const adjustedPos = new Vector3_1.Vector3(objectPosition).multiplyQuaternion(new Quaternion_1.Quaternion(rotOffset));
            finalPos = new Vector3_1.Vector3(new Vector3_1.Vector3(posOffset).add(adjustedPos));
            const baseRot = new Quaternion_1.Quaternion(rotOffset);
            finalRot = new Quaternion_1.Quaternion(baseRot.multiply(new Quaternion_1.Quaternion(objectRotation)));
        }
        // Is this a mesh part?
        let object = null;
        let rezzedMesh = false;
        if (obj.extraParams?.meshData !== null && obj.extraParams?.meshData.type === SculptType_1.SculptType.Mesh) {
            const meshEntry = buildMap.assetMap.mesh.get(obj.extraParams.meshData.meshData.toString());
            if (meshEntry !== undefined) {
                const rezLocation = new Vector3_1.Vector3(buildMap.rezLocation);
                rezLocation.z += (objectScale.z / 2);
                if (meshEntry.item !== undefined) {
                    try {
                        object = await meshEntry.item.rezInWorld(rezLocation);
                        rezzedMesh = true;
                    }
                    catch (err) {
                        console.error('Failed to rez object ' + obj.name + ' in-world');
                        console.error(err);
                    }
                }
                else {
                    console.error('Unable to rez mesh item from inventory - item is null');
                }
            }
        }
        if (!rezzedMesh && buildMap.primReservoir.length > 0) {
            const newPrim = buildMap.primReservoir.shift();
            if (newPrim !== undefined) {
                object = newPrim;
                try {
                    await object.setShape(obj.PathCurve, obj.ProfileCurve, obj.PathBegin, obj.PathEnd, obj.PathScaleX, obj.PathScaleY, obj.PathShearX, obj.PathShearY, obj.PathTwist, obj.PathTwistBegin, obj.PathRadiusOffset, obj.PathTaperX, obj.PathTaperY, obj.PathRevolutions, obj.PathSkew, obj.ProfileBegin, obj.ProfileEnd, obj.ProfileHollow);
                }
                catch (err) {
                    console.error('Error setting shape on ' + obj.name);
                    console.error(err);
                }
            }
        }
        else if (!rezzedMesh) {
            console.error('Exhausted prim reservoir!!');
        }
        if (object === null) {
            console.error('Failed to acquire prim for build');
            throw new Error('Failed to acquire prim for build');
        }
        if (markRoot) {
            object.isMarkedRoot = true;
        }
        try {
            await object.setGeometry(finalPos, finalRot, objectScale);
        }
        catch (err) {
            console.error('Error setting geometry on ' + obj.name);
            console.error(err);
        }
        if (obj.extraParams.sculptData !== null) {
            if (obj.extraParams.sculptData.type !== SculptType_1.SculptType.Mesh) {
                const oldTextureID = obj.extraParams.sculptData.texture.toString();
                const item = buildMap.assetMap.textures.get(oldTextureID);
                if (item?.item) {
                    obj.extraParams.sculptData.texture = item.item.assetID;
                }
            }
        }
        if (obj.extraParams.lightImageData !== null) {
            const oldTextureID = obj.extraParams.lightImageData.texture.toString();
            const item = buildMap.assetMap.textures.get(oldTextureID);
            if (item?.item) {
                obj.extraParams.lightImageData.texture = item.item.assetID;
            }
        }
        if (obj.extraParams.renderMaterialData !== null) {
            for (const entry of obj.extraParams.renderMaterialData.params) {
                const oldTextureID = entry.textureUUID.toString();
                const item = buildMap.assetMap.gltfMaterials.get(oldTextureID);
                if (item?.item) {
                    entry.textureUUID = item.item.assetID;
                }
            }
        }
        if (rezzedMesh) {
            obj.extraParams.meshData = object.extraParams.meshData;
            obj.extraParams.sculptData = object.extraParams.sculptData;
        }
        try {
            await object.setExtraParams(obj.extraParams);
        }
        catch (err) {
            if (err instanceof Error) {
                throw (err);
            }
            else if (typeof err === 'string') {
                throw new Error(err);
            }
            else {
                throw new Error('Error setting ExtraParams on ' + obj.name);
            }
        }
        if (obj.TextureEntry !== undefined) {
            // Handle materials
            const materialUpload = {
                'FullMaterialsPerFace': []
            };
            let defaultMaterial = null;
            const materialFaces = {};
            if (obj.TextureEntry.defaultTexture !== undefined && obj.TextureEntry.defaultTexture !== null) {
                const { materialID } = obj.TextureEntry.defaultTexture;
                if (!materialID.isZero()) {
                    const storedMat = buildMap.assetMap.materials.get(materialID.toString());
                    if (storedMat?.item) {
                        defaultMaterial = {
                            ID: object.ID,
                            Material: storedMat.item.toLLSDObject()
                        };
                    }
                }
            }
            for (let face = 0; face < obj.TextureEntry.faces.length; face++) {
                const { materialID } = obj.TextureEntry.faces[face];
                if (!materialID.isZero()) {
                    const storedMat = buildMap.assetMap.materials.get(materialID.toString());
                    if (storedMat?.item) {
                        materialUpload.FullMaterialsPerFace.push({
                            Face: face,
                            ID: object.ID,
                            Material: storedMat.item.toLLSDObject()
                        });
                        materialFaces[face] = {
                            added: true,
                            complete: false
                        };
                    }
                }
            }
            if (defaultMaterial) {
                // This is a pretty nasty hack but we don't have much choice, without full
                // prim decomposition code to figure out how many faces belong in a particular volume.
                // Second Life requires that the material be specified per face, but per the defaultTexture
                // in the texture entry we don't actually know how many faces there are
                Logger_1.Logger.Info('Inserting script to determine face count..');
                const helper = new PrimFacesHelper_1.PrimFacesHelper(this.bot, object);
                const sides = await helper.getFaces();
                Logger_1.Logger.Info(String(sides) + ' faces');
                for (let side = 0; side < sides; side++) {
                    if (!materialFaces[side]) {
                        materialUpload.FullMaterialsPerFace.push({
                            Face: side,
                            ...defaultMaterial
                        });
                        materialFaces[side] = {
                            added: true,
                            complete: false
                        };
                    }
                }
            }
            if (Object.keys(materialFaces).length > 0) {
                const zipped = await Utils_1.Utils.deflate(Buffer.from(LLSD.LLSD.formatBinary(materialUpload).octets));
                const newMat = {
                    'Zipped': new LLSD.Binary(Array.from(zipped), 'BASE64')
                };
                const result = await this.currentRegion.caps.capsPutXML('RenderMaterials', newMat);
                if (result.Zipped) {
                    const resultUnzipped = await Utils_1.Utils.inflate(Buffer.from(result.Zipped.octets));
                    const binData = new LLSD.Binary(Array.from(resultUnzipped), 'BASE64');
                    const llsdResult = LLSD.LLSD.parseBinary(binData);
                    for (const result2 of llsdResult.result) {
                        const face = result2.Face;
                        if (materialFaces[face] !== undefined) {
                            materialFaces[face].complete = true;
                        }
                    }
                    for (const face of Object.keys(materialFaces)) {
                        if (!materialFaces[face].complete) {
                            console.error('Failed to update material on face ' + String(face));
                        }
                    }
                }
            }
            if (obj.TextureEntry.defaultTexture !== null) {
                const oldTextureID = obj.TextureEntry.defaultTexture.textureID.toString();
                const item = buildMap.assetMap.textures.get(oldTextureID);
                if (item?.item) {
                    obj.TextureEntry.defaultTexture.textureID = item.item.assetID;
                }
            }
            for (const j of obj.TextureEntry.faces) {
                const oldTextureID = j.textureID.toString();
                const item = buildMap.assetMap.textures.get(oldTextureID);
                if (item?.item) {
                    j.textureID = item.item.assetID;
                }
            }
            try {
                await object.setTextureEntry(obj.TextureEntry);
            }
            catch (error) {
                console.error('Error setting TextureEntry on ' + obj.name);
                console.error(error);
            }
        }
        if (obj.name !== undefined) {
            try {
                await object.setName(obj.name);
            }
            catch (error) {
                if (error instanceof Error) {
                    throw error;
                }
                else if (typeof error === 'string') {
                    throw new Error(error);
                }
                else {
                    throw new Error('Error setting name on ' + obj.name);
                }
            }
        }
        if (obj.description !== undefined) {
            try {
                await object.setDescription(obj.description);
            }
            catch (error) {
                if (error instanceof Error) {
                    throw error;
                }
                else if (typeof error === 'string') {
                    throw new Error(error);
                }
                else {
                    throw new Error('Error setting name on ' + obj.name);
                }
            }
        }
        // Copy so the list doesn't mutate as we're processing
        const fixedInventory = [...obj.inventory];
        for (const invItem of fixedInventory) {
            try {
                if (invItem.inventoryType === InventoryType_1.InventoryType.Object && invItem.assetID.isZero()) {
                    invItem.assetID = invItem.itemID;
                }
                switch (invItem.inventoryType) {
                    case InventoryType_1.InventoryType.Settings:
                        {
                            const item = buildMap.assetMap.settings.get(invItem.assetID.toString());
                            if (item?.item) {
                                await object.dropInventoryIntoContents(item.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === item.item.name) {
                                        taskItem.permissions.nextOwnerMask = invItem.permissions.nextOwnerMask;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.Wearable:
                        {
                            const item = buildMap.assetMap.wearables.get(invItem.assetID.toString());
                            if (item?.item) {
                                await object.dropInventoryIntoContents(item.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === item.item.name) {
                                        taskItem.permissions.nextOwnerMask = invItem.permissions.nextOwnerMask;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.Notecard:
                        {
                            const item = buildMap.assetMap.notecards.get(invItem.assetID.toString());
                            if (item?.item) {
                                await object.dropInventoryIntoContents(item.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === item.item.name) {
                                        taskItem.permissions.nextOwnerMask = invItem.permissions.nextOwnerMask;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.Sound:
                        {
                            const item = buildMap.assetMap.sounds.get(invItem.assetID.toString());
                            if (item?.item) {
                                await object.dropInventoryIntoContents(item.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === item.item.name) {
                                        taskItem.permissions.nextOwnerMask = invItem.permissions.nextOwnerMask;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.Gesture:
                        {
                            const item = buildMap.assetMap.gestures.get(invItem.assetID.toString());
                            if (item?.item) {
                                await object.dropInventoryIntoContents(item.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === item.item.name) {
                                        taskItem.permissions.nextOwnerMask = invItem.permissions.nextOwnerMask;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.LSL:
                        {
                            const item = buildMap.assetMap.scripts.get(invItem.assetID.toString());
                            if (item?.item) {
                                await object.dropInventoryIntoContents(item.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === item.item.name) {
                                        taskItem.permissions = invItem.permissions;
                                        await taskItem.rename(invItem.name);
                                        if (taskItem.type === AssetType_1.AssetType.LSLText) {
                                            let compileQueue = buildMap.assetMap.scriptsToCompile.get(object.FullID.toString());
                                            if (compileQueue === undefined) {
                                                compileQueue = {
                                                    gameObject: object,
                                                    scripts: []
                                                };
                                            }
                                            compileQueue.scripts.push({
                                                item: taskItem,
                                                oldAssetID: invItem.assetID,
                                                shouldStart: invItem.scriptRunning === true,
                                                mono: invItem.scriptMono !== false
                                            });
                                            buildMap.assetMap.scriptsToCompile.set(object.FullID.toString(), compileQueue);
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.Material:
                        {
                            const item = buildMap.assetMap.gltfMaterials.get(invItem.assetID.toString());
                            if (item?.item) {
                                await object.dropInventoryIntoContents(item.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === item.item.name) {
                                        taskItem.permissions.nextOwnerMask = invItem.permissions.nextOwnerMask;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.Animation:
                        {
                            const item = buildMap.assetMap.animations.get(invItem.assetID.toString());
                            if (item?.item) {
                                await object.dropInventoryIntoContents(item.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === item.item.name) {
                                        taskItem.permissions = invItem.permissions;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.Object:
                        {
                            const inventoryItem = buildMap.assetMap.objects.get(invItem.itemID.toString());
                            if (inventoryItem?.item) {
                                await object.dropInventoryIntoContents(inventoryItem.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === inventoryItem.item.name) {
                                        taskItem.permissions.nextOwnerMask = invItem.permissions.nextOwnerMask;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    case InventoryType_1.InventoryType.Texture:
                    case InventoryType_1.InventoryType.Snapshot:
                        {
                            const texItem = buildMap.assetMap.textures.get(invItem.assetID);
                            if (texItem?.item) {
                                await object.dropInventoryIntoContents(texItem.item);
                                await object.updateInventory();
                                for (const taskItem of object.inventory) {
                                    if (taskItem.name === texItem.item.name) {
                                        taskItem.permissions.nextOwnerMask = invItem.permissions.nextOwnerMask;
                                        await taskItem.rename(invItem.name);
                                    }
                                }
                            }
                            break;
                        }
                    default: // TODO: 3 - landmark
                        console.error('Unsupported inventory type: ' + invItem.inventoryType);
                        break;
                }
            }
            catch (error) {
                console.error(error);
            }
        }
        return object;
    }
    gatherAssets(obj, buildMap) {
        if (obj.extraParams !== undefined) {
            if (obj.extraParams.meshData !== null) {
                buildMap.assetMap.mesh.request(obj.extraParams.meshData.meshData, {
                    name: obj.name ?? 'Object',
                    description: obj.description ?? '(no description)'
                });
            }
            else {
                buildMap.primsNeeded++;
            }
            if (obj.extraParams.sculptData !== null) {
                if (obj.extraParams.sculptData.type !== SculptType_1.SculptType.Mesh) {
                    buildMap.assetMap.textures.request(obj.extraParams.sculptData.texture);
                }
            }
            if (obj.extraParams.lightImageData != null && !obj.extraParams.lightImageData.texture.isZero()) {
                buildMap.assetMap.textures.request(obj.extraParams.lightImageData.texture);
            }
            if (obj.extraParams.renderMaterialData != null) {
                for (const item of obj.extraParams.renderMaterialData.params) {
                    if (!item.textureUUID.isZero()) {
                        buildMap.assetMap.gltfMaterials.request(item.textureUUID);
                    }
                }
            }
        }
        if (obj.TextureEntry !== undefined) {
            for (const j of obj.TextureEntry.faces) {
                const { textureID } = j;
                buildMap.assetMap.textures.request(textureID);
                const { materialID } = j;
                if (!materialID.isZero()) {
                    buildMap.assetMap.materials.request(materialID);
                }
            }
            if (obj.TextureEntry.defaultTexture !== null) {
                const { textureID } = obj.TextureEntry.defaultTexture;
                buildMap.assetMap.textures.request(textureID);
                const { materialID } = obj.TextureEntry.defaultTexture;
                if (!materialID.isZero()) {
                    buildMap.assetMap.materials.request(materialID);
                }
            }
        }
        if (obj.inventory !== undefined) {
            // Copy so the list doesn't mutate as we're processing
            const invList = [...obj.inventory];
            for (const j of invList) {
                const { assetID } = j;
                switch (j.inventoryType) {
                    case InventoryType_1.InventoryType.Animation:
                        {
                            buildMap.assetMap.animations.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.Wearable:
                        {
                            buildMap.assetMap.wearables.request(assetID, {
                                name: j.name,
                                description: j.description,
                                assetType: j.type
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.CallingCard:
                        {
                            buildMap.assetMap.callingcards.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.Gesture:
                        {
                            buildMap.assetMap.gestures.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.LSL:
                        {
                            buildMap.assetMap.scripts.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.Texture:
                    case InventoryType_1.InventoryType.Snapshot:
                        {
                            buildMap.assetMap.textures.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.Notecard:
                        {
                            buildMap.assetMap.notecards.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.Sound:
                        {
                            buildMap.assetMap.sounds.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.Object:
                        {
                            buildMap.assetMap.objects.request(assetID);
                            break;
                        }
                    case InventoryType_1.InventoryType.Settings:
                        {
                            buildMap.assetMap.settings.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    case InventoryType_1.InventoryType.Material:
                        {
                            buildMap.assetMap.gltfMaterials.request(assetID, {
                                name: j.name,
                                description: j.description
                            });
                            break;
                        }
                    default:
                        console.error('Unsupported inventory type: ' + j.inventoryType);
                        break;
                }
            }
        }
        if (obj.children) {
            for (const child of obj.children) {
                this.gatherAssets(child, buildMap);
            }
        }
    }
}
exports.RegionCommands = RegionCommands;
//# sourceMappingURL=RegionCommands.js.map