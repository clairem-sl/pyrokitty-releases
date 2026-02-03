"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionFlags = void 0;
var TransactionFlags;
(function (TransactionFlags) {
    TransactionFlags[TransactionFlags["None"] = 0] = "None";
    TransactionFlags[TransactionFlags["SourceGroup"] = 1] = "SourceGroup";
    TransactionFlags[TransactionFlags["DestGroup"] = 2] = "DestGroup";
    TransactionFlags[TransactionFlags["OwnerGroup"] = 4] = "OwnerGroup";
    TransactionFlags[TransactionFlags["SimultaneousContribution"] = 8] = "SimultaneousContribution";
    TransactionFlags[TransactionFlags["ContributionRemoval"] = 16] = "ContributionRemoval";
})(TransactionFlags || (exports.TransactionFlags = TransactionFlags = {}));
//# sourceMappingURL=TransactionFlags.js.map