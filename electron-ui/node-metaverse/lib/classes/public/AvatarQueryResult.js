"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvatarQueryResult = void 0;
class AvatarQueryResult {
    avatarKey;
    firstName;
    lastName;
    constructor(avatarKey, firstName, lastName) {
        this.avatarKey = avatarKey;
        this.firstName = firstName;
        this.lastName = lastName;
    }
    getName() {
        return this.firstName + ' ' + this.lastName;
    }
    getFirstName() {
        return this.firstName;
    }
    getLastName() {
        return this.lastName;
    }
    getKey() {
        return this.avatarKey;
    }
}
exports.AvatarQueryResult = AvatarQueryResult;
//# sourceMappingURL=AvatarQueryResult.js.map