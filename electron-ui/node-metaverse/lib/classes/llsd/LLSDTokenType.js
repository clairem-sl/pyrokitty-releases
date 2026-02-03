"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSDTokenType = void 0;
var LLSDTokenType;
(function (LLSDTokenType) {
    LLSDTokenType[LLSDTokenType["Unknown"] = 0] = "Unknown";
    LLSDTokenType[LLSDTokenType["Whitespace"] = 1] = "Whitespace";
    LLSDTokenType[LLSDTokenType["Null"] = 2] = "Null";
    LLSDTokenType[LLSDTokenType["MapStart"] = 3] = "MapStart";
    LLSDTokenType[LLSDTokenType["MapEnd"] = 4] = "MapEnd";
    LLSDTokenType[LLSDTokenType["Colon"] = 5] = "Colon";
    LLSDTokenType[LLSDTokenType["Comma"] = 6] = "Comma";
    LLSDTokenType[LLSDTokenType["ArrayStart"] = 7] = "ArrayStart";
    LLSDTokenType[LLSDTokenType["ArrayEnd"] = 8] = "ArrayEnd";
    LLSDTokenType[LLSDTokenType["Boolean"] = 9] = "Boolean";
    LLSDTokenType[LLSDTokenType["Integer"] = 10] = "Integer";
    LLSDTokenType[LLSDTokenType["Real"] = 11] = "Real";
    LLSDTokenType[LLSDTokenType["UUID"] = 12] = "UUID";
    LLSDTokenType[LLSDTokenType["StringFixedSingle"] = 13] = "StringFixedSingle";
    LLSDTokenType[LLSDTokenType["StringFixedDouble"] = 14] = "StringFixedDouble";
    LLSDTokenType[LLSDTokenType["StringDynamicStart"] = 15] = "StringDynamicStart";
    LLSDTokenType[LLSDTokenType["URI"] = 16] = "URI";
    LLSDTokenType[LLSDTokenType["Date"] = 17] = "Date";
    LLSDTokenType[LLSDTokenType["BinaryStatic"] = 18] = "BinaryStatic";
    LLSDTokenType[LLSDTokenType["BinaryDynamicStart"] = 19] = "BinaryDynamicStart";
})(LLSDTokenType || (exports.LLSDTokenType = LLSDTokenType = {}));
//# sourceMappingURL=LLSDTokenType.js.map