"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSDArray = void 0;
const LLSDTokenType_1 = require("./LLSDTokenType");
const LLSDNotation_1 = require("./LLSDNotation");
const LLSDBinary_1 = require("./LLSDBinary");
const LLSDXML_1 = require("./LLSDXML");
const Vector3_1 = require("../Vector3");
const LLSDReal_1 = require("./LLSDReal");
const Vector2_1 = require("../Vector2");
const Vector4_1 = require("../Vector4");
const Quaternion_1 = require("../Quaternion");
const LLSDInteger_1 = require("./LLSDInteger");
class LLSDArray {
    static parseNotation(gen) {
        const arr = [];
        let value = undefined;
        while (true) {
            const token = gen();
            if (token === undefined) {
                throw new Error('Unexpected end of input in array');
            }
            switch (token.type) {
                case LLSDTokenType_1.LLSDTokenType.Whitespace:
                    {
                        continue;
                    }
                case LLSDTokenType_1.LLSDTokenType.ArrayEnd:
                    {
                        if (value !== undefined) {
                            arr.push(value);
                        }
                        return arr;
                    }
                case LLSDTokenType_1.LLSDTokenType.Comma:
                    {
                        if (value === undefined) {
                            throw new Error('Expected value before comma');
                        }
                        arr.push(value);
                        value = undefined;
                        continue;
                    }
                case LLSDTokenType_1.LLSDTokenType.Unknown:
                case LLSDTokenType_1.LLSDTokenType.Null:
                case LLSDTokenType_1.LLSDTokenType.MapStart:
                case LLSDTokenType_1.LLSDTokenType.MapEnd:
                case LLSDTokenType_1.LLSDTokenType.Colon:
                case LLSDTokenType_1.LLSDTokenType.ArrayStart:
                case LLSDTokenType_1.LLSDTokenType.Boolean:
                case LLSDTokenType_1.LLSDTokenType.Integer:
                case LLSDTokenType_1.LLSDTokenType.Real:
                case LLSDTokenType_1.LLSDTokenType.UUID:
                case LLSDTokenType_1.LLSDTokenType.StringFixedSingle:
                case LLSDTokenType_1.LLSDTokenType.StringFixedDouble:
                case LLSDTokenType_1.LLSDTokenType.StringDynamicStart:
                case LLSDTokenType_1.LLSDTokenType.URI:
                case LLSDTokenType_1.LLSDTokenType.Date:
                case LLSDTokenType_1.LLSDTokenType.BinaryStatic:
                case LLSDTokenType_1.LLSDTokenType.BinaryDynamicStart:
                default:
                    break;
            }
            if (value !== undefined) {
                throw new Error('Comma or end brace expected');
            }
            value = LLSDNotation_1.LLSDNotation.parseValueToken(gen, token);
        }
    }
    static parseBinary(reader) {
        const arr = [];
        const length = reader.readUInt32BE();
        for (let x = 0; x < length; x++) {
            const val = LLSDBinary_1.LLSDBinary.parseValue(reader);
            arr.push(val);
        }
        const endMap = reader.readFixedString(1);
        if (endMap !== ']') {
            throw new Error('Array end expected');
        }
        return arr;
    }
    static parseXML(element) {
        const arr = [];
        for (const val of element) {
            arr.push(LLSDXML_1.LLSDXML.parseValue([val]));
        }
        return arr;
    }
    static toNotation(value) {
        const builder = ['['];
        let first = true;
        for (const val of value) {
            if (first) {
                first = false;
            }
            else {
                builder.push(',');
            }
            builder.push(LLSDNotation_1.LLSDNotation.encodeValue(val));
        }
        builder.push(']');
        return builder.join('');
    }
    static toBinary(value, writer) {
        writer.writeFixedString('[');
        writer.writeUInt32BE(value.length);
        for (const v of value) {
            LLSDBinary_1.LLSDBinary.encodeValue(v, writer);
        }
        writer.writeFixedString(']');
    }
    static toXML(value) {
        const arr = [];
        for (const val of value) {
            arr.push(LLSDXML_1.LLSDXML.encodeValue(val));
        }
        return {
            array: arr
        };
    }
    static toQuaternion(arr) {
        if (arr.length !== 4) {
            throw new Error('Expect 4 arguments');
        }
        return new Quaternion_1.Quaternion(this.componentToFloat(arr[0]), this.componentToFloat(arr[1]), this.componentToFloat(arr[2]), this.componentToFloat(arr[3]));
    }
    static toVector4(arr) {
        if (arr.length !== 4) {
            throw new Error('Expect 4 arguments');
        }
        return new Vector4_1.Vector4(this.componentToFloat(arr[0]), this.componentToFloat(arr[1]), this.componentToFloat(arr[2]), this.componentToFloat(arr[3]));
    }
    static toVector3(arr) {
        if (arr.length !== 3) {
            throw new Error('Expect 3 arguments');
        }
        return new Vector3_1.Vector3(this.componentToFloat(arr[0]), this.componentToFloat(arr[1]), this.componentToFloat(arr[2]));
    }
    static toVector2(arr) {
        if (arr.length !== 2) {
            throw new Error('Expect 2 arguments');
        }
        return new Vector2_1.Vector2(this.componentToFloat(arr[0]), this.componentToFloat(arr[1]));
    }
    static fromQuaternion(vec) {
        if (vec === undefined) {
            return undefined;
        }
        return [
            new LLSDReal_1.LLSDReal(vec.x),
            new LLSDReal_1.LLSDReal(vec.y),
            new LLSDReal_1.LLSDReal(vec.z),
            new LLSDReal_1.LLSDReal(vec.w)
        ];
    }
    static fromVector4(vec) {
        if (vec === undefined) {
            return undefined;
        }
        return [
            new LLSDReal_1.LLSDReal(vec.x),
            new LLSDReal_1.LLSDReal(vec.y),
            new LLSDReal_1.LLSDReal(vec.z),
            new LLSDReal_1.LLSDReal(vec.w),
        ];
    }
    static fromVector3(vec) {
        if (vec === undefined) {
            return undefined;
        }
        return [
            new LLSDReal_1.LLSDReal(vec.x),
            new LLSDReal_1.LLSDReal(vec.y),
            new LLSDReal_1.LLSDReal(vec.z),
        ];
    }
    static fromVector2(vec) {
        if (vec === undefined) {
            return undefined;
        }
        return [
            new LLSDReal_1.LLSDReal(vec.x),
            new LLSDReal_1.LLSDReal(vec.y)
        ];
    }
    static toStringArray(arr) {
        const a = [];
        for (const v of arr) {
            a.push(String(v));
        }
        return a;
    }
    static toNumberArray(arr) {
        const a = [];
        for (const v of arr) {
            if (v instanceof LLSDReal_1.LLSDReal || v instanceof LLSDInteger_1.LLSDInteger) {
                a.push(v.valueOf());
            }
            else {
                a.push(Number(v));
            }
        }
        return a;
    }
    static componentToFloat(val) {
        if (val instanceof LLSDReal_1.LLSDReal) {
            return val.valueOf();
        }
        else if (typeof val === 'number') {
            return val;
        }
        let type = typeof val;
        if (type === 'object' && val !== null) {
            type += ' (' + val.constructor.name + ')';
        }
        throw new Error('Component is not a number (' + type + ')');
    }
}
exports.LLSDArray = LLSDArray;
//# sourceMappingURL=LLSDArray.js.map