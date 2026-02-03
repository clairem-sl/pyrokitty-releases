"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BVHJoint = void 0;
const Utils_1 = require("./Utils");
const Vector3_1 = require("./Vector3");
const BVHJointKeyframe_1 = require("./BVHJointKeyframe");
class BVHJoint {
    name;
    priority;
    rotationKeyframeCount;
    rotationKeyframes = [];
    positionKeyframeCount;
    positionKeyframes = [];
    readFromBuffer(buf, pos, inPoint, outPoint) {
        const result = Utils_1.Utils.BufferToString(buf, pos);
        pos += result.readLength;
        this.name = result.result;
        this.priority = buf.readInt32LE(pos);
        pos = pos + 4;
        this.rotationKeyframeCount = buf.readInt32LE(pos);
        pos = pos + 4;
        for (let frameNum = 0; frameNum < this.rotationKeyframeCount; frameNum++) {
            const jointKF = new BVHJointKeyframe_1.BVHJointKeyframe();
            jointKF.time = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(pos), inPoint, outPoint);
            pos = pos + 2;
            const x = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(pos), -1.0, 1.0);
            pos = pos + 2;
            const y = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(pos), -1.0, 1.0);
            pos = pos + 2;
            const z = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(pos), -1.0, 1.0);
            pos = pos + 2;
            jointKF.transform = new Vector3_1.Vector3([x, y, z]);
            this.rotationKeyframes.push(jointKF);
        }
        this.positionKeyframeCount = buf.readInt32LE(pos);
        pos = pos + 4;
        for (let frameNum = 0; frameNum < this.positionKeyframeCount; frameNum++) {
            const jointKF = new BVHJointKeyframe_1.BVHJointKeyframe();
            jointKF.time = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(pos), inPoint, outPoint);
            pos = pos + 2;
            const x = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(pos), -1.0, 1.0);
            pos = pos + 2;
            const y = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(pos), -1.0, 1.0);
            pos = pos + 2;
            const z = Utils_1.Utils.UInt16ToFloat(buf.readUInt16LE(pos), -1.0, 1.0);
            pos = pos + 2;
            jointKF.transform = new Vector3_1.Vector3([x, y, z]);
            this.positionKeyframes.push(jointKF);
        }
        return pos;
    }
}
exports.BVHJoint = BVHJoint;
//# sourceMappingURL=BVHJoint.js.map