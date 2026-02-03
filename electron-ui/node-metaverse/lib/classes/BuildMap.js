"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildMap = void 0;
const Vector3_1 = require("./Vector3");
class BuildMap {
    assetMap;
    callback;
    costOnly;
    primsNeeded = 0;
    primReservoir = [];
    rezLocation = Vector3_1.Vector3.getZero();
    constructor(assetMap, callback, costOnly = false) {
        this.assetMap = assetMap;
        this.callback = callback;
        this.costOnly = costOnly;
    }
}
exports.BuildMap = BuildMap;
//# sourceMappingURL=BuildMap.js.map