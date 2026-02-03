"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectStoreLite = void 0;
const Logger_1 = require("./Logger");
const Message_1 = require("../enums/Message");
const RequestMultipleObjects_1 = require("./messages/RequestMultipleObjects");
const UUID_1 = require("./UUID");
const Utils_1 = require("./Utils");
const NameValue_1 = require("./NameValue");
const GameObject_1 = require("./public/GameObject");
const FilterResponse_1 = require("../enums/FilterResponse");
const ObjectSelect_1 = require("./messages/ObjectSelect");
const ObjectDeselect_1 = require("./messages/ObjectDeselect");
const Quaternion_1 = require("./Quaternion");
const ExtraParams_1 = require("./public/ExtraParams");
const SelectedObjectEvent_1 = require("../events/SelectedObjectEvent");
const PrimFlags_1 = require("../enums/PrimFlags");
const PacketFlags_1 = require("../enums/PacketFlags");
const PCode_1 = require("../enums/PCode");
const BotOptionFlags_1 = require("../enums/BotOptionFlags");
const NewObjectEvent_1 = require("../events/NewObjectEvent");
const ObjectUpdatedEvent_1 = require("../events/ObjectUpdatedEvent");
const CompressedFlags_1 = require("../enums/CompressedFlags");
const Vector3_1 = require("./Vector3");
const ObjectResolvedEvent_1 = require("../events/ObjectResolvedEvent");
const Avatar_1 = require("./public/Avatar");
const LLGLTFMaterialOverride_1 = require("./LLGLTFMaterialOverride");
const LLSD_1 = require("./llsd/LLSD");
const LLSDMap_1 = require("./llsd/LLSDMap");
const LLSDInteger_1 = require("./llsd/LLSDInteger");
const LLSDArray_1 = require("./llsd/LLSDArray");
class ObjectStoreLite {
    rtree;
    circuit;
    agent;
    objects = new Map();
    objectsByUUID = new Map();
    objectsByParent = new Map();
    clientEvents;
    options;
    fullStore = false;
    requestedObjects = new Set();
    deadObjects = [];
    persist = false;
    cachedMaterialOverrides = new Map();
    pendingObjectProperties = new Map;
    physicsSubscription;
    selectedPrimsWithoutUpdate = new Map();
    selectedChecker;
    blacklist = new Map();
    pendingResolves = new Set();
    constructor(circuit, agent, clientEvents, options) {
        agent.localID = 0;
        this.options = options;
        this.fullStore = false;
        this.clientEvents = clientEvents;
        this.circuit = circuit;
        this.agent = agent;
        this.circuit.subscribeToMessages([
            Message_1.Message.ObjectUpdate,
            Message_1.Message.ObjectUpdateCached,
            Message_1.Message.ObjectUpdateCompressed,
            Message_1.Message.MultipleObjectUpdate,
            Message_1.Message.ImprovedTerseObjectUpdate,
            Message_1.Message.ObjectProperties,
            Message_1.Message.KillObject,
            Message_1.Message.GenericStreamingMessage
        ], (packet) => {
            switch (packet.message.id) {
                case Message_1.Message.GenericStreamingMessage:
                    {
                        if (!this.fullStore) {
                            return;
                        }
                        const genMsg = packet.message;
                        if (genMsg.MethodData.Method === 0x4175) {
                            // LLSD Notation format
                            const result = LLSD_1.LLSD.parseNotation(genMsg.DataBlock.Data.toString('utf-8'));
                            if (result instanceof LLSDMap_1.LLSDMap) {
                                const localID = result.get('id');
                                if (!(localID instanceof LLSDInteger_1.LLSDInteger)) {
                                    return;
                                }
                                const tes = result.get('te');
                                const ods = result.get('od');
                                const overrides = new Map();
                                if (Array.isArray(tes) && Array.isArray(ods) && tes.length === ods.length) {
                                    for (let x = 0; x < tes.length; x++) {
                                        const te = tes[x];
                                        if (!(te instanceof LLSDInteger_1.LLSDInteger)) {
                                            continue;
                                        }
                                        const params = ods[x];
                                        if (!(params instanceof LLSDMap_1.LLSDMap)) {
                                            continue;
                                        }
                                        const textureIDs = params.get('tex');
                                        const baseColor = params.get('bc');
                                        const emissiveColor = params.get('ec');
                                        const metallicFactor = params.get('mf');
                                        const roughnessFactor = params.get('rf');
                                        const alphaMode = params.get('am');
                                        const alphaCutoff = params.get('ac');
                                        const doubleSided = params.get('ds');
                                        const textureTransforms = params.get('ti');
                                        const override = new LLGLTFMaterialOverride_1.LLGLTFMaterialOverride();
                                        overrides.set(te.valueOf(), override);
                                        if (textureIDs !== undefined && Array.isArray(textureIDs)) {
                                            override.textures = [];
                                            for (const tex of textureIDs) {
                                                if (tex instanceof UUID_1.UUID) {
                                                    override.textures.push(tex.toString());
                                                }
                                                else {
                                                    override.textures.push(null);
                                                }
                                            }
                                        }
                                        if (baseColor !== undefined && Array.isArray(baseColor) && baseColor.length === 4) {
                                            override.baseColor = LLSDArray_1.LLSDArray.toNumberArray(baseColor);
                                        }
                                        if (emissiveColor !== undefined && Array.isArray(emissiveColor) && emissiveColor.length === 3) {
                                            override.emissiveFactor = LLSDArray_1.LLSDArray.toNumberArray(emissiveColor);
                                        }
                                        if (metallicFactor !== undefined) {
                                            override.metallicFactor = metallicFactor.valueOf();
                                        }
                                        if (roughnessFactor !== undefined) {
                                            override.roughnessFactor = roughnessFactor.valueOf();
                                        }
                                        if (alphaMode !== undefined) {
                                            override.alphaMode = alphaMode.valueOf();
                                        }
                                        if (alphaCutoff !== undefined) {
                                            override.alphaCutoff = alphaCutoff.valueOf();
                                        }
                                        if (doubleSided !== undefined) {
                                            override.doubleSided = doubleSided;
                                        }
                                        if (textureTransforms !== undefined && Array.isArray(textureTransforms)) {
                                            override.textureTransforms = [];
                                            for (const transform of textureTransforms) {
                                                const o = transform.get('o');
                                                const s = transform.get('s');
                                                const r = transform.get('r');
                                                const tObj = {
                                                    offset: o !== undefined ? LLSDArray_1.LLSDArray.toNumberArray(o) : undefined,
                                                    scale: s !== undefined ? LLSDArray_1.LLSDArray.toNumberArray(s) : undefined,
                                                    rotation: r !== undefined ? r.valueOf() : undefined
                                                };
                                                override.textureTransforms.push(tObj);
                                            }
                                        }
                                    }
                                    const obj = this.objects.get(localID.valueOf());
                                    const textureEntry = obj?.TextureEntry;
                                    if (textureEntry) {
                                        textureEntry.gltfMaterialOverrides = overrides;
                                    }
                                    else {
                                        this.cachedMaterialOverrides.set(localID.valueOf(), overrides);
                                    }
                                }
                            }
                        }
                        break;
                    }
                case Message_1.Message.ObjectProperties:
                    {
                        const objProp = packet.message;
                        for (const obj of objProp.ObjectData) {
                            const obje = this.objectsByUUID.get(obj.ObjectID.toString());
                            const o = this.objects.get(obje ?? 0);
                            if (obje !== undefined && o !== undefined) {
                                this.applyObjectProperties(o, obj);
                            }
                            else {
                                this.pendingObjectProperties.set(obj.ObjectID.toString(), obj);
                            }
                        }
                        break;
                    }
                case Message_1.Message.ObjectUpdate:
                    {
                        const objectUpdate = packet.message;
                        this.objectUpdate(objectUpdate);
                        break;
                    }
                case Message_1.Message.ObjectUpdateCached:
                    {
                        const objectUpdateCached = packet.message;
                        this.objectUpdateCached(objectUpdateCached);
                        break;
                    }
                case Message_1.Message.ObjectUpdateCompressed:
                    {
                        const objectUpdateCompressed = packet.message;
                        this.objectUpdateCompressed(objectUpdateCompressed);
                        break;
                    }
                case Message_1.Message.ImprovedTerseObjectUpdate:
                    {
                        const objectUpdateTerse = packet.message;
                        this.objectUpdateTerse(objectUpdateTerse);
                        break;
                    }
                case Message_1.Message.KillObject:
                    {
                        const killObj = packet.message;
                        this.killObject(killObj);
                        break;
                    }
                default:
                    break;
            }
        });
        this.physicsSubscription = this.clientEvents.onPhysicsDataEvent.subscribe((evt) => {
            const obj = this.objects.get(evt.localID);
            if (obj) {
                obj.physicsShapeType = evt.physicsShapeType;
                obj.density = evt.density;
                obj.restitution = evt.restitution;
                obj.gravityMultiplier = evt.gravityMultiplier;
                obj.friction = evt.friction;
            }
        });
        if (!(this.options & BotOptionFlags_1.BotOptionFlags.LiteObjectStore)) {
            this.selectedChecker = setInterval(() => {
                if (this.circuit === undefined) {
                    return;
                }
                try {
                    let selectObjects = [];
                    for (const key of this.selectedPrimsWithoutUpdate.keys()) {
                        selectObjects.push(key);
                    }
                    function shuffle(a) {
                        let j = 0, x = '', i = 0;
                        for (i = a.length - 1; i > 0; i--) {
                            j = Math.floor(Math.random() * (i + 1));
                            x = a[i];
                            a[i] = a[j];
                            a[j] = x;
                        }
                        return a;
                    }
                    selectObjects = shuffle(selectObjects);
                    if (selectObjects.length > 10) {
                        selectObjects = selectObjects.slice(0, 20);
                    }
                    if (selectObjects.length > 0) {
                        const selectObject = new ObjectSelect_1.ObjectSelectMessage();
                        selectObject.AgentData = {
                            AgentID: this.agent.agentID,
                            SessionID: this.circuit.sessionID
                        };
                        selectObject.ObjectData = [];
                        for (const id of selectObjects) {
                            selectObject.ObjectData.push({
                                ObjectLocalID: parseInt(id, 10)
                            });
                        }
                        this.circuit.sendMessage(selectObject, PacketFlags_1.PacketFlags.Reliable);
                    }
                }
                catch (e) {
                    Logger_1.Logger.Error(e);
                }
            }, 1000);
        }
    }
    setPersist(persist) {
        this.persist = persist;
        if (!this.persist) {
            for (const d of this.deadObjects) {
                this.deleteObject(d);
            }
            this.deadObjects = [];
        }
    }
    deleteObject(objectID) {
        const obj = this.objects.get(objectID);
        if (obj) {
            const objectUUID = obj.FullID;
            obj.deleted = true;
            if (this.persist) {
                this.deadObjects.push(objectID);
                return;
            }
            if (obj.IsAttachment && obj.ParentID !== undefined) {
                const parent = this.objects.get(obj.ParentID);
                if (parent !== undefined && parent.PCode === PCode_1.PCode.Avatar) {
                    const agent = this.agent.currentRegion.agents.get(parent.FullID.toString());
                    if (agent !== undefined) {
                        agent.removeAttachment(obj);
                    }
                }
            }
            const foundAgent = this.agent.currentRegion.agents.get(objectUUID.toString());
            if (foundAgent !== undefined) {
                foundAgent.isVisible = false;
            }
            // First, kill all children (not the people kind)
            const objsByParent = this.objectsByParent.get(objectID);
            if (objsByParent) {
                for (const childObjID of objsByParent) {
                    this.deleteObject(childObjID);
                }
            }
            this.objectsByParent.delete(objectID);
            // Now delete this object
            const uuid = obj.FullID.toString();
            this.objectsByUUID.delete(uuid);
            if (obj.ParentID !== undefined) {
                const parentID = obj.ParentID;
                const objsByParentParent = this.objectsByParent.get(parentID);
                if (objsByParentParent) {
                    const ind = objsByParentParent.indexOf(objectID);
                    if (ind !== -1) {
                        objsByParentParent.splice(ind, 1);
                    }
                }
            }
            if (this.rtree && obj.rtreeEntry !== undefined) {
                this.rtree.remove(obj.rtreeEntry);
            }
            this.objects.delete(objectID);
            this.cachedMaterialOverrides.delete(objectID);
        }
    }
    getObjectsByParent(parentID) {
        const list = this.objectsByParent.get(parentID);
        if (list === undefined) {
            return [];
        }
        const result = [];
        for (const localID of list) {
            const obj = this.objects.get(localID);
            if (obj) {
                result.push(obj);
            }
        }
        return result;
    }
    parseNameValues(str) {
        const nv = new Map();
        const lines = str.split('\n');
        for (const line of lines) {
            if (line.length > 0) {
                let kv = line.split(/[\t ]/);
                if (kv.length > 5) {
                    for (let x = 5; x < kv.length; x++) {
                        kv[4] += ' ' + kv[x];
                    }
                    kv = kv.slice(0, 5);
                }
                if (kv.length === 5) {
                    const namevalue = new NameValue_1.NameValue();
                    namevalue.type = kv[1];
                    namevalue.class = kv[2];
                    namevalue.sendTo = kv[3];
                    namevalue.value = kv[4];
                    nv.set(kv[0], namevalue);
                }
            }
        }
        return nv;
    }
    shutdown() {
        if (this.selectedChecker !== undefined) {
            clearInterval(this.selectedChecker);
            delete this.selectedChecker;
        }
        this.physicsSubscription.unsubscribe();
        this.objects.clear();
        if (this.rtree) {
            this.rtree.clear();
        }
        this.objectsByUUID.clear();
        this.objectsByParent.clear();
        delete this.circuit;
    }
    populateChildren(obj, _resolve = false) {
        if (obj !== undefined) {
            obj.children = [];
            obj.totalChildren = 0;
            for (const child of this.getObjectsByParent(obj.ID)) {
                if (child.PCode !== PCode_1.PCode.Avatar) {
                    obj.totalChildren++;
                    this.populateChildren(child);
                    if (child.totalChildren !== undefined) {
                        obj.totalChildren += child.totalChildren;
                    }
                    obj.children.push(child);
                }
            }
            obj.childrenPopulated = true;
        }
    }
    getAllObjects(options) {
        const results = [];
        const found = {};
        for (const localID of this.objects.keys()) {
            const go = this.objects.get(localID);
            if (!go) {
                continue;
            }
            if (!options.includeAvatars && go.PCode === PCode_1.PCode.Avatar) {
                continue;
            }
            if (!options.includeAttachments && go.IsAttachment) {
                continue;
            }
            try {
                const parent = this.findParent(go);
                if (parent.ParentID === 0) {
                    const uuid = parent.FullID.toString();
                    if (found[uuid] === undefined) {
                        found[uuid] = parent;
                        results.push(parent);
                    }
                }
                if (go.ParentID) {
                    let objects = this.objectsByParent.get(go.ParentID);
                    if (!objects?.includes(localID)) {
                        if (objects === undefined) {
                            objects = [];
                        }
                        objects.push(localID);
                        this.objectsByParent.set(go.ParentID, objects);
                    }
                }
            }
            catch (error) {
                console.log('Failed to find parent for ' + go.FullID.toString());
                console.error(error);
                // Unable to find parent, full object probably not fully loaded yet
            }
        }
        // Now populate children of each found object
        for (const obj of results) {
            this.populateChildren(obj);
        }
        return results;
    }
    getNumberOfObjects() {
        return this.objects.size;
    }
    getObjectsInArea(minX, maxX, minY, maxY, minZ, maxZ) {
        if (!this.rtree) {
            throw new Error('GetObjectsInArea not available with the Lite object store');
        }
        const result = this.rtree.search({
            minX: minX,
            maxX: maxX,
            minY: minY,
            maxY: maxY,
            minZ: minZ,
            maxZ: maxZ
        });
        const found = {};
        const objs = [];
        for (const obj of result) {
            const o = obj;
            const go = o.gameObject;
            if (go.PCode !== PCode_1.PCode.Avatar && (go.IsAttachment === undefined || !go.IsAttachment)) {
                try {
                    const parent = this.findParent(go);
                    if (parent.PCode !== PCode_1.PCode.Avatar && (parent.IsAttachment === undefined || !parent.IsAttachment) && parent.ParentID === 0) {
                        const uuid = parent.FullID.toString();
                        if (found[uuid] === undefined) {
                            found[uuid] = parent;
                            objs.push(parent);
                        }
                    }
                }
                catch (error) {
                    console.log('Failed to find parent for ' + go.FullID.toString());
                    console.error(error);
                    // Unable to find parent, full object probably not fully loaded yet
                }
            }
        }
        // Now populate children of each found object
        for (const obj of objs) {
            this.populateChildren(obj);
        }
        return objs;
    }
    getObjectByUUID(fullID) {
        if (fullID instanceof UUID_1.UUID) {
            fullID = fullID.toString();
        }
        const localID = this.objectsByUUID.get(fullID);
        const go = this.objects.get(localID ?? 0);
        if (localID === undefined || go === undefined) {
            throw new Error('No object found with that UUID');
        }
        return go;
    }
    getObjectByLocalID(localID) {
        const go = this.objects.get(localID);
        if (!go) {
            throw new Error('No object found with that UUID');
        }
        return go;
    }
    insertIntoRtree(obj) {
        if (!this.rtree) {
            return;
        }
        if (obj.rtreeEntry !== undefined) {
            this.rtree.remove(obj.rtreeEntry);
        }
        if (!obj.Scale || !obj.Position || !obj.Rotation) {
            return;
        }
        const normalizedScale = new Vector3_1.Vector3(obj.Scale).multiplyQuaternion(new Quaternion_1.Quaternion(obj.Rotation));
        const bounds = {
            minX: obj.Position.x - (normalizedScale.x / 2),
            maxX: obj.Position.x + (normalizedScale.x / 2),
            minY: obj.Position.y - (normalizedScale.y / 2),
            maxY: obj.Position.y + (normalizedScale.y / 2),
            minZ: obj.Position.z - (normalizedScale.z / 2),
            maxZ: obj.Position.z + (normalizedScale.z / 2),
            gameObject: obj
        };
        obj.rtreeEntry = bounds;
        this.rtree.insert(bounds);
    }
    pendingResolve(id) {
        this.pendingResolves.add(id);
    }
    applyObjectProperties(o, obj) {
        this.selectedPrimsWithoutUpdate.delete(o.ID);
        // const n = Utils.BufferToStringSimple(obj.Name); // Currently unused
        o.creatorID = obj.CreatorID;
        o.creationDate = obj.CreationDate;
        o.baseMask = obj.BaseMask;
        o.ownerMask = obj.OwnerMask;
        o.groupMask = obj.GroupMask;
        o.everyoneMask = obj.EveryoneMask;
        o.nextOwnerMask = obj.NextOwnerMask;
        o.ownershipCost = obj.OwnershipCost;
        o.saleType = obj.SaleType;
        o.salePrice = obj.SalePrice;
        o.aggregatePerms = obj.AggregatePerms;
        o.aggregatePermTextures = obj.AggregatePermTextures;
        o.aggregatePermTexturesOwner = obj.AggregatePermTexturesOwner;
        o.category = obj.Category;
        o.inventorySerial = obj.InventorySerial;
        o.itemID = obj.ItemID;
        o.folderID = obj.FolderID;
        o.fromTaskID = obj.FromTaskID;
        o.groupID = obj.GroupID;
        o.lastOwnerID = obj.LastOwnerID;
        o.OwnerID = obj.OwnerID;
        o.name = Utils_1.Utils.BufferToStringSimple(obj.Name);
        o.description = Utils_1.Utils.BufferToStringSimple(obj.Description);
        o.touchName = Utils_1.Utils.BufferToStringSimple(obj.TouchName);
        o.sitName = Utils_1.Utils.BufferToStringSimple(obj.SitName);
        o.textureID = Utils_1.Utils.BufferToStringSimple(obj.TextureID);
        if (!o.resolvedAt) {
            o.resolvedAt = new Date().getTime() / 1000;
        }
        {
            const evt = new ObjectResolvedEvent_1.ObjectResolvedEvent();
            evt.object = o;
            this.clientEvents.onObjectResolvedEvent.next(evt);
        }
        if (o.Flags !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            if ((o.Flags & PrimFlags_1.PrimFlags.CreateSelected) === PrimFlags_1.PrimFlags.CreateSelected) {
                const evt = new SelectedObjectEvent_1.SelectedObjectEvent();
                evt.object = o;
                this.clientEvents.onSelectedObjectEvent.next(evt);
            }
        }
    }
    async requestMissingObject(localID, attempt = 0) {
        if (this.requestedObjects.has(localID)) {
            return;
        }
        if (this.circuit === undefined) {
            return;
        }
        this.requestedObjects.add(localID);
        const black = this.blacklist.get(localID);
        if (black !== undefined) {
            const thirtyMinutesAgo = new Date(new Date().getTime() - 30 * 60000);
            if (black >= thirtyMinutesAgo) {
                return;
            }
            else {
                this.blacklist.delete(localID);
            }
        }
        const rmo = new RequestMultipleObjects_1.RequestMultipleObjectsMessage();
        rmo.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        rmo.ObjectData = [];
        rmo.ObjectData.push({
            CacheMissType: 0,
            ID: localID
        });
        this.circuit.sendMessage(rmo, PacketFlags_1.PacketFlags.Reliable);
        const selectObject = new ObjectSelect_1.ObjectSelectMessage();
        selectObject.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        selectObject.ObjectData = [
            {
                'ObjectLocalID': localID
            }
        ];
        this.circuit.sendMessage(selectObject, PacketFlags_1.PacketFlags.Reliable);
        try {
            await this.circuit.waitForMessage(Message_1.Message.ObjectUpdate, 10000, (message) => {
                for (const obj of message.ObjectData) {
                    if (obj.ID === localID) {
                        return FilterResponse_1.FilterResponse.Finish;
                    }
                }
                return FilterResponse_1.FilterResponse.NoMatch;
            });
            this.requestedObjects.delete(localID);
        }
        catch (_error) {
            this.requestedObjects.delete(localID);
            if (attempt < 5) {
                await this.requestMissingObject(localID, ++attempt);
            }
            else {
                if (!this.circuit) {
                    return;
                }
                this.blacklist.set(localID, new Date());
                console.error('Error retrieving missing object after 5 attempts: ' + localID);
            }
        }
        finally {
            if (this.circuit) {
                const deselectObject = new ObjectDeselect_1.ObjectDeselectMessage();
                deselectObject.AgentData = {
                    AgentID: this.agent.agentID,
                    SessionID: this.circuit.sessionID
                };
                deselectObject.ObjectData = [
                    {
                        'ObjectLocalID': localID
                    }
                ];
                this.circuit.sendMessage(deselectObject, PacketFlags_1.PacketFlags.Reliable);
            }
        }
    }
    objectUpdate(objectUpdate) {
        for (const objData of objectUpdate.ObjectData) {
            const localID = objData.ID;
            const parentID = objData.ParentID;
            let addToParentList = true;
            let newObject = false;
            let obj = this.objects.get(localID);
            if (obj) {
                const p = this.objectsByParent.get(parentID);
                if (obj.ParentID !== parentID && p !== undefined) {
                    const ind = p.indexOf(localID);
                    if (ind !== -1) {
                        p.splice(ind, 1);
                    }
                }
                else if (p) {
                    addToParentList = false;
                }
            }
            else {
                newObject = true;
                const newObj = new GameObject_1.GameObject();
                newObj.region = this.agent.currentRegion;
                this.objects.set(localID, newObj);
            }
            obj = this.objects.get(localID);
            if (obj) {
                obj.deleted = false;
                obj.ID = objData.ID;
                obj.FullID = objData.FullID;
                obj.ParentID = objData.ParentID;
                obj.OwnerID = objData.OwnerID;
                obj.PCode = objData.PCode;
                obj.NameValue = this.parseNameValues(Utils_1.Utils.BufferToStringSimple(objData.NameValue));
                obj.IsAttachment = obj.NameValue.get('AttachItemID') !== undefined;
                if (obj.IsAttachment && obj.State !== undefined) {
                    obj.attachmentPoint = this.decodeAttachPoint(obj.State);
                }
                if (objData.PCode === PCode_1.PCode.Avatar && obj.FullID.toString() === this.agent.agentID.toString()) {
                    this.agent.localID = localID;
                    if (this.options & BotOptionFlags_1.BotOptionFlags.StoreMyAttachmentsOnly) {
                        for (const objParentID of this.objectsByParent.keys()) {
                            const parent = objParentID;
                            if (parent !== this.agent.localID) {
                                let foundAvatars = false;
                                const p = this.objectsByParent.get(parent);
                                if (p !== undefined) {
                                    for (const objID of p) {
                                        const childObj = this.objects.get(objID);
                                        if (childObj) {
                                            if (childObj.PCode === PCode_1.PCode.Avatar) {
                                                foundAvatars = true;
                                            }
                                        }
                                    }
                                }
                                const parentObj = this.objects.get(parent);
                                if (parentObj) {
                                    if (parentObj.PCode === PCode_1.PCode.Avatar) {
                                        foundAvatars = true;
                                    }
                                }
                                if (!foundAvatars) {
                                    this.deleteObject(parent);
                                }
                            }
                        }
                    }
                }
                this.objectsByUUID.set(objData.FullID.toString(), localID);
                let objByParent = this.objectsByParent.get(parentID);
                if (!objByParent) {
                    objByParent = [];
                    this.objectsByParent.set(parentID, objByParent);
                }
                if (addToParentList) {
                    objByParent.push(localID);
                }
                if (objData.PCode !== PCode_1.PCode.Avatar && this.options & BotOptionFlags_1.BotOptionFlags.StoreMyAttachmentsOnly) {
                    if (this.agent.localID !== 0 && obj.ParentID !== this.agent.localID) {
                        // Drop object
                        this.deleteObject(localID);
                        return;
                    }
                }
                this.notifyObjectUpdate(newObject, obj);
                if (objData.ParentID !== undefined && objData.ParentID !== 0 && !this.objects.get(objData.ParentID) && !obj?.IsAttachment) {
                    if (this.fullStore) {
                        void this.requestMissingObject(objData.ParentID);
                    }
                }
            }
        }
    }
    notifyTerseUpdate(obj) {
        if (this.objects.get(obj.ID)) {
            if (obj.PCode === PCode_1.PCode.Avatar) {
                const agent = this.agent.currentRegion.agents.get(obj.FullID.toString());
                if (agent !== undefined) {
                    agent.processObjectUpdate(obj);
                }
                else {
                    console.warn('Received update for unknown avatar, but not a new object?!');
                }
            }
            const updObj = new ObjectUpdatedEvent_1.ObjectUpdatedEvent();
            updObj.localID = obj.ID;
            updObj.objectID = obj.FullID;
            updObj.object = obj;
            this.clientEvents.onObjectUpdatedTerseEvent.next(updObj);
        }
    }
    notifyObjectUpdate(newObject, obj) {
        if (obj.PCode === PCode_1.PCode.Avatar) {
            const avatarID = obj.FullID.toString();
            if (newObject) {
                const agent = this.agent.currentRegion.agents.get(avatarID);
                if (agent === undefined) {
                    const av = Avatar_1.Avatar.fromGameObject(obj);
                    this.agent.currentRegion.agents.set(avatarID, av);
                    this.clientEvents.onAvatarEnteredRegion.next(av);
                }
                else {
                    agent.processObjectUpdate(obj);
                }
            }
            else {
                const agent = this.agent.currentRegion.agents.get(avatarID);
                if (agent !== undefined) {
                    agent.processObjectUpdate(obj);
                }
                else {
                    console.warn('Received update for unknown avatar, but not a new object?!');
                }
            }
        }
        const parentObj = this.objects.get(obj.ParentID ?? 0);
        if (obj.ParentID === 0 || (obj.ParentID !== undefined && parentObj !== undefined && parentObj.PCode === PCode_1.PCode.Avatar)) {
            if (newObject) {
                if (obj.IsAttachment && obj.ParentID !== undefined) {
                    if (parentObj !== undefined && parentObj.PCode === PCode_1.PCode.Avatar) {
                        const avatar = this.agent.currentRegion.agents.get(parentObj.FullID.toString());
                        let invItemID = UUID_1.UUID.zero();
                        const attach = obj.NameValue.get('AttachItemID');
                        if (attach) {
                            invItemID = new UUID_1.UUID(attach.value);
                        }
                        this.agent.currentRegion.clientCommands.region.resolveObject(obj, {}).then(() => {
                            try {
                                if (obj.itemID === undefined) {
                                    obj.itemID = UUID_1.UUID.zero();
                                }
                                obj.itemID = invItemID;
                                if (avatar !== undefined) {
                                    avatar.addAttachment(obj);
                                }
                            }
                            catch (err) {
                                console.error(err);
                            }
                        }).catch(() => {
                            console.error('Failed to resolve new avatar attachment');
                        });
                    }
                }
                const newObj = new NewObjectEvent_1.NewObjectEvent();
                newObj.localID = obj.ID;
                newObj.objectID = obj.FullID;
                newObj.object = obj;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
                newObj.createSelected = obj.Flags !== undefined && (obj.Flags & PrimFlags_1.PrimFlags.CreateSelected) === PrimFlags_1.PrimFlags.CreateSelected;
                obj.createdSelected = newObj.createSelected;
                // noinspection JSBitwiseOperatorUsage
                if (obj.Flags !== undefined && obj.Flags & PrimFlags_1.PrimFlags.CreateSelected && !this.pendingObjectProperties.get(obj.FullID.toString())) {
                    this.selectedPrimsWithoutUpdate.set(obj.ID, true);
                }
                this.clientEvents.onNewObjectEvent.next(newObj);
            }
            else {
                const updObj = new ObjectUpdatedEvent_1.ObjectUpdatedEvent();
                updObj.localID = obj.ID;
                updObj.objectID = obj.FullID;
                updObj.object = obj;
                this.clientEvents.onObjectUpdatedEvent.next(updObj);
            }
            const pendingProp = this.pendingObjectProperties.get(obj.FullID.toString());
            if (pendingProp) {
                this.applyObjectProperties(obj, pendingProp);
                this.pendingObjectProperties.delete(obj.FullID.toString());
            }
        }
    }
    objectUpdateCached(objectUpdateCached) {
        if (this.circuit === undefined) {
            return;
        }
        const rmo = new RequestMultipleObjects_1.RequestMultipleObjectsMessage();
        rmo.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        rmo.ObjectData = [];
        for (const obj of objectUpdateCached.ObjectData) {
            rmo.ObjectData.push({
                CacheMissType: 0,
                ID: obj.ID
            });
        }
        this.circuit.sendMessage(rmo, 0);
    }
    objectUpdateCompressed(objectUpdateCompressed) {
        for (const obj of objectUpdateCompressed.ObjectData) {
            const buf = obj.Data;
            let pos = 0;
            const fullID = new UUID_1.UUID(buf, pos);
            pos += 16;
            const localID = buf.readUInt32LE(pos);
            pos += 4;
            const pcode = buf.readUInt8(pos++);
            const newObj = false;
            let o = this.objects.get(localID);
            if (!o) {
                o = new GameObject_1.GameObject();
                o.region = this.agent.currentRegion;
                this.objects.set(localID, o);
            }
            o.deleted = false;
            o.ID = localID;
            o.PCode = pcode;
            this.objectsByUUID.set(fullID.toString(), localID);
            o.FullID = fullID;
            pos++;
            pos = pos + 42;
            const compressedflags = buf.readUInt32LE(pos);
            pos = pos + 4;
            o.OwnerID = new UUID_1.UUID(buf, pos);
            pos += 16;
            if (compressedflags & CompressedFlags_1.CompressedFlags.HasAngularVelocity) {
                pos = pos + 12;
            }
            let newParentID = 0;
            if (compressedflags & CompressedFlags_1.CompressedFlags.HasParent) {
                newParentID = buf.readUInt32LE(pos);
                pos += 4;
            }
            o.ParentID = newParentID;
            let add = true;
            if (!newObj && o.ParentID !== undefined) {
                const p = this.objectsByParent.get(o.ParentID);
                if (newParentID !== o.ParentID && p) {
                    const ind = p.indexOf(localID);
                    if (ind !== -1) {
                        p.splice(ind, 1);
                    }
                }
                else if (p) {
                    add = false;
                }
            }
            if (add) {
                let objByParent = this.objectsByParent.get(newParentID);
                if (!objByParent) {
                    objByParent = [];
                    this.objectsByParent.set(newParentID, objByParent);
                }
                objByParent.push(localID);
            }
            if (pcode !== PCode_1.PCode.Avatar && newObj && this.options & BotOptionFlags_1.BotOptionFlags.StoreMyAttachmentsOnly) {
                if (this.agent.localID !== 0 && o.ParentID !== this.agent.localID) {
                    // Drop object
                    this.deleteObject(localID);
                    return;
                }
            }
            if (o.ParentID !== undefined && o.ParentID !== 0 && !this.objects.has(o.ParentID) && !o.IsAttachment) {
                if (this.fullStore) {
                    this.requestMissingObject(o.ParentID).catch((e) => {
                        console.error(e);
                    });
                }
            }
            if (compressedflags & CompressedFlags_1.CompressedFlags.Tree) {
                pos++;
            }
            else if (compressedflags & CompressedFlags_1.CompressedFlags.ScratchPad) {
                const scratchPadSize = buf.readUInt8(pos++);
                // Ignore this data
                pos = pos + scratchPadSize;
            }
            if (compressedflags & CompressedFlags_1.CompressedFlags.HasText) {
                // Read null terminated string
                const result = Utils_1.Utils.BufferToString(buf, pos);
                pos += result.readLength;
                pos = pos + 4;
            }
            if (compressedflags & CompressedFlags_1.CompressedFlags.MediaURL) {
                const result = Utils_1.Utils.BufferToString(buf, pos);
                pos += result.readLength;
            }
            if (compressedflags & CompressedFlags_1.CompressedFlags.HasParticles) {
                pos += 86;
            }
            // Extra params
            const extraParamsLength = ExtraParams_1.ExtraParams.getLengthOfParams(buf, pos);
            o.extraParams = ExtraParams_1.ExtraParams.from(buf.subarray(pos, pos + extraParamsLength));
            pos = pos + extraParamsLength;
            if (compressedflags & CompressedFlags_1.CompressedFlags.HasSound) {
                pos = pos + 25;
            }
            if (compressedflags & CompressedFlags_1.CompressedFlags.HasNameValues) {
                const result = Utils_1.Utils.BufferToString(buf, pos);
                o.NameValue = this.parseNameValues(result.result);
                pos += result.readLength;
            }
            pos++;
            pos = pos + 22;
            const textureEntryLength = buf.readUInt32LE(pos);
            pos = pos + 4;
            pos = pos + textureEntryLength;
            if (compressedflags & CompressedFlags_1.CompressedFlags.TextureAnimation) {
                pos = pos + 4;
            }
            o.IsAttachment = (compressedflags & CompressedFlags_1.CompressedFlags.HasNameValues) !== 0 && o.ParentID !== 0;
            if (o.IsAttachment && o.State !== undefined) {
                o.attachmentPoint = this.decodeAttachPoint(o.State);
            }
            this.notifyObjectUpdate(newObj, o);
        }
    }
    decodeAttachPoint(state) {
        const mask = 0xf << 4 >>> 0;
        return (((state & mask) >>> 4) | ((state & ~mask) << 4)) >>> 0;
    }
    objectUpdateTerse(_objectUpdateTerse) {
        // Not implemented
    }
    killObject(killObj) {
        for (const obj of killObj.ObjectData) {
            const objectID = obj.ID;
            if (this.objects.has(objectID)) {
                this.deleteObject(objectID);
            }
        }
    }
    findParent(go) {
        const parentObj = this.objects.get(go.ParentID ?? 0);
        if (go.ParentID !== undefined && go.ParentID !== 0 && parentObj) {
            return this.findParent(parentObj);
        }
        else {
            if (go.ParentID !== undefined && go.ParentID !== 0 && !parentObj && !go.IsAttachment) {
                if (this.fullStore) {
                    this.requestMissingObject(go.ParentID).catch((e) => {
                        Logger_1.Logger.Error(e);
                    });
                }
            }
            return go;
        }
    }
}
exports.ObjectStoreLite = ObjectStoreLite;
//# sourceMappingURL=ObjectStoreLite.js.map