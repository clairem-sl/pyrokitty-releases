"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSDInteger = void 0;
class LLSDInteger {
    _int;
    constructor(int) {
        this._int = int;
    }
    static parseBinary(reader) {
        return new LLSDInteger(reader.readUInt32BE());
    }
    valueOf() {
        return this._int;
    }
    toJSON() {
        return this._int;
    }
    set value(newValue) {
        if (!Number.isInteger(newValue)) {
            throw new Error("LLSDInteger must be an integer.");
        }
        this._int = newValue;
    }
}
exports.LLSDInteger = LLSDInteger;
//# sourceMappingURL=LLSDInteger.js.map