"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMesh = void 0;
const UUID_1 = require("../UUID");
const Vector3_1 = require("../Vector3");
const Vector2_1 = require("../Vector2");
const Utils_1 = require("../Utils");
const buffer_1 = require("buffer");
const LLSD_1 = require("../llsd/LLSD");
const LLSDMap_1 = require("../llsd/LLSDMap");
const LLSDInteger_1 = require("../llsd/LLSDInteger");
const LLSDReal_1 = require("../llsd/LLSDReal");
const Matrix4_1 = require("../Matrix4");
class LLMesh {
    version;
    lodLevels = {};
    physicsConvex;
    physicsHavok;
    skin;
    creatorID;
    date;
    costData;
    submodel_id;
    static async from(buf) {
        const llmesh = new LLMesh();
        const metadata = {
            readPos: 0
        };
        const obj = LLSD_1.LLSD.parseBinary(buf, metadata);
        if (!(obj instanceof LLSDMap_1.LLSDMap)) {
            throw new Error('Invalid mesh');
        }
        for (const key of obj.keys()) {
            switch (key) {
                case 'creator':
                    {
                        const u = obj[key];
                        if (u instanceof UUID_1.UUID) {
                            llmesh.creatorID = u;
                        }
                        break;
                    }
                case 'version':
                    {
                        const int = obj[key];
                        if (int instanceof LLSDInteger_1.LLSDInteger) {
                            llmesh.version = int.valueOf();
                        }
                        break;
                    }
                case 'submodel_id':
                    {
                        const int = obj[key];
                        if (int instanceof LLSDInteger_1.LLSDInteger) {
                            llmesh.submodel_id = int.valueOf();
                        }
                        break;
                    }
                case 'date':
                    {
                        const dt = obj[key];
                        if (dt instanceof Date) {
                            llmesh.date = dt;
                        }
                        break;
                    }
                case 'physics_cost_data':
                    {
                        const map = obj[key];
                        if (map instanceof LLSDMap_1.LLSDMap) {
                            llmesh.costData = {
                                hull: 0,
                                hull_discounted_vertices: 0,
                                mesh: [],
                                mesh_triangles: 0
                            };
                            if (map.hull instanceof LLSDReal_1.LLSDReal) {
                                llmesh.costData.hull = map.hull.valueOf();
                            }
                            if (map.hull_discounted_vertices instanceof LLSDInteger_1.LLSDInteger) {
                                llmesh.costData.hull_discounted_vertices = map.hull_discounted_vertices.valueOf();
                            }
                            if (Array.isArray(map.mesh)) {
                                for (const num of map.mesh) {
                                    if (num instanceof LLSDReal_1.LLSDReal) {
                                        llmesh.costData.mesh.push(num.valueOf());
                                    }
                                }
                            }
                            if (map.mesh_triangles instanceof LLSDInteger_1.LLSDInteger) {
                                llmesh.costData.mesh_triangles = map.mesh_triangles.valueOf();
                            }
                        }
                        break;
                    }
                case 'physics_shape':
                case 'physics_mesh':
                case 'high_lod':
                case 'medium_lod':
                case 'low_lod':
                case 'lowest_lod':
                case 'physics_convex':
                case 'physics_havok':
                case 'skin':
                    {
                        const skin = obj[key];
                        if (skin instanceof LLSDMap_1.LLSDMap) {
                            const hash = skin.get('hash');
                            const offset = skin.get('offset');
                            const size = skin.get('size');
                            if (offset instanceof LLSDInteger_1.LLSDInteger && size instanceof LLSDInteger_1.LLSDInteger) {
                                const offsetVal = offset.valueOf();
                                const sizeVal = size.valueOf();
                                const startPos = metadata.readPos + offsetVal;
                                const endPos = offsetVal + sizeVal + metadata.readPos;
                                const bufSlice = buf.subarray(startPos, endPos);
                                if (hash instanceof buffer_1.Buffer) {
                                    const inflatedHash = Utils_1.Utils.MD5String(bufSlice);
                                    if (inflatedHash !== hash.toString('hex')) {
                                        throw new Error('Hash mismatch');
                                    }
                                }
                                const inflated = await Utils_1.Utils.inflate(bufSlice);
                                const parsed = LLSD_1.LLSD.parseBinary(inflated);
                                if (key === 'physics_havok') {
                                    if (parsed instanceof LLSDMap_1.LLSDMap) {
                                        llmesh.physicsHavok = {
                                            weldingData: buffer_1.Buffer.alloc(0),
                                            hullMassProps: {
                                                CoM: [],
                                                inertia: [],
                                                mass: 0,
                                                volume: 0
                                            },
                                            meshDecompMassProps: {
                                                CoM: [],
                                                inertia: [],
                                                mass: 0,
                                                volume: 0
                                            }
                                        };
                                        if (parsed.HullMassProps instanceof LLSDMap_1.LLSDMap) {
                                            if (Array.isArray(parsed.HullMassProps.CoM)) {
                                                for (const num of parsed.HullMassProps.CoM) {
                                                    if (num instanceof LLSDReal_1.LLSDReal) {
                                                        llmesh.physicsHavok.hullMassProps.CoM.push(num.valueOf());
                                                    }
                                                }
                                            }
                                            if (Array.isArray(parsed.HullMassProps.inertia)) {
                                                for (const num of parsed.HullMassProps.inertia) {
                                                    if (num instanceof LLSDReal_1.LLSDReal) {
                                                        llmesh.physicsHavok.hullMassProps.inertia.push(num.valueOf());
                                                    }
                                                }
                                            }
                                            if (parsed.HullMassProps.mass instanceof LLSDReal_1.LLSDReal) {
                                                llmesh.physicsHavok.hullMassProps.mass = parsed.HullMassProps.mass.valueOf();
                                            }
                                            if (parsed.HullMassProps.volume instanceof LLSDReal_1.LLSDReal) {
                                                llmesh.physicsHavok.hullMassProps.volume = parsed.HullMassProps.volume.valueOf();
                                            }
                                        }
                                        if (parsed.MeshDecompMassProps instanceof LLSDMap_1.LLSDMap) {
                                            if (Array.isArray(parsed.MeshDecompMassProps.CoM)) {
                                                for (const num of parsed.MeshDecompMassProps.CoM) {
                                                    if (num instanceof LLSDReal_1.LLSDReal) {
                                                        llmesh.physicsHavok.meshDecompMassProps.CoM.push(num.valueOf());
                                                    }
                                                }
                                            }
                                            if (Array.isArray(parsed.MeshDecompMassProps.inertia)) {
                                                for (const num of parsed.MeshDecompMassProps.inertia) {
                                                    if (num instanceof LLSDReal_1.LLSDReal) {
                                                        llmesh.physicsHavok.meshDecompMassProps.inertia.push(num.valueOf());
                                                    }
                                                }
                                            }
                                            if (parsed.MeshDecompMassProps.mass instanceof LLSDReal_1.LLSDReal) {
                                                llmesh.physicsHavok.meshDecompMassProps.mass = parsed.MeshDecompMassProps.mass.valueOf();
                                            }
                                            if (parsed.MeshDecompMassProps.volume instanceof LLSDReal_1.LLSDReal) {
                                                llmesh.physicsHavok.meshDecompMassProps.volume = parsed.MeshDecompMassProps.volume.valueOf();
                                            }
                                        }
                                        if (parsed.WeldingData instanceof buffer_1.Buffer) {
                                            llmesh.physicsHavok.weldingData = parsed.WeldingData;
                                        }
                                    }
                                }
                                else if (key === 'skin') {
                                    if (parsed instanceof LLSDMap_1.LLSDMap) {
                                        llmesh.skin = this.parseSkin(parsed);
                                    }
                                }
                                else if (key === 'physics_convex') {
                                    if (parsed instanceof LLSDMap_1.LLSDMap) {
                                        llmesh.physicsConvex = this.parsePhysicsConvex(parsed);
                                    }
                                }
                                else {
                                    if (Array.isArray(parsed)) {
                                        const subMeshes = [];
                                        for (const sm of parsed) {
                                            if (sm instanceof LLSDMap_1.LLSDMap) {
                                                subMeshes.push(sm);
                                            }
                                        }
                                        llmesh.lodLevels[key] = this.parseLODLevel(subMeshes);
                                    }
                                }
                            }
                        }
                        break;
                    }
                default:
                    {
                        console.warn('Unrecognised mesh property: ' + key);
                    }
            }
        }
        return llmesh;
    }
    async toAsset() {
        const llsd = new LLSDMap_1.LLSDMap();
        if (this.creatorID) {
            llsd.add('creator', this.creatorID);
        }
        if (this.version !== undefined) {
            llsd.add('version', new LLSDInteger_1.LLSDInteger(this.version));
        }
        if (this.submodel_id !== undefined) {
            llsd.add('submodel_id', new LLSDInteger_1.LLSDInteger(this.submodel_id));
        }
        if (this.date !== undefined) {
            llsd.add('date', this.date);
        }
        let offset = 0;
        const bufs = [];
        for (const lod of Object.keys(this.lodLevels)) {
            const lodBlob = await this.encodeLODLevel(lod, this.lodLevels[lod]);
            llsd.add(lod, new LLSDMap_1.LLSDMap([
                ['offset', new LLSDInteger_1.LLSDInteger(offset)],
                ['size', new LLSDInteger_1.LLSDInteger(lodBlob.length)]
            ]));
            offset += lodBlob.length;
            bufs.push(lodBlob);
        }
        if (this.costData) {
            llsd.add('physics_cost_data', new LLSDMap_1.LLSDMap([
                ['hull', new LLSDReal_1.LLSDReal(this.costData.hull)],
                ['hull_discounted_vertices', new LLSDInteger_1.LLSDInteger(this.costData.hull_discounted_vertices)],
                ['mesh', LLMesh.toLLSDReal(this.costData.mesh)],
                ['mesh_triangles', new LLSDInteger_1.LLSDInteger(this.costData.mesh_triangles)]
            ]));
        }
        if (this.physicsHavok) {
            const physHavok = await this.encodePhysicsHavok();
            llsd.add('physics_havok', new LLSDMap_1.LLSDMap([
                ['offset', new LLSDInteger_1.LLSDInteger(offset)],
                ['size', new LLSDInteger_1.LLSDInteger(physHavok.length)]
            ]));
            offset += physHavok.length;
            bufs.push(physHavok);
        }
        if (this.physicsConvex) {
            const physBlob = await this.encodePhysicsConvex(this.physicsConvex);
            llsd.add('physics_convex', new LLSDMap_1.LLSDMap([
                ['offset', new LLSDInteger_1.LLSDInteger(offset)],
                ['size', new LLSDInteger_1.LLSDInteger(physBlob.length)]
            ]));
            offset += physBlob.length;
            bufs.push(physBlob);
        }
        if (this.skin) {
            const skinBlob = await this.encodeSkin(this.skin);
            llsd.add('skin', new LLSDMap_1.LLSDMap([
                ['offset', new LLSDInteger_1.LLSDInteger(offset)],
                ['size', new LLSDInteger_1.LLSDInteger(skinBlob.length)]
            ]));
            bufs.push(skinBlob);
        }
        bufs.unshift(LLSD_1.LLSD.toBinary(llsd));
        return buffer_1.Buffer.concat(bufs);
    }
    static parseSkin(mesh) {
        const skin = {
            jointNames: [],
            bindShapeMatrix: new Matrix4_1.Matrix4(),
            inverseBindMatrix: []
        };
        if (Array.isArray(mesh.joint_names)) {
            for (const joint of mesh.joint_names) {
                if (typeof joint === 'string') {
                    skin.jointNames.push(joint);
                }
            }
        }
        if (Array.isArray(mesh.bind_shape_matrix)) {
            const params = [];
            for (const num of mesh.bind_shape_matrix) {
                if (num instanceof LLSDReal_1.LLSDReal) {
                    params.push(num.valueOf());
                }
            }
            skin.bindShapeMatrix = new Matrix4_1.Matrix4(params);
        }
        if (Array.isArray(mesh.inverse_bind_matrix)) {
            skin.inverseBindMatrix = [];
            for (const inv of mesh.inverse_bind_matrix) {
                const mtrx = [];
                if (Array.isArray(inv)) {
                    for (const num of inv) {
                        if (num instanceof LLSDReal_1.LLSDReal) {
                            mtrx.push(num.valueOf());
                        }
                    }
                }
                skin.inverseBindMatrix.push(new Matrix4_1.Matrix4(mtrx));
            }
        }
        if (Array.isArray(mesh.alt_inverse_bind_matrix)) {
            skin.altInverseBindMatrix = [];
            for (const inv of mesh.alt_inverse_bind_matrix) {
                const mtrx = [];
                if (Array.isArray(inv)) {
                    for (const num of inv) {
                        if (num instanceof LLSDReal_1.LLSDReal) {
                            mtrx.push(num.valueOf());
                        }
                    }
                }
                skin.altInverseBindMatrix.push(new Matrix4_1.Matrix4(mtrx));
            }
        }
        if (Array.isArray(mesh.pelvis_offset)) {
            const mtrx = [];
            for (const num of mesh.pelvis_offset) {
                if (num instanceof LLSDReal_1.LLSDReal) {
                    mtrx.push(num.valueOf());
                }
            }
            skin.pelvisOffset = new Matrix4_1.Matrix4(mtrx);
        }
        return skin;
    }
    static fixReal(arr) {
        const newArr = [];
        for (let num of arr) {
            if ((num >> 0) === num && !((num === 0) && ((1 / num) === -Infinity))) {
                num += 0.0000000001;
            }
            newArr.push(num);
        }
        return newArr;
    }
    static fixRealLLSD(arr) {
        const newArr = [];
        for (let num of arr) {
            if ((num >> 0) === num && !((num === 0) && ((1 / num) === -Infinity))) {
                num += 0.0000000001;
            }
            newArr.push(new LLSDReal_1.LLSDReal(num));
        }
        return newArr;
    }
    static parsePhysicsConvex(mesh) {
        const conv = {
            boundingVerts: undefined,
            domain: {
                min: new Vector3_1.Vector3([-0.5, -0.5, -0.5]),
                max: new Vector3_1.Vector3([0.5, 0.5, 0.5])
            }
        };
        if (Array.isArray(mesh.Min)) {
            conv.domain.min.x = mesh.Min[0].valueOf();
            conv.domain.min.y = mesh.Min[1].valueOf();
            conv.domain.min.z = mesh.Min[2].valueOf();
        }
        if (Array.isArray(mesh.Max)) {
            conv.domain.max.x = mesh.Max[0].valueOf();
            conv.domain.max.y = mesh.Max[1].valueOf();
            conv.domain.max.z = mesh.Max[2].valueOf();
        }
        if (mesh.HullList instanceof buffer_1.Buffer) {
            if (!(mesh.Positions instanceof buffer_1.Buffer)) {
                throw new Error('Positions must be supplied if hull list is present');
            }
            conv.positions = this.decodeByteDomain3(mesh.Positions, conv.domain.min, conv.domain.max);
            conv.hullList = Array.from(mesh.HullList);
            let totalPoints = 0;
            for (const hull of conv.hullList) {
                totalPoints += hull;
            }
            if (conv.positions.length !== totalPoints) {
                throw new Error('Hull list expected number of points does not match number of positions: ' + totalPoints + ' vs ' + conv.positions.length);
            }
        }
        if (mesh.BoundingVerts instanceof buffer_1.Buffer) {
            conv.boundingVerts = this.decodeByteDomain3(mesh.BoundingVerts, conv.domain.min, conv.domain.max);
        }
        return conv;
    }
    static parseLODLevel(mesh) {
        const list = [];
        for (const submesh of mesh) {
            const decoded = {
                positionDomain: {
                    min: new Vector3_1.Vector3([-0.5, -0.5, -0.5]),
                    max: new Vector3_1.Vector3([0.5, 0.5, 0.5])
                }
            };
            if (submesh.NoGeometry !== undefined) {
                decoded.noGeometry = true;
                list.push(decoded);
            }
            else {
                decoded.position = [];
                if (!(submesh.Position instanceof buffer_1.Buffer)) {
                    throw new Error('Submesh does not contain position data');
                }
                if (decoded.positionDomain !== undefined) {
                    if (submesh.PositionDomain instanceof LLSDMap_1.LLSDMap) {
                        if (Array.isArray(submesh.PositionDomain.Max)) {
                            const dom = submesh.PositionDomain.Max;
                            if (dom[0] instanceof LLSDReal_1.LLSDReal) {
                                decoded.positionDomain.max.x = dom[0].valueOf();
                            }
                            if (dom[1] instanceof LLSDReal_1.LLSDReal) {
                                decoded.positionDomain.max.y = dom[1].valueOf();
                            }
                            if (dom[2] instanceof LLSDReal_1.LLSDReal) {
                                decoded.positionDomain.max.z = dom[2].valueOf();
                            }
                        }
                        if (Array.isArray(submesh.PositionDomain.Min)) {
                            const dom = submesh.PositionDomain.Min;
                            if (dom[0] instanceof LLSDReal_1.LLSDReal) {
                                decoded.positionDomain.min.x = dom[0].valueOf();
                            }
                            if (dom[1] instanceof LLSDReal_1.LLSDReal) {
                                decoded.positionDomain.min.y = dom[1].valueOf();
                            }
                            if (dom[2] instanceof LLSDReal_1.LLSDReal) {
                                decoded.positionDomain.min.z = dom[2].valueOf();
                            }
                        }
                    }
                    decoded.position = this.decodeByteDomain3(submesh.Position, decoded.positionDomain.min, decoded.positionDomain.max);
                }
                if (submesh.Normal instanceof buffer_1.Buffer) {
                    decoded.normal = this.decodeByteDomain3(submesh.Normal, new Vector3_1.Vector3([-1.0, -1.0, -1.0]), new Vector3_1.Vector3([1.0, 1.0, 1.0]));
                    if (decoded.normal.length !== decoded.position.length) {
                        throw new Error('Normal length does not match vertex position length');
                    }
                }
                if (submesh.TexCoord0 !== undefined) {
                    decoded.texCoord0Domain = {
                        min: new Vector2_1.Vector2([-0.5, -0.5]),
                        max: new Vector2_1.Vector2([0.5, 0.5])
                    };
                    if (submesh.TexCoord0Domain instanceof LLSDMap_1.LLSDMap) {
                        if (submesh.TexCoord0Domain.Max !== undefined) {
                            const dom = submesh.TexCoord0Domain.Max;
                            if (Array.isArray(dom)) {
                                if (dom[0] instanceof LLSDReal_1.LLSDReal) {
                                    decoded.texCoord0Domain.max.x = dom[0].valueOf();
                                }
                                else {
                                    throw new Error('Unexpected type');
                                }
                                if (dom[1] instanceof LLSDReal_1.LLSDReal) {
                                    decoded.texCoord0Domain.max.y = dom[1].valueOf();
                                }
                                else {
                                    throw new Error('Unexpected type');
                                }
                            }
                        }
                        if (Array.isArray(submesh.TexCoord0Domain.Min)) {
                            const dom = submesh.TexCoord0Domain.Min;
                            if (dom[0] instanceof LLSDReal_1.LLSDReal) {
                                decoded.texCoord0Domain.min.x = dom[0].valueOf();
                            }
                            else {
                                throw new Error('Unexpected type');
                            }
                            if (dom[1] instanceof LLSDReal_1.LLSDReal) {
                                decoded.texCoord0Domain.min.y = dom[1].valueOf();
                            }
                            else {
                                throw new Error('Unexpected type');
                            }
                        }
                    }
                    else {
                        throw new Error('TexCoord0Domain is required if Texcoord0 is present');
                    }
                    if (submesh.TexCoord0 instanceof buffer_1.Buffer) {
                        decoded.texCoord0 = this.decodeByteDomain2(submesh.TexCoord0, decoded.texCoord0Domain.min, decoded.texCoord0Domain.max);
                    }
                }
                if (!(submesh.TriangleList instanceof buffer_1.Buffer)) {
                    throw new Error('TriangleList is required');
                }
                const indexBuf = buffer_1.Buffer.from(submesh.TriangleList);
                decoded.triangleList = [];
                for (let pos = 0; pos < indexBuf.length; pos = pos + 2) {
                    const vertIndex = indexBuf.readUInt16LE(pos);
                    if (vertIndex >= decoded.position.length) {
                        throw new Error('Vertex index out of range: ' + vertIndex);
                    }
                    decoded.triangleList.push(vertIndex);
                }
                if (submesh.Weights instanceof buffer_1.Buffer) {
                    const skinBuf = submesh.Weights;
                    decoded.weights = [];
                    let pos = 0;
                    while (pos < skinBuf.length) {
                        const entry = {};
                        for (let x = 0; x < 4; x++) {
                            const jointNum = skinBuf.readUInt8(pos++);
                            if (jointNum === 0xFF) {
                                break;
                            }
                            const value = skinBuf.readUInt16LE(pos);
                            pos = pos + 2;
                            entry[jointNum] = value;
                        }
                        decoded.weights.push(entry);
                    }
                    if (decoded.weights.length !== decoded.position.length) {
                        throw new Error('Weight list differs in length from position list');
                    }
                }
                list.push(decoded);
            }
        }
        return list;
    }
    static decodeByteDomain3(buf, minDomain, maxDomain) {
        const result = [];
        for (let idx = 0; idx < buf.length; idx = idx + 6) {
            const posX = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(idx), minDomain.x, maxDomain.x, false);
            const posY = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(idx + 2), minDomain.y, maxDomain.y, false);
            const posZ = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(idx + 4), minDomain.z, maxDomain.z, false);
            result.push(new Vector3_1.Vector3([posX, posY, posZ]));
        }
        return result;
    }
    static decodeByteDomain2(buf, minDomain, maxDomain) {
        const result = [];
        for (let idx = 0; idx < buf.length; idx = idx + 4) {
            const posX = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(idx), minDomain.x, maxDomain.x, false);
            const posY = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(idx + 2), minDomain.y, maxDomain.y, false);
            result.push(new Vector2_1.Vector2([posX, posY]));
        }
        return result;
    }
    static toLLSDReal(num) {
        const real = [];
        for (const n of num) {
            real.push(new LLSDReal_1.LLSDReal(n));
        }
        return real;
    }
    encodeSubMesh(mesh) {
        const data = new LLSDMap_1.LLSDMap();
        if (mesh.noGeometry === true) {
            data.add('NoGeometry', true);
            return data;
        }
        if (!mesh.position) {
            throw new Error('No position data when encoding submesh');
        }
        if (mesh.positionDomain !== undefined) {
            data.add('Position', this.expandFromDomain(mesh.position, mesh.positionDomain.min, mesh.positionDomain.max));
            const min = new Vector3_1.Vector3(LLMesh.fixReal(mesh.positionDomain.min.toArray()));
            const max = new Vector3_1.Vector3(LLMesh.fixReal(mesh.positionDomain.max.toArray()));
            data.add('PositionDomain', new LLSDMap_1.LLSDMap([
                ['Min', [new LLSDReal_1.LLSDReal(min.x), new LLSDReal_1.LLSDReal(min.y), new LLSDReal_1.LLSDReal(min.z)]],
                ['Max', [new LLSDReal_1.LLSDReal(max.x), new LLSDReal_1.LLSDReal(max.y), new LLSDReal_1.LLSDReal(max.z)]]
            ]));
        }
        if (mesh.texCoord0 && mesh.texCoord0Domain !== undefined) {
            data.add('TexCoord0', this.expandFromDomain(mesh.texCoord0, mesh.texCoord0Domain.min, mesh.texCoord0Domain.max));
            const domainMin = new Vector2_1.Vector2(LLMesh.fixReal(mesh.texCoord0Domain.min.toArray()));
            const domainMax = new Vector2_1.Vector2(LLMesh.fixReal(mesh.texCoord0Domain.max.toArray()));
            data.add('TexCoord0Domain', new LLSDMap_1.LLSDMap([
                ['Min', [new LLSDReal_1.LLSDReal(domainMin.x), new LLSDReal_1.LLSDReal(domainMin.y)]],
                ['Max', [new LLSDReal_1.LLSDReal(domainMax.x), new LLSDReal_1.LLSDReal(domainMax.y)]]
            ]));
        }
        if (mesh.normal) {
            data.add('Normal', this.expandFromDomain(mesh.normal, new Vector3_1.Vector3([-1.0, -1.0, -1.0]), new Vector3_1.Vector3([1.0, 1.0, 1.0])));
        }
        if (mesh.triangleList) {
            const triangles = buffer_1.Buffer.allocUnsafe(mesh.triangleList.length * 2);
            let pos = 0;
            for (const triangle of mesh.triangleList) {
                triangles.writeUInt16LE(triangle, pos);
                pos = pos + 2;
            }
            data.add('TriangleList', triangles);
        }
        else {
            throw new Error('Triangle list is required');
        }
        if (mesh.weights) {
            // Calculate how much space we need
            let spaceNeeded = 0;
            for (const weight of mesh.weights) {
                const keys = Object.keys(weight);
                spaceNeeded = spaceNeeded + keys.length * 3;
                if (keys.length < 4) {
                    spaceNeeded = spaceNeeded + 1;
                }
            }
            const weightBuff = buffer_1.Buffer.allocUnsafe(spaceNeeded);
            let pos = 0;
            for (const weight of mesh.weights) {
                const keys = Object.keys(weight);
                for (const jointID of keys) {
                    weightBuff.writeUInt8(parseInt(jointID, 10), pos++);
                    weightBuff.writeUInt16LE(weight[parseInt(jointID, 10)], pos);
                    pos = pos + 2;
                }
                if (keys.length < 4) {
                    weightBuff.writeUInt8(0xFF, pos++);
                }
            }
            data.add('Weights', weightBuff);
        }
        return data;
    }
    expandFromDomain(data, domainMin, domainMax) {
        let length = 4;
        if (data.length > 0 && data[0] instanceof Vector3_1.Vector3) {
            length = 6;
        }
        const buf = buffer_1.Buffer.allocUnsafe(data.length * length);
        let pos = 0;
        for (const c of data) {
            const coord = c;
            const sizeX = domainMax.x - domainMin.x;
            const newX = Math.round(((coord.x - domainMin.x) / sizeX) * 65535);
            const sizeY = domainMax.y - domainMin.y;
            const newY = Math.round(((coord.y - domainMin.y) / sizeY) * 65535);
            buf.writeUInt16LE(newX, pos);
            pos = pos + 2;
            buf.writeUInt16LE(newY, pos);
            pos = pos + 2;
            if (coord instanceof Vector3_1.Vector3 && domainMin instanceof Vector3_1.Vector3 && domainMax instanceof Vector3_1.Vector3) {
                const sizeZ = domainMax.z - domainMin.z;
                const newZ = Math.round(((coord.z - domainMin.z) / sizeZ) * 65535);
                buf.writeUInt16LE(newZ, pos);
                pos = pos + 2;
            }
        }
        return buf;
    }
    async encodeLODLevel(_, submeshes) {
        const smList = [];
        for (const sub of submeshes) {
            smList.push(this.encodeSubMesh(sub));
        }
        return Utils_1.Utils.deflate(LLSD_1.LLSD.toBinary(smList));
    }
    async encodePhysicsHavok() {
        if (!this.physicsHavok) {
            return buffer_1.Buffer.alloc(0);
        }
        return Utils_1.Utils.deflate(LLSD_1.LLSD.toBinary(new LLSDMap_1.LLSDMap([
            ['WeldingData', this.physicsHavok.weldingData],
            ['HullMassProps', new LLSDMap_1.LLSDMap([
                    ['CoM', LLMesh.toLLSDReal(this.physicsHavok.hullMassProps.CoM)],
                    ['inertia', LLMesh.toLLSDReal(this.physicsHavok.hullMassProps.inertia)],
                    ['mass', new LLSDReal_1.LLSDReal(this.physicsHavok.hullMassProps.mass)],
                    ['volume', new LLSDReal_1.LLSDReal(this.physicsHavok.hullMassProps.volume)]
                ])],
            ['MeshDecompMassProps', new LLSDMap_1.LLSDMap([
                    ['CoM', LLMesh.toLLSDReal(this.physicsHavok.meshDecompMassProps.CoM)],
                    ['inertia', LLMesh.toLLSDReal(this.physicsHavok.meshDecompMassProps.inertia)],
                    ['mass', new LLSDReal_1.LLSDReal(this.physicsHavok.meshDecompMassProps.mass)],
                    ['volume', new LLSDReal_1.LLSDReal(this.physicsHavok.meshDecompMassProps.volume)]
                ])]
        ])));
    }
    async encodePhysicsConvex(conv) {
        const llsd = new LLSDMap_1.LLSDMap();
        llsd.add('Min', LLMesh.fixRealLLSD(conv.domain.min.toArray()));
        llsd.add('Max', LLMesh.fixRealLLSD(conv.domain.max.toArray()));
        const sizeX = conv.domain.max.x - conv.domain.min.x;
        const sizeY = conv.domain.max.y - conv.domain.min.y;
        const sizeZ = conv.domain.max.z - conv.domain.min.z;
        if (conv.hullList) {
            if (!conv.positions) {
                throw new Error('Positions must be present if hullList is set.');
            }
            llsd.add('HullList', buffer_1.Buffer.from(conv.hullList));
            const buf = buffer_1.Buffer.allocUnsafe(conv.positions.length * 6);
            let pos = 0;
            for (const vec of conv.positions) {
                buf.writeUInt16LE(Math.round(((vec.x - conv.domain.min.x) / sizeX) * 65535), pos);
                pos = pos + 2;
                buf.writeUInt16LE(Math.round(((vec.y - conv.domain.min.y) / sizeY) * 65535), pos);
                pos = pos + 2;
                buf.writeUInt16LE(Math.round(((vec.z - conv.domain.min.z) / sizeZ) * 65535), pos);
                pos = pos + 2;
            }
            llsd.add('Positions', buf);
        }
        {
            if (conv.boundingVerts) {
                const buf = buffer_1.Buffer.allocUnsafe(conv.boundingVerts.length * 6);
                let pos = 0;
                for (const vec of conv.boundingVerts) {
                    buf.writeUInt16LE(Math.round(((vec.x - conv.domain.min.x) / sizeX) * 65535), pos);
                    pos = pos + 2;
                    buf.writeUInt16LE(Math.round(((vec.y - conv.domain.min.y) / sizeY) * 65535), pos);
                    pos = pos + 2;
                    buf.writeUInt16LE(Math.round(((vec.z - conv.domain.min.z) / sizeZ) * 65535), pos);
                    pos = pos + 2;
                }
                llsd.add('BoundingVerts', buf);
            }
        }
        return Utils_1.Utils.deflate(LLSD_1.LLSD.toBinary(llsd));
    }
    async encodeSkin(skin) {
        const llsd = new LLSDMap_1.LLSDMap();
        llsd.add('joint_names', skin.jointNames);
        llsd.add('bind_shape_matrix', LLMesh.toLLSDReal(skin.bindShapeMatrix.toArray()));
        const inverseBindMatrix = [];
        for (const matrix of skin.inverseBindMatrix) {
            inverseBindMatrix.push(LLMesh.toLLSDReal(matrix.toArray()));
        }
        llsd.add('inverse_bind_matrix', inverseBindMatrix);
        if (skin.altInverseBindMatrix) {
            const altInverseBindMatrix = [];
            for (const matrix of skin.altInverseBindMatrix) {
                altInverseBindMatrix.push(LLMesh.toLLSDReal(matrix.toArray()));
            }
            llsd.add('alt_inverse_bind_matrix', altInverseBindMatrix);
        }
        if (skin.pelvisOffset) {
            llsd.add('pelvis_offset', LLMesh.toLLSDReal(skin.pelvisOffset.toArray()));
        }
        return Utils_1.Utils.deflate(LLSD_1.LLSD.toBinary(llsd));
    }
}
exports.LLMesh = LLMesh;
//# sourceMappingURL=LLMesh.js.map