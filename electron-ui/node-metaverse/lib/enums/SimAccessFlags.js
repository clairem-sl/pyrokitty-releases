"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimAccessFlags = void 0;
var SimAccessFlags;
(function (SimAccessFlags) {
    SimAccessFlags[SimAccessFlags["Unknown"] = 0] = "Unknown";
    SimAccessFlags[SimAccessFlags["Trial"] = 7] = "Trial";
    SimAccessFlags[SimAccessFlags["PG"] = 13] = "PG";
    SimAccessFlags[SimAccessFlags["Mature"] = 21] = "Mature";
    SimAccessFlags[SimAccessFlags["Adult"] = 42] = "Adult";
    SimAccessFlags[SimAccessFlags["Down"] = 254] = "Down";
    SimAccessFlags[SimAccessFlags["NonExistent"] = 255] = "NonExistent";
})(SimAccessFlags || (exports.SimAccessFlags = SimAccessFlags = {}));
//# sourceMappingURL=SimAccessFlags.js.map