"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtraParams = void 0;
const ExtraParamType_1 = require("../../enums/ExtraParamType");
const FlexibleData_1 = require("./FlexibleData");
const LightData_1 = require("./LightData");
const LightImageData_1 = require("./LightImageData");
const MeshData_1 = require("./MeshData");
const SculptData_1 = require("./SculptData");
const ExtendedMeshData_1 = require("./ExtendedMeshData");
const RenderMaterialData_1 = require("./RenderMaterialData");
const ReflectionProbeData_1 = require("./ReflectionProbeData");
class ExtraParams {
    flexibleData = null;
    lightData = null;
    lightImageData = null;
    meshData = null;
    sculptData = null;
    extendedMeshData = null;
    renderMaterialData = null;
    reflectionProbeData = null;
    static getLengthOfParams(buf, pos) {
        const startPos = pos;
        if (pos >= buf.length) {
            return 0;
        }
        const extraParamCount = buf.readUInt8(pos++);
        for (let k = 0; k < extraParamCount; k++) {
            // UNUSED: const type: ExtraParamType = buf.readUInt16LE(pos);
            pos = pos + 2;
            const paramLength = buf.readUInt32LE(pos);
            pos = pos + 4 + paramLength;
        }
        return pos - startPos;
    }
    static from(buf) {
        const ep = new ExtraParams();
        let pos = 0;
        if (pos >= buf.length) {
            return ep;
        }
        const extraParamCount = buf.readUInt8(pos++);
        for (let k = 0; k < extraParamCount; k++) {
            const type = buf.readUInt16LE(pos);
            pos = pos + 2;
            const paramLength = buf.readUInt32LE(pos);
            pos = pos + 4;
            switch (type) {
                case ExtraParamType_1.ExtraParamType.Flexible:
                    ep.flexibleData = new FlexibleData_1.FlexibleData(buf, pos, paramLength);
                    break;
                case ExtraParamType_1.ExtraParamType.Light:
                    ep.lightData = new LightData_1.LightData(buf, pos, paramLength);
                    break;
                case ExtraParamType_1.ExtraParamType.LightImage:
                    ep.lightImageData = new LightImageData_1.LightImageData(buf, pos, paramLength);
                    break;
                case ExtraParamType_1.ExtraParamType.Mesh:
                    ep.meshData = new MeshData_1.MeshData(buf, pos, paramLength);
                    break;
                case ExtraParamType_1.ExtraParamType.Sculpt:
                    ep.sculptData = new SculptData_1.SculptData(buf, pos, paramLength);
                    break;
                case ExtraParamType_1.ExtraParamType.ExtendedMesh:
                    ep.extendedMeshData = new ExtendedMeshData_1.ExtendedMeshData(buf, pos, paramLength);
                    break;
                case ExtraParamType_1.ExtraParamType.RenderMaterial:
                    ep.renderMaterialData = new RenderMaterialData_1.RenderMaterialData(buf, pos, paramLength);
                    break;
                case ExtraParamType_1.ExtraParamType.ReflectionProbe:
                    ep.reflectionProbeData = new ReflectionProbeData_1.ReflectionProbeData(buf, pos, paramLength);
                    break;
            }
            pos += paramLength;
        }
        return ep;
    }
    setMeshData(type, uuid) {
        this.meshData = new MeshData_1.MeshData();
        this.meshData.type = type;
        this.meshData.meshData = uuid;
    }
    // noinspection JSUnusedGlobalSymbols
    setExtendedMeshData(flags) {
        this.extendedMeshData = new ExtendedMeshData_1.ExtendedMeshData();
        this.extendedMeshData.flags = flags;
    }
    // noinspection JSUnusedGlobalSymbols
    setReflectionProbeData(ambiance, clipDistance, flags) {
        this.reflectionProbeData = new ReflectionProbeData_1.ReflectionProbeData();
        this.reflectionProbeData.ambiance = ambiance;
        this.reflectionProbeData.clipDistance = clipDistance;
        this.reflectionProbeData.flags = flags;
    }
    // noinspection JSUnusedGlobalSymbols
    setRenderMaterialData(params) {
        this.renderMaterialData = new RenderMaterialData_1.RenderMaterialData();
        this.renderMaterialData.params = params;
    }
    setSculptData(type, uuid) {
        this.sculptData = new SculptData_1.SculptData();
        this.sculptData.type = type;
        this.sculptData.texture = uuid;
    }
    setFlexiData(softness, tension, drag, gravity, wind, force) {
        this.flexibleData = new FlexibleData_1.FlexibleData();
        this.flexibleData.Softness = softness;
        this.flexibleData.Tension = tension;
        this.flexibleData.Drag = drag;
        this.flexibleData.Gravity = gravity;
        this.flexibleData.Wind = wind;
        this.flexibleData.Force = force;
    }
    setLightData(color, radius, cutoff, falloff, intensity) {
        this.lightData = new LightData_1.LightData();
        this.lightData.Color = color;
        this.lightData.Radius = radius;
        this.lightData.Cutoff = cutoff;
        this.lightData.Falloff = falloff;
        this.lightData.Intensity = intensity;
    }
    toBuffer() {
        let totalLength = 1;
        let paramCount = 0;
        if (this.flexibleData !== null) {
            paramCount++;
            totalLength = totalLength + 2 + 4 + 16;
        }
        if (this.lightData !== null) {
            paramCount++;
            totalLength = totalLength + 2 + 4 + 16;
        }
        if (this.lightImageData !== null) {
            paramCount++;
            totalLength = totalLength + 2 + 4 + 28;
        }
        if (this.meshData !== null) {
            paramCount++;
            totalLength = totalLength + 2 + 4 + 17;
        }
        if (this.sculptData !== null) {
            paramCount++;
            totalLength = totalLength + 2 + 4 + 17;
        }
        if (this.extendedMeshData !== null) {
            paramCount++;
            totalLength = totalLength + 2 + 4 + 4;
        }
        if (this.reflectionProbeData !== null) {
            paramCount++;
            totalLength = totalLength + 2 + 4 + 9;
        }
        if (this.renderMaterialData !== null) {
            paramCount++;
            totalLength = totalLength + 2 + 4 + 1 + (this.renderMaterialData.params.length * 17);
        }
        const buf = Buffer.allocUnsafe(totalLength);
        let pos = 0;
        buf.writeUInt8(paramCount, pos++);
        if (this.flexibleData !== null) {
            buf.writeUInt16LE(ExtraParamType_1.ExtraParamType.Flexible, pos);
            pos = pos + 2;
            buf.writeUInt32LE(16, pos);
            pos = pos + 4;
            this.flexibleData.writeToBuffer(buf, pos);
            pos = pos + 16;
        }
        if (this.lightData !== null) {
            buf.writeUInt16LE(ExtraParamType_1.ExtraParamType.Light, pos);
            pos = pos + 2;
            buf.writeUInt32LE(16, pos);
            pos = pos + 4;
            this.lightData.writeToBuffer(buf, pos);
            pos = pos + 16;
        }
        if (this.lightImageData !== null) {
            buf.writeUInt16LE(ExtraParamType_1.ExtraParamType.LightImage, pos);
            pos = pos + 2;
            buf.writeUInt32LE(28, pos);
            pos = pos + 4;
            this.lightImageData.writeToBuffer(buf, pos);
            pos = pos + 28;
        }
        if (this.meshData !== null) {
            buf.writeUInt16LE(ExtraParamType_1.ExtraParamType.Mesh, pos);
            pos = pos + 2;
            buf.writeUInt32LE(17, pos);
            pos = pos + 4;
            this.meshData.writeToBuffer(buf, pos);
            pos = pos + 17;
        }
        if (this.sculptData !== null) {
            buf.writeUInt16LE(ExtraParamType_1.ExtraParamType.Sculpt, pos);
            pos = pos + 2;
            buf.writeUInt32LE(17, pos);
            pos = pos + 4;
            this.sculptData.writeToBuffer(buf, pos);
            pos = pos + 17;
        }
        if (this.extendedMeshData !== null) {
            buf.writeUInt16LE(ExtraParamType_1.ExtraParamType.ExtendedMesh, pos);
            pos = pos + 2;
            buf.writeUInt32LE(4, pos);
            pos = pos + 4;
            this.extendedMeshData.writeToBuffer(buf, pos);
            pos = pos + 4;
        }
        if (this.reflectionProbeData !== null) {
            buf.writeUInt16LE(ExtraParamType_1.ExtraParamType.ReflectionProbe, pos);
            pos = pos + 2;
            buf.writeUInt32LE(9, pos);
            pos = pos + 4;
            this.reflectionProbeData.writeToBuffer(buf, pos);
            pos = pos + 9;
        }
        if (this.renderMaterialData !== null) {
            buf.writeUInt16LE(ExtraParamType_1.ExtraParamType.RenderMaterial, pos);
            pos = pos + 2;
            buf.writeUInt32LE(1 + (this.renderMaterialData.params.length * 17), pos);
            pos = pos + 4;
            this.renderMaterialData.writeToBuffer(buf, pos);
            pos = pos + 1 + (this.renderMaterialData.params.length * 17);
        }
        return buf;
    }
    toBase64() {
        return this.toBuffer().toString('base64');
    }
}
exports.ExtraParams = ExtraParams;
//# sourceMappingURL=ExtraParams.js.map