"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginError = void 0;
class LoginError extends Error {
    reason;
    message_id;
    constructor(err) {
        super(err.message);
        this.reason = err.reason;
        this.message_id = err.message_id;
    }
}
exports.LoginError = LoginError;
//# sourceMappingURL=LoginError.js.map