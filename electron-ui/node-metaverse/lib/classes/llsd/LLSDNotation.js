"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSDNotation = void 0;
const LLSDTokenType_1 = require("./LLSDTokenType");
const LLSDMap_1 = require("./LLSDMap");
const UUID_1 = require("../UUID");
const LLSDArray_1 = require("./LLSDArray");
const LLSDInteger_1 = require("./LLSDInteger");
const LLSDReal_1 = require("./LLSDReal");
const LLSDURI_1 = require("./LLSDURI");
class LLSDNotation {
    static tokenSpecs = [
        { regex: /^\s+/, type: LLSDTokenType_1.LLSDTokenType.Whitespace },
        { regex: /^!/, type: LLSDTokenType_1.LLSDTokenType.Null },
        { regex: /^\{/, type: LLSDTokenType_1.LLSDTokenType.MapStart },
        { regex: /^}/, type: LLSDTokenType_1.LLSDTokenType.MapEnd },
        { regex: /^:/, type: LLSDTokenType_1.LLSDTokenType.Colon },
        { regex: /^,/, type: LLSDTokenType_1.LLSDTokenType.Comma },
        { regex: /^\[/, type: LLSDTokenType_1.LLSDTokenType.ArrayStart },
        { regex: /^]/, type: LLSDTokenType_1.LLSDTokenType.ArrayEnd },
        { regex: /^(?:true|false|TRUE|FALSE|1|0|T|F|t|f)/, type: LLSDTokenType_1.LLSDTokenType.Boolean },
        { regex: /^i(-?[0-9]+)/, type: LLSDTokenType_1.LLSDTokenType.Integer },
        { regex: /^r(-?[0-9.]+(?:[eE]-?[0-9]+)?)/, type: LLSDTokenType_1.LLSDTokenType.Real },
        { regex: /^rNaN/, type: LLSDTokenType_1.LLSDTokenType.Real },
        { regex: /^rInfinity/, type: LLSDTokenType_1.LLSDTokenType.Real },
        { regex: /^r-Infinity/, type: LLSDTokenType_1.LLSDTokenType.Real },
        { regex: /^u([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/, type: LLSDTokenType_1.LLSDTokenType.UUID },
        { regex: /^'([^'\\]*(?:\\.[^'\\\n]*)*)'/, type: LLSDTokenType_1.LLSDTokenType.StringFixedSingle },
        { regex: /^"([^"\\]*(?:\\.[^"\\\n]*)*)"/, type: LLSDTokenType_1.LLSDTokenType.StringFixedDouble },
        { regex: /^s\(([0-9]+)\)"/, type: LLSDTokenType_1.LLSDTokenType.StringDynamicStart },
        { regex: /^l"([^"]*?)"/, type: LLSDTokenType_1.LLSDTokenType.URI },
        { regex: /^d"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+Z)"/, type: LLSDTokenType_1.LLSDTokenType.Date },
        { regex: /^b[0-9]{2}"[0-9a-zA-Z+/=]*?"/, type: LLSDTokenType_1.LLSDTokenType.BinaryStatic },
        { regex: /^b\(([0-9]+)\)"/, type: LLSDTokenType_1.LLSDTokenType.BinaryDynamicStart }
    ];
    static parseValueToken(gen, initialToken) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while (true) {
            let t = undefined;
            if (initialToken !== undefined) {
                t = initialToken;
                initialToken = undefined;
            }
            else {
                t = gen();
                if (t === undefined) {
                    throw new Error('Unexpected end of input');
                }
            }
            switch (t.type) {
                case LLSDTokenType_1.LLSDTokenType.Unknown:
                    {
                        throw new Error('Unexpected token: ' + t.value);
                    }
                case LLSDTokenType_1.LLSDTokenType.Null:
                    {
                        return null;
                    }
                case LLSDTokenType_1.LLSDTokenType.Boolean:
                    {
                        return t.value === 'true' || t.value === 'TRUE' || t.value === 'T' || t.value === 't' || t.value === '1';
                    }
                case LLSDTokenType_1.LLSDTokenType.Integer:
                    {
                        return new LLSDInteger_1.LLSDInteger(parseInt(t.value, 10));
                    }
                case LLSDTokenType_1.LLSDTokenType.Real:
                    {
                        return new LLSDReal_1.LLSDReal(t.value);
                    }
                case LLSDTokenType_1.LLSDTokenType.UUID:
                    {
                        return new UUID_1.UUID(t.value);
                    }
                case LLSDTokenType_1.LLSDTokenType.StringFixedSingle:
                    {
                        return this.unescapeStringSimple(t.value, '\'');
                    }
                case LLSDTokenType_1.LLSDTokenType.StringFixedDouble:
                    {
                        return this.unescapeStringSimple(t.value, '"');
                    }
                case LLSDTokenType_1.LLSDTokenType.URI:
                    {
                        return new LLSDURI_1.LLSDURI(t.value);
                    }
                case LLSDTokenType_1.LLSDTokenType.Date:
                    {
                        return new Date(t.value);
                    }
                case LLSDTokenType_1.LLSDTokenType.BinaryStatic:
                    {
                        const b = /^b([0-9]{2})"([0-9a-zA-Z+/=]*?)"/.exec(t.value);
                        if (b === null || b.length < 3) {
                            throw new Error('Invalid BINARY_STATIC');
                        }
                        const base = parseInt(b[1], 10);
                        if (base !== 16 && base !== 64) {
                            throw new Error('Unsupported base ' + String(base));
                        }
                        return Buffer.from(b[2], base === 64 ? 'base64' : 'hex');
                    }
                case LLSDTokenType_1.LLSDTokenType.StringDynamicStart:
                    {
                        const length = parseInt(t.value, 10);
                        const s = t.dataContainer.input.slice(t.dataContainer.index, t.dataContainer.index + length);
                        t.dataContainer.index += length;
                        if (t.dataContainer.input[t.dataContainer.index] !== '"') {
                            throw new Error('Expected " at end of dynamic string');
                        }
                        t.dataContainer.index += 1;
                        return s;
                    }
                case LLSDTokenType_1.LLSDTokenType.BinaryDynamicStart:
                    {
                        const length = parseInt(t.value, 10);
                        const s = t.dataContainer.input.slice(t.dataContainer.index, t.dataContainer.index + length);
                        t.dataContainer.index += length;
                        if (t.dataContainer.input[t.dataContainer.index] !== '"') {
                            throw new Error('Expected " at end of dynamic binary string');
                        }
                        t.dataContainer.index += 1;
                        return Buffer.from(s, 'binary');
                    }
                case LLSDTokenType_1.LLSDTokenType.MapStart:
                    {
                        return LLSDMap_1.LLSDMap.parseNotation(gen);
                    }
                case LLSDTokenType_1.LLSDTokenType.ArrayStart:
                    {
                        return LLSDArray_1.LLSDArray.parseNotation(gen);
                    }
                case LLSDTokenType_1.LLSDTokenType.MapEnd:
                case LLSDTokenType_1.LLSDTokenType.Colon:
                case LLSDTokenType_1.LLSDTokenType.Comma:
                case LLSDTokenType_1.LLSDTokenType.ArrayEnd:
                case LLSDTokenType_1.LLSDTokenType.Whitespace:
                    break;
            }
        }
    }
    static *tokenize(input) {
        const dataContainer = {
            input: input,
            index: 0
        };
        while (dataContainer.index < dataContainer.input.length) {
            const currentInput = dataContainer.input.slice(dataContainer.index);
            if (currentInput.length === 0) {
                return; // End of input
            }
            let matched = false;
            for (const { regex, type } of this.tokenSpecs) {
                const tokenMatch = currentInput.match(regex);
                if (tokenMatch) {
                    matched = true;
                    let [value] = tokenMatch;
                    if (tokenMatch.length > 1) {
                        value = tokenMatch[tokenMatch.length - 1];
                    }
                    dataContainer.index += tokenMatch[0].length; // Move past this token
                    yield { type, value, rawValue: tokenMatch[0], dataContainer };
                    break;
                }
            }
            if (!matched) {
                dataContainer.index++;
                yield {
                    type: LLSDTokenType_1.LLSDTokenType.Unknown,
                    value: dataContainer.input[dataContainer.index - 1],
                    rawValue: dataContainer.input[dataContainer.index - 1],
                    dataContainer
                };
            }
        }
    }
    static encodeValue(value) {
        if (value instanceof LLSDMap_1.LLSDMap) {
            return value.toNotation();
        }
        else if (value instanceof LLSDInteger_1.LLSDInteger) {
            return 'i' + value.valueOf();
        }
        else if (value instanceof LLSDReal_1.LLSDReal) {
            const v = value.valueOf();
            if (isNaN(v)) {
                return 'rNaN';
            }
            else if (v === -Infinity) {
                return 'r-Infinity';
            }
            else if (v === Infinity) {
                return 'rInfinity';
            }
            else if (Object.is(v, -0)) {
                return 'r-0';
            }
            return 'r' + v;
        }
        else if (value instanceof UUID_1.UUID) {
            return 'u' + value.toString();
        }
        else if (value instanceof LLSDURI_1.LLSDURI) {
            return 'l"' + this.escapeStringSimple(value.toString(), '"') + '"';
        }
        else if (value instanceof Buffer) {
            return 'b64"' + value.toString('base64') + '"';
        }
        else if (value instanceof Date) {
            return 'd"' + value.toISOString() + '"';
        }
        else if (value === null) {
            return '!';
        }
        else if (value === true) {
            return '1';
        }
        else if (value === false) {
            return '0';
        }
        else if (typeof value === 'string') {
            return '"' + this.escapeStringSimple(value, '"') + '"';
        }
        else if (Array.isArray(value)) {
            return LLSDArray_1.LLSDArray.toNotation(value);
        }
        else {
            throw new Error('Unknown type: ' + String(value));
        }
    }
    static escapeStringSimple(input, quote) {
        if (quote.length !== 1) {
            throw new Error('Quote must be a single character');
        }
        const escapeRegex = new RegExp(`[${quote}\x00-\x1F\x7F\\\\]`, 'g');
        return input.replace(escapeRegex, (char) => {
            if (char === "\\") {
                return "\\\\";
            }
            else if (char === quote) {
                return '\\' + quote;
            }
            const hex = char.charCodeAt(0).toString(16).padStart(2, "0");
            return `\\x${hex}`;
        });
    }
    static unescapeStringSimple(input, quote) {
        if (quote.length !== 1) {
            throw new Error("Quote parameter must be a single character.");
        }
        // Create a regex that matches \\, \quote, or \xHH
        const unescapeRegex = new RegExp(`\\\\(\\\\|${quote}|x[0-9A-Fa-f]{2})`, 'g');
        return input.replace(unescapeRegex, (match, p1) => {
            if (p1 === "\\") {
                return "\\";
            }
            if (p1 === quote) {
                return quote;
            }
            if (p1.startsWith('x')) {
                const hex = p1.slice(1);
                const charCode = parseInt(hex, 16);
                if (isNaN(charCode)) {
                    return match;
                }
                return String.fromCharCode(charCode);
            }
            return match;
        });
    }
}
exports.LLSDNotation = LLSDNotation;
//# sourceMappingURL=LLSDNotation.js.map