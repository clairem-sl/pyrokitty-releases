"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginParameters = void 0;
const Utils_1 = require("./Utils");
class LoginParameters {
    firstName;
    lastName;
    password;
    start = 'last';
    url = 'https://login.agni.lindenlab.com/cgi-bin/login.cgi';
    token;
    mfa_hash;
    agreeToTOS;
    readCritical;
    passwordPrehashed = false;
    getHashedPassword() {
        if (this.passwordPrehashed) {
            return this.password;
        }
        return '$1$' + Utils_1.Utils.MD5String(this.password.substring(0, 16));
    }
}
exports.LoginParameters = LoginParameters;
//# sourceMappingURL=LoginParameters.js.map