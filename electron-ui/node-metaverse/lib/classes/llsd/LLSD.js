"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSD = void 0;
const LLSDNotation_1 = require("./LLSDNotation");
const BinaryReader_1 = require("../BinaryReader");
const LLSDBinary_1 = require("./LLSDBinary");
const fast_xml_parser_1 = require("fast-xml-parser");
const LLSDXML_1 = require("./LLSDXML");
const BinaryWriter_1 = require("../BinaryWriter");
const LLSDMap_1 = require("./LLSDMap");
const UUID_1 = require("../UUID");
const LLSDInteger_1 = require("./LLSDInteger");
const LLSDReal_1 = require("./LLSDReal");
const LLSDURI_1 = require("./LLSDURI");
const validator_1 = require("validator");
class LLSD {
    static parseNotation(input) {
        const tags = [
            '<?llsd/notation?>',
            '<? llsd/notation ?>'
        ];
        for (const tag of tags) {
            if (input.startsWith(tag)) {
                input = input.substring(tag.length + 1);
                break;
            }
        }
        const generator = LLSDNotation_1.LLSDNotation.tokenize(input);
        const getToken = () => {
            return generator.next().value;
        };
        return LLSDNotation_1.LLSDNotation.parseValueToken(getToken);
    }
    static parseBinary(input, metadata) {
        const reader = new BinaryReader_1.BinaryReader(input);
        const tags = [
            '<? LLSD/Binary ?>\n',
            '<?llsd/binary?>\n'
        ];
        for (const tag of tags) {
            if (reader.length() > tag.length && reader.peekBuffer(tag.length).toString('utf-8') === tag) {
                reader.seek(tag.length);
                break;
            }
        }
        const val = LLSDBinary_1.LLSDBinary.parseValue(reader);
        if (metadata) {
            metadata.readPos = reader.getPos();
        }
        return val;
    }
    static toNotation(element, header = true) {
        return (header ? '<? llsd/notation ?>\n' : '') + LLSDNotation_1.LLSDNotation.encodeValue(element);
    }
    static toBinary(element) {
        const writer = new BinaryWriter_1.BinaryWriter();
        LLSDBinary_1.LLSDBinary.encodeValue(element, writer);
        return writer.get();
    }
    static toXML(element) {
        const writer = new fast_xml_parser_1.XMLBuilder({ preserveOrder: true, suppressEmptyNode: true });
        const val = LLSDXML_1.LLSDXML.encodeValue(element);
        const toEncode = [{
                llsd: [val]
            }];
        return writer.build(toEncode);
    }
    static parseXML(input) {
        const parser = new fast_xml_parser_1.XMLParser({ preserveOrder: true });
        const obj = parser.parse(input);
        if (obj.length !== 1) {
            throw new Error('Expected only one root element');
        }
        if (obj[0].llsd === undefined) {
            throw new Error('Expected LLSD element');
        }
        const llsd = obj[0].llsd;
        return LLSDXML_1.LLSDXML.parseValue(llsd);
    }
    static toLLSD(input) {
        if (typeof input === 'string') {
            return input;
        }
        else if (input instanceof Buffer) {
            return input;
        }
        else if (input instanceof Date) {
            return input;
        }
        else if (input instanceof UUID_1.UUID) {
            return input;
        }
        else if (input instanceof LLSDMap_1.LLSDMap) {
            return input;
        }
        else if (input instanceof LLSDInteger_1.LLSDInteger) {
            return input;
        }
        else if (input instanceof LLSDReal_1.LLSDReal) {
            return input;
        }
        else if (input instanceof LLSDURI_1.LLSDURI) {
            return input;
        }
        else if (typeof input === 'number') {
            if ((0, validator_1.isInt)(String(input))) {
                return new LLSDInteger_1.LLSDInteger(input);
            }
            else if ((0, validator_1.isFloat)(String(input))) {
                return new LLSDReal_1.LLSDReal(input);
            }
            else {
                throw new Error('Unable to convert number type ' + input);
            }
        }
        else if (typeof input === 'boolean') {
            return input;
        }
        else if (input === null) {
            return null;
        }
        else if (Array.isArray(input)) {
            const arr = [];
            for (const item of input) {
                arr.push(LLSD.toLLSD(item));
            }
            return arr;
        }
        else if (typeof input === 'object') {
            const keys = Object.keys(input);
            const obj = new LLSDMap_1.LLSDMap();
            for (const k of keys) {
                const value = input[k];
                obj.add(k, LLSD.toLLSD(value));
            }
            return obj;
        }
        throw new Error('Cannot convert type ' + typeof input + ' to LLSD');
    }
}
exports.LLSD = LLSD;
//# sourceMappingURL=LLSD.js.map