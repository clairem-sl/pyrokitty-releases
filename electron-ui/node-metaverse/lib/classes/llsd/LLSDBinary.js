"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSDBinary = void 0;
const LLSDMap_1 = require("./LLSDMap");
const LLSDInteger_1 = require("./LLSDInteger");
const LLSDReal_1 = require("./LLSDReal");
const UUID_1 = require("../UUID");
const LLSDURI_1 = require("./LLSDURI");
const LLSDArray_1 = require("./LLSDArray");
class LLSDBinary {
    static parseValue(reader) {
        const token = reader.readFixedString(1);
        switch (token) {
            case '{':
                return LLSDMap_1.LLSDMap.parseBinary(reader);
            case '!':
                return null;
            case '1':
                return true;
            case '0':
                return false;
            case 'i':
                return LLSDInteger_1.LLSDInteger.parseBinary(reader);
            case 'r':
                return LLSDReal_1.LLSDReal.parseBinary(reader);
            case 'u':
                {
                    const buf = reader.readBuffer(16);
                    return new UUID_1.UUID(buf, 0);
                }
            case 'b':
                {
                    const binaryLength = reader.readUInt32BE();
                    return reader.readBuffer(binaryLength);
                }
            case 's':
                {
                    const stringLength = reader.readUInt32BE();
                    return reader.readFixedString(stringLength);
                }
            case 'l':
                {
                    const stringLength = reader.readUInt32BE();
                    const str = reader.readFixedString(stringLength);
                    return new LLSDURI_1.LLSDURI(str);
                }
            case 'd':
                {
                    const secs = reader.readDoubleBE();
                    return new Date(secs * 1000);
                }
            case '[':
                return LLSDArray_1.LLSDArray.parseBinary(reader);
            default:
                throw new Error('Unexpected token: ' + token);
        }
    }
    static encodeValue(value, writer) {
        if (value instanceof LLSDMap_1.LLSDMap) {
            value.toBinary(writer);
        }
        else if (value instanceof LLSDInteger_1.LLSDInteger) {
            writer.writeFixedString('i');
            writer.writeUInt32BE(value.valueOf());
        }
        else if (value instanceof LLSDReal_1.LLSDReal) {
            writer.writeFixedString('r');
            writer.writeDoubleBE(value.valueOf());
        }
        else if (value instanceof UUID_1.UUID) {
            writer.writeFixedString('u');
            writer.writeUUID(value);
        }
        else if (value instanceof LLSDURI_1.LLSDURI) {
            writer.writeFixedString('l');
            const str = value.toString();
            writer.writeUInt32BE(str.length);
            writer.writeFixedString(str);
        }
        else if (value instanceof Buffer) {
            writer.writeFixedString('b');
            writer.writeUInt32BE(value.length);
            writer.writeBuffer(value);
        }
        else if (value instanceof Date) {
            writer.writeFixedString('d');
            writer.writeDoubleBE(value.getTime() / 1000);
        }
        else if (value === null) {
            writer.writeFixedString('!');
        }
        else if (value === true) {
            writer.writeFixedString('1');
        }
        else if (value === false) {
            writer.writeFixedString('0');
        }
        else if (typeof value === 'string') {
            writer.writeFixedString('s');
            const str = value.toString();
            writer.writeUInt32BE(str.length);
            writer.writeFixedString(str);
        }
        else if (Array.isArray(value)) {
            LLSDArray_1.LLSDArray.toBinary(value, writer);
            return;
        }
        else {
            throw new Error('Unknown type: ' + String(value));
        }
    }
}
exports.LLSDBinary = LLSDBinary;
//# sourceMappingURL=LLSDBinary.js.map