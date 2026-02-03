"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SoundFlags = void 0;
var SoundFlags;
(function (SoundFlags) {
    SoundFlags[SoundFlags["None"] = 0] = "None";
    SoundFlags[SoundFlags["Loop"] = 1] = "Loop";
    SoundFlags[SoundFlags["SyncMaster"] = 2] = "SyncMaster";
    SoundFlags[SoundFlags["SyncSlave"] = 4] = "SyncSlave";
    SoundFlags[SoundFlags["SyncPending"] = 8] = "SyncPending";
    SoundFlags[SoundFlags["Queue"] = 16] = "Queue";
    SoundFlags[SoundFlags["Stop"] = 32] = "Stop";
})(SoundFlags || (exports.SoundFlags = SoundFlags = {}));
//# sourceMappingURL=SoundFlags.js.map