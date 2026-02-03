"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferStatus = void 0;
var TransferStatus;
(function (TransferStatus) {
    TransferStatus[TransferStatus["InsufficientPermissions"] = -3] = "InsufficientPermissions";
    TransferStatus[TransferStatus["NotFound"] = -2] = "NotFound";
    TransferStatus[TransferStatus["Error"] = -1] = "Error";
    TransferStatus[TransferStatus["OK"] = 0] = "OK";
    TransferStatus[TransferStatus["Done"] = 1] = "Done";
    TransferStatus[TransferStatus["Skip"] = 2] = "Skip";
    TransferStatus[TransferStatus["Abort"] = 3] = "Abort";
})(TransferStatus || (exports.TransferStatus = TransferStatus = {}));
//# sourceMappingURL=TransferStatus.js.map