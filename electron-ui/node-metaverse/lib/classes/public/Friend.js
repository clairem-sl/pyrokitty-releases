"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Friend = void 0;
const Avatar_1 = require("./Avatar");
const RightsFlags_1 = require("../../enums/RightsFlags");
class Friend extends Avatar_1.Avatar {
    online;
    theirRights = RightsFlags_1.RightsFlags.None;
    myRights = RightsFlags_1.RightsFlags.None;
}
exports.Friend = Friend;
//# sourceMappingURL=Friend.js.map