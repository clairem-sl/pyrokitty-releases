"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectStoreFull = void 0;
const RequestMultipleObjects_1 = require("./messages/RequestMultipleObjects");
const UUID_1 = require("./UUID");
const Quaternion_1 = require("./Quaternion");
const Vector3_1 = require("./Vector3");
const Utils_1 = require("./Utils");
const dist_1 = require("rbush-3d/dist");
const Vector4_1 = require("./Vector4");
const TextureEntry_1 = require("./TextureEntry");
const Color4_1 = require("./Color4");
const ParticleSystem_1 = require("./ParticleSystem");
const GameObject_1 = require("./public/GameObject");
const ObjectStoreLite_1 = require("./ObjectStoreLite");
const TextureAnim_1 = require("./public/TextureAnim");
const ExtraParams_1 = require("./public/ExtraParams");
const CompressedFlags_1 = require("../enums/CompressedFlags");
const PCode_1 = require("../enums/PCode");
const BotOptionFlags_1 = require("../enums/BotOptionFlags");
class ObjectStoreFull extends ObjectStoreLite_1.ObjectStoreLite {
    rtree;
    constructor(circuit, agent, clientEvents, options) {
        super(circuit, agent, clientEvents, options);
        this.rtree = new dist_1.RBush3D();
        this.fullStore = true;
    }
    objectUpdate(objectUpdate) {
        for (const objData of objectUpdate.ObjectData) {
            const localID = objData.ID;
            const parentID = objData.ParentID;
            let addToParentList = true;
            let newObject = false;
            let obj = this.objects.get(localID);
            if (obj) {
                const objsByParent = this.objectsByParent.get(parentID ?? 0);
                if (obj.ParentID !== parentID && objsByParent) {
                    const ind = objsByParent.indexOf(localID);
                    if (ind !== -1) {
                        objsByParent.splice(ind, 1);
                    }
                }
                else if (objsByParent) {
                    addToParentList = false;
                }
            }
            else {
                newObject = true;
                obj = new GameObject_1.GameObject();
                obj.region = this.agent.currentRegion;
                this.objects.set(localID, obj);
            }
            obj.deleted = false;
            obj.ID = objData.ID;
            obj.State = objData.State;
            obj.FullID = objData.FullID;
            obj.CRC = objData.CRC;
            obj.PCode = objData.PCode;
            obj.Material = objData.Material;
            obj.ClickAction = objData.ClickAction;
            obj.Scale = objData.Scale;
            obj.setObjectData(objData.ObjectData);
            obj.ParentID = objData.ParentID;
            obj.Flags = objData.UpdateFlags;
            obj.PathCurve = objData.PathCurve;
            obj.ProfileCurve = objData.ProfileCurve;
            obj.PathBegin = Utils_1.Utils.unpackBeginCut(objData.PathBegin);
            obj.PathEnd = Utils_1.Utils.unpackEndCut(objData.PathEnd);
            obj.PathScaleX = Utils_1.Utils.unpackPathScale(objData.PathScaleX);
            obj.PathScaleY = Utils_1.Utils.unpackPathScale(objData.PathScaleY);
            obj.PathShearX = Utils_1.Utils.unpackPathShear(objData.PathShearX);
            obj.PathShearY = Utils_1.Utils.unpackPathShear(objData.PathShearY);
            obj.PathTwist = Utils_1.Utils.unpackPathTwist(objData.PathTwist);
            obj.PathTwistBegin = Utils_1.Utils.unpackPathTwist(objData.PathTwistBegin);
            obj.PathRadiusOffset = Utils_1.Utils.unpackPathTwist(objData.PathRadiusOffset);
            obj.PathTaperX = Utils_1.Utils.unpackPathTaper(objData.PathTaperX);
            obj.PathTaperY = Utils_1.Utils.unpackPathTaper(objData.PathTaperY);
            obj.PathRevolutions = Utils_1.Utils.unpackPathRevolutions(objData.PathRevolutions);
            obj.PathSkew = Utils_1.Utils.unpackPathTwist(objData.PathSkew);
            obj.ProfileBegin = Utils_1.Utils.unpackBeginCut(objData.ProfileBegin);
            obj.ProfileEnd = Utils_1.Utils.unpackEndCut(objData.ProfileEnd);
            obj.ProfileHollow = Utils_1.Utils.unpackProfileHollow(objData.ProfileHollow);
            if (obj.TextureEntry?.gltfMaterialOverrides && !this.cachedMaterialOverrides.has(obj.ID)) {
                this.cachedMaterialOverrides.set(obj.ID, obj.TextureEntry.gltfMaterialOverrides);
            }
            if (obj.FullID.toString() === '1efb961a-0c5e-0ea5-84c7-68da50ae2659') {
                console.log('Whoopie');
            }
            obj.TextureEntry = TextureEntry_1.TextureEntry.from(objData.TextureEntry);
            const override = this.cachedMaterialOverrides.get(obj.ID);
            if (override) {
                obj.TextureEntry.gltfMaterialOverrides = override;
                this.cachedMaterialOverrides.delete(obj.ID);
            }
            obj.textureAnim = TextureAnim_1.TextureAnim.from(objData.TextureAnim);
            const pcodeData = objData.Data;
            obj.Text = Utils_1.Utils.BufferToStringSimple(objData.Text);
            obj.TextColor = new Color4_1.Color4(objData.TextColor, 0, false, true);
            obj.MediaURL = Utils_1.Utils.BufferToStringSimple(objData.MediaURL);
            obj.Particles = ParticleSystem_1.ParticleSystem.from(objData.PSBlock);
            obj.Sound = objData.Sound;
            obj.OwnerID = objData.OwnerID;
            obj.SoundGain = objData.Gain;
            obj.SoundFlags = objData.Flags;
            obj.SoundRadius = objData.Radius;
            obj.JointType = objData.JointType;
            obj.JointPivot = objData.JointPivot;
            obj.JointAxisOrAnchor = objData.JointAxisOrAnchor;
            switch (obj.PCode) {
                case PCode_1.PCode.Grass:
                case PCode_1.PCode.Tree:
                case PCode_1.PCode.NewTree:
                    if (pcodeData.length === 1) {
                        obj.TreeSpecies = pcodeData[0];
                    }
                    break;
                default:
                    break;
            }
            if (obj.PCode === PCode_1.PCode.Avatar && obj.FullID.toString() === this.agent.agentID.toString()) {
                this.agent.localID = localID;
                if (this.options & BotOptionFlags_1.BotOptionFlags.StoreMyAttachmentsOnly) {
                    for (const objParentID of this.objectsByParent.keys()) {
                        const parent = objParentID;
                        if (parent !== this.agent.localID) {
                            let foundAvatars = false;
                            const objsByParent = this.objectsByParent.get(parent);
                            if (objsByParent) {
                                for (const objID of objsByParent) {
                                    const ob = this.objects.get(objID);
                                    if (ob && ob.PCode === PCode_1.PCode.Avatar) {
                                        foundAvatars = true;
                                    }
                                }
                                const o = this.objects.get(parent);
                                if (o && o.PCode === PCode_1.PCode.Avatar) {
                                    foundAvatars = true;
                                }
                                if (!foundAvatars) {
                                    this.deleteObject(parent);
                                }
                            }
                        }
                    }
                }
            }
            obj.extraParams = ExtraParams_1.ExtraParams.from(objData.ExtraParams);
            obj.NameValue = this.parseNameValues(Utils_1.Utils.BufferToStringSimple(objData.NameValue));
            obj.IsAttachment = obj.NameValue.get('AttachItemID') !== undefined;
            if (obj.IsAttachment && obj.State !== undefined) {
                obj.attachmentPoint = this.decodeAttachPoint(obj.State);
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
            if (objData.PCode !== PCode_1.PCode.Avatar && this.options & BotOptionFlags_1.BotOptionFlags.StoreMyAttachmentsOnly && (this.agent.localID !== 0 && obj.ParentID !== this.agent.localID)) {
                // Drop object
                this.deleteObject(localID);
            }
            else {
                this.insertIntoRtree(obj);
                const parentObj = this.objects.get(objData.ParentID ?? 0);
                if (objData.ParentID !== undefined && objData.ParentID !== 0 && !parentObj && !obj.IsAttachment) {
                    void this.requestMissingObject(objData.ParentID);
                }
                this.notifyObjectUpdate(newObject, obj);
                obj.onTextureUpdate.next();
            }
        }
    }
    objectUpdateCached(objectUpdateCached) {
        if (!this.circuit) {
            return;
        }
        const rmo = new RequestMultipleObjects_1.RequestMultipleObjectsMessage();
        rmo.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        rmo.ObjectData = [];
        for (const obj of objectUpdateCached.ObjectData) {
            if (!this.objects.has(obj.ID)) {
                rmo.ObjectData.push({
                    CacheMissType: 0,
                    ID: obj.ID
                });
            }
        }
        if (rmo.ObjectData.length > 0) {
            if (!this.circuit) {
                return;
            }
            this.circuit.sendMessage(rmo, 0);
        }
    }
    objectUpdateCompressed(objectUpdateCompressed) {
        for (const obj of objectUpdateCompressed.ObjectData) {
            const flags = obj.UpdateFlags;
            const buf = obj.Data;
            let pos = 0;
            const fullID = new UUID_1.UUID(buf, pos);
            pos += 16;
            const localID = buf.readUInt32LE(pos);
            pos += 4;
            const pcode = buf.readUInt8(pos++);
            let newObj = false;
            let o = this.objects.get(localID);
            if (!o) {
                newObj = true;
                o = new GameObject_1.GameObject();
                o.region = this.agent.currentRegion;
                this.objects.set(localID, o);
            }
            o.ID = localID;
            this.objectsByUUID.set(fullID.toString(), localID);
            o.FullID = fullID;
            o.Flags = flags;
            o.PCode = pcode;
            o.deleted = false;
            o.State = buf.readUInt8(pos++);
            o.CRC = buf.readUInt32LE(pos);
            pos = pos + 4;
            o.Material = buf.readUInt8(pos++);
            o.ClickAction = buf.readUInt8(pos++);
            o.Scale = new Vector3_1.Vector3(buf, pos, false);
            pos = pos + 12;
            o.Position = new Vector3_1.Vector3(buf, pos, false);
            pos = pos + 12;
            o.Rotation = new Quaternion_1.Quaternion(buf, pos);
            pos = pos + 12;
            const compressedflags = buf.readUInt32LE(pos);
            pos = pos + 4;
            o.OwnerID = new UUID_1.UUID(buf, pos);
            pos += 16;
            if (compressedflags & CompressedFlags_1.CompressedFlags.HasAngularVelocity) {
                o.AngularVelocity = new Vector3_1.Vector3(buf, pos, false);
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
                const obsByParent = this.objectsByParent.get(o.ParentID);
                if (newParentID !== o.ParentID && obsByParent) {
                    const index = obsByParent.indexOf(localID);
                    if (index !== -1) {
                        obsByParent.splice(index, 1);
                    }
                }
                else if (obsByParent) {
                    add = false;
                }
            }
            if (add) {
                let objsByNewParent = this.objectsByParent.get(newParentID);
                if (!objsByNewParent) {
                    objsByNewParent = [];
                    this.objectsByParent.set(newParentID, objsByNewParent);
                }
                objsByNewParent.push(localID);
            }
            if (pcode !== PCode_1.PCode.Avatar && newObj && this.options & BotOptionFlags_1.BotOptionFlags.StoreMyAttachmentsOnly && (this.agent.localID !== 0 && o.ParentID !== this.agent.localID)) {
                // Drop object
                this.deleteObject(localID);
                return;
            }
            else {
                if (o.ParentID !== undefined && o.ParentID !== 0 && !this.objects.has(o.ParentID) && !o.IsAttachment) {
                    this.requestMissingObject(o.ParentID).catch((e) => {
                        console.error(e);
                    });
                }
                if (compressedflags & CompressedFlags_1.CompressedFlags.Tree) {
                    o.TreeSpecies = buf.readUInt8(pos++);
                }
                else if (compressedflags & CompressedFlags_1.CompressedFlags.ScratchPad) {
                    o.TreeSpecies = 0;
                    const scratchPadSize = buf.readUInt8(pos++);
                    // Ignore this data
                    pos = pos + scratchPadSize;
                }
                if (compressedflags & CompressedFlags_1.CompressedFlags.HasText) {
                    // Read null terminated string
                    const result = Utils_1.Utils.BufferToString(buf, pos);
                    pos += result.readLength;
                    o.Text = result.result;
                    o.TextColor = new Color4_1.Color4(buf, pos, false, true);
                    pos = pos + 4;
                }
                else {
                    o.Text = '';
                }
                if (compressedflags & CompressedFlags_1.CompressedFlags.MediaURL) {
                    const result = Utils_1.Utils.BufferToString(buf, pos);
                    pos += result.readLength;
                    o.MediaURL = result.result;
                }
                if (compressedflags & CompressedFlags_1.CompressedFlags.HasParticles) {
                    o.Particles = ParticleSystem_1.ParticleSystem.from(buf.subarray(pos, pos + 86));
                    pos += 86;
                }
                // Extra params
                const extraParamsLength = ExtraParams_1.ExtraParams.getLengthOfParams(buf, pos);
                o.extraParams = ExtraParams_1.ExtraParams.from(buf.subarray(pos, pos + extraParamsLength));
                pos += extraParamsLength;
                if (compressedflags & CompressedFlags_1.CompressedFlags.HasSound) {
                    o.Sound = new UUID_1.UUID(buf, pos);
                    pos = pos + 16;
                    o.SoundGain = buf.readFloatLE(pos);
                    pos += 4;
                    o.SoundFlags = buf.readUInt8(pos++);
                    o.SoundRadius = buf.readFloatLE(pos);
                    pos = pos + 4;
                }
                if (compressedflags & CompressedFlags_1.CompressedFlags.HasNameValues) {
                    const result = Utils_1.Utils.BufferToString(buf, pos);
                    o.NameValue = this.parseNameValues(result.result);
                    pos += result.readLength;
                }
                o.PathCurve = buf.readUInt8(pos++);
                o.PathBegin = Utils_1.Utils.unpackBeginCut(buf.readUInt16LE(pos));
                pos = pos + 2;
                o.PathEnd = Utils_1.Utils.unpackEndCut(buf.readUInt16LE(pos));
                pos = pos + 2;
                o.PathScaleX = Utils_1.Utils.unpackPathScale(buf.readUInt8(pos++));
                o.PathScaleY = Utils_1.Utils.unpackPathScale(buf.readUInt8(pos++));
                o.PathShearX = Utils_1.Utils.unpackPathShear(buf.readUInt8(pos++));
                o.PathShearY = Utils_1.Utils.unpackPathShear(buf.readUInt8(pos++));
                o.PathTwist = Utils_1.Utils.unpackPathTwist(buf.readUInt8(pos++));
                o.PathTwistBegin = Utils_1.Utils.unpackPathTwist(buf.readUInt8(pos++));
                o.PathRadiusOffset = Utils_1.Utils.unpackPathTwist(buf.readUInt8(pos++));
                o.PathTaperX = Utils_1.Utils.unpackPathTaper(buf.readUInt8(pos++));
                o.PathTaperY = Utils_1.Utils.unpackPathTaper(buf.readUInt8(pos++));
                o.PathRevolutions = Utils_1.Utils.unpackPathRevolutions(buf.readUInt8(pos++));
                o.PathSkew = Utils_1.Utils.unpackPathTwist(buf.readUInt8(pos++));
                o.ProfileCurve = buf.readUInt8(pos++);
                o.ProfileBegin = Utils_1.Utils.unpackBeginCut(buf.readUInt16LE(pos));
                pos = pos + 2;
                o.ProfileEnd = Utils_1.Utils.unpackEndCut(buf.readUInt16LE(pos));
                pos = pos + 2;
                o.ProfileHollow = Utils_1.Utils.unpackProfileHollow(buf.readUInt16LE(pos));
                pos = pos + 2;
                const textureEntryLength = buf.readUInt32LE(pos);
                pos = pos + 4;
                if (o.TextureEntry?.gltfMaterialOverrides && !this.cachedMaterialOverrides.has(o.ID)) {
                    this.cachedMaterialOverrides.set(o.ID, o.TextureEntry.gltfMaterialOverrides);
                }
                o.TextureEntry = TextureEntry_1.TextureEntry.from(buf.subarray(pos, pos + textureEntryLength));
                const override = this.cachedMaterialOverrides.get(o.ID);
                if (override) {
                    o.TextureEntry.gltfMaterialOverrides = override;
                    this.cachedMaterialOverrides.delete(o.ID);
                }
                pos = pos + textureEntryLength;
                if (compressedflags & CompressedFlags_1.CompressedFlags.TextureAnimation) {
                    const textureAnimLength = buf.readUInt32LE(pos);
                    pos = pos + 4;
                    o.textureAnim = TextureAnim_1.TextureAnim.from(buf.subarray(pos, pos + textureAnimLength));
                }
                o.IsAttachment = (compressedflags & CompressedFlags_1.CompressedFlags.HasNameValues) !== 0 && o.ParentID !== 0;
                if (o.IsAttachment && o.State !== undefined) {
                    o.attachmentPoint = this.decodeAttachPoint(o.State);
                }
                this.insertIntoRtree(o);
                this.notifyObjectUpdate(newObj, o);
                o.onTextureUpdate.next();
            }
        }
    }
    objectUpdateTerse(objectUpdateTerse) {
        const dilation = objectUpdateTerse.RegionData.TimeDilation / 65535.0;
        this.clientEvents.onRegionTimeDilation.next(dilation);
        for (const objectData of objectUpdateTerse.ObjectData) {
            if (!(this.options & BotOptionFlags_1.BotOptionFlags.StoreMyAttachmentsOnly)) {
                let pos = 0;
                const localID = objectData.Data.readUInt32LE(pos);
                pos = pos + 4;
                const o = this.objects.get(localID);
                if (o) {
                    o.State = objectData.Data.readUInt8(pos++);
                    const avatar = (objectData.Data.readUInt8(pos++) !== 0);
                    if (avatar) {
                        o.CollisionPlane = new Vector4_1.Vector4(objectData.Data, pos);
                        pos += 16;
                    }
                    o.Position = new Vector3_1.Vector3(objectData.Data, pos);
                    pos += 12;
                    o.Velocity = new Vector3_1.Vector3([
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos), -128.0, 128.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 2), -128.0, 128.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 4), -128.0, 128.0)
                    ]);
                    pos += 6;
                    o.Acceleration = new Vector3_1.Vector3([
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos), -64.0, 64.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 2), -64.0, 64.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 4), -64.0, 64.0)
                    ]);
                    pos += 6;
                    o.Rotation = new Quaternion_1.Quaternion([
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos), -1.0, 1.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 2), -1.0, 1.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 4), -1.0, 1.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 6), -1.0, 1.0)
                    ]);
                    pos += 8;
                    o.AngularVelocity = new Vector3_1.Vector3([
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos), -64.0, 64.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 2), -64.0, 64.0),
                        Utils_1.Utils.UInt16ToFloat(objectData.Data.readUInt16LE(pos + 4), -64.0, 64.0)
                    ]);
                    pos += 6;
                    if (objectData.TextureEntry.length > 0) {
                        // No idea why the first four bytes are skipped here.
                        if (o.TextureEntry?.gltfMaterialOverrides && !this.cachedMaterialOverrides.has(o.ID)) {
                            this.cachedMaterialOverrides.set(o.ID, o.TextureEntry.gltfMaterialOverrides);
                        }
                        o.TextureEntry = TextureEntry_1.TextureEntry.from(objectData.TextureEntry.subarray(4));
                        const override = this.cachedMaterialOverrides.get(o.ID);
                        if (override) {
                            o.TextureEntry.gltfMaterialOverrides = override;
                            this.cachedMaterialOverrides.delete(o.ID);
                        }
                        o.onTextureUpdate.next();
                    }
                    this.insertIntoRtree(o);
                    this.notifyTerseUpdate(o);
                }
                else {
                    // We don't know about this object, so request it
                    void this.requestMissingObject(localID);
                }
            }
        }
    }
}
exports.ObjectStoreFull = ObjectStoreFull;
//# sourceMappingURL=ObjectStoreFull.js.map