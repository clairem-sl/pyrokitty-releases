"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSDMap = void 0;
const LLSDObject_1 = require("./LLSDObject");
const LLSDTokenType_1 = require("./LLSDTokenType");
const LLSDNotation_1 = require("./LLSDNotation");
const LLSDBinary_1 = require("./LLSDBinary");
const LLSDXML_1 = require("./LLSDXML");
class LLSDMap extends LLSDObject_1.LLSDObject {
    ___data = new Map();
    constructor(initialData) {
        super();
        if (initialData) {
            if (Array.isArray(initialData)) {
                for (const d of initialData) {
                    this.___data.set(d[0], d[1]);
                }
            }
            else {
                for (const key of Object.keys(initialData)) {
                    const v = initialData[key];
                    if (v !== undefined) {
                        this.___data.set(key, v);
                    }
                }
            }
        }
        return new Proxy(this, {
            get(target, prop, receiver) {
                if (typeof prop === 'string' && target.___data.has(prop)) {
                    return target.___data.get(prop);
                }
                // Handle other properties or methods
                return Reflect.get(target, prop, receiver);
            },
            set(target, prop, value, receiver) {
                if (typeof prop === 'string') {
                    target.___data.set(prop, value);
                    return true;
                }
                return Reflect.set(target, prop, value, receiver);
            },
            has(target, prop) {
                if (typeof prop === 'string') {
                    return target.___data.has(prop);
                }
                return Reflect.has(target, prop);
            },
            deleteProperty(target, prop) {
                if (typeof prop === 'string') {
                    return target.___data.delete(prop);
                }
                return Reflect.deleteProperty(target, prop);
            },
            ownKeys(target) {
                return Array.from(target.___data.keys()).map(key => String(key));
            },
            getOwnPropertyDescriptor(target, prop) {
                if (typeof prop === 'string' && target.___data.has(prop)) {
                    return {
                        enumerable: true,
                        configurable: true,
                    };
                }
                return undefined;
            },
        });
    }
    static parseNotation(gen) {
        const m = new LLSDMap();
        let expectsKey = true;
        let key = undefined;
        let value = undefined;
        while (true) {
            const token = gen();
            if (token === undefined) {
                throw new Error('Unexpected end of input in map');
            }
            switch (token.type) {
                case LLSDTokenType_1.LLSDTokenType.Whitespace:
                    {
                        continue;
                    }
                case LLSDTokenType_1.LLSDTokenType.MapEnd:
                    {
                        if (expectsKey) {
                            throw new Error('Unexpected end of map');
                        }
                        if (key !== undefined && value !== undefined) {
                            m.___data.set(String(key), value);
                        }
                        else if (m.___data.size > 0) {
                            throw new Error('Expected value before end of map');
                        }
                        return m;
                    }
                case LLSDTokenType_1.LLSDTokenType.Colon:
                    {
                        if (!expectsKey) {
                            throw new Error('Unexpected symbol: :');
                        }
                        if (key === undefined) {
                            throw new Error('Empty key not allowed');
                        }
                        expectsKey = false;
                        continue;
                    }
                case LLSDTokenType_1.LLSDTokenType.Comma:
                    {
                        if (expectsKey) {
                            throw new Error('Empty map entry not allowed');
                        }
                        if (value === undefined) {
                            throw new Error('Empty map value not allowed');
                        }
                        if (key !== undefined) {
                            m.___data.set(String(key), value);
                        }
                        key = undefined;
                        value = undefined;
                        expectsKey = true;
                        continue;
                    }
                case LLSDTokenType_1.LLSDTokenType.Unknown:
                case LLSDTokenType_1.LLSDTokenType.Null:
                case LLSDTokenType_1.LLSDTokenType.MapStart:
                case LLSDTokenType_1.LLSDTokenType.ArrayStart:
                case LLSDTokenType_1.LLSDTokenType.ArrayEnd:
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
            if (expectsKey && key !== undefined) {
                throw new Error('Colon expected');
            }
            else if (value !== undefined) {
                throw new Error('Comma or end brace expected');
            }
            const val = LLSDNotation_1.LLSDNotation.parseValueToken(gen, token);
            if (expectsKey) {
                key = val;
            }
            else {
                value = val;
            }
        }
    }
    static parseBinary(reader) {
        const map = new LLSDMap();
        const length = reader.readUInt32BE();
        for (let x = 0; x < length; x++) {
            const keyTag = reader.readFixedString(1);
            if (keyTag !== 'k') {
                throw new Error('Map key expected');
            }
            const keyLength = reader.readUInt32BE();
            const key = reader.readFixedString(keyLength);
            const val = LLSDBinary_1.LLSDBinary.parseValue(reader);
            map.add(key, val);
        }
        const endMap = reader.readFixedString(1);
        if (endMap !== '}') {
            throw new Error('Map end expected');
        }
        return map;
    }
    static parseXML(element) {
        const map = new LLSDMap();
        for (let x = 0; x < element.length; x++) {
            const key = element[x];
            const keys = Object.keys(key);
            if (keys.length !== 1) {
                throw new Error('Only one child of "key" expected');
            }
            if (keys[0] !== 'key') {
                throw new Error('Only one child of "key" expected');
            }
            const keyArr = key.key;
            if (keyArr.length !== 1) {
                throw new Error('Only one text element expected in key');
            }
            if (keyArr[0]['#text'] === undefined) {
                throw new Error('Key is missing');
            }
            const keyStr = String(keyArr[0]['#text']);
            x++;
            const valElement = element[x];
            const value = LLSDXML_1.LLSDXML.parseValue([valElement]);
            map.add(keyStr, value);
        }
        return map;
    }
    get length() {
        return Object.keys(this.___data).length;
    }
    get(key) {
        return this.___data.get(String(key));
    }
    toJSON() {
        return Object.fromEntries(this.___data);
    }
    add(key, value) {
        this.___data.set(key, value);
    }
    set(key, value) {
        this.add(key, value);
    }
    toNotation() {
        const builder = ['{'];
        let first = true;
        for (const key of this.___data.keys()) {
            if (first) {
                first = false;
            }
            else {
                builder.push(',');
            }
            const v = this.___data.get(key);
            if (v === undefined) {
                continue;
            }
            builder.push('"' + LLSDNotation_1.LLSDNotation.escapeStringSimple(String(key), '"') + '":');
            builder.push(LLSDNotation_1.LLSDNotation.encodeValue(v));
        }
        builder.push('}');
        return builder.join('');
    }
    toBinary(writer) {
        writer.writeFixedString('{');
        writer.writeUInt32BE(this.___data.size);
        for (const k of this.___data.keys()) {
            const v = this.___data.get(k);
            if (v === undefined) {
                continue;
            }
            writer.writeFixedString('k');
            writer.writeUInt32BE(Buffer.byteLength(String(k)));
            writer.writeFixedString(String(k));
            LLSDBinary_1.LLSDBinary.encodeValue(v, writer);
        }
        writer.writeFixedString('}');
    }
    toXML() {
        const val = {
            'map': []
        };
        for (const key of this.___data.keys()) {
            const llsdVal = this.___data.get(key);
            if (llsdVal === undefined) {
                continue;
            }
            val.map.push({
                'key': [{
                        '#text': String(key)
                    }]
            });
            val.map.push(LLSDXML_1.LLSDXML.encodeValue(llsdVal));
        }
        return val;
    }
    keys() {
        return Array.from(this.___data.keys());
    }
}
exports.LLSDMap = LLSDMap;
//# sourceMappingURL=LLSDMap.js.map