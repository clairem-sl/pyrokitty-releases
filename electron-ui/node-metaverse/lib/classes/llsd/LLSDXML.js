"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSDXML = void 0;
const LLSDMap_1 = require("./LLSDMap");
const LLSDArray_1 = require("./LLSDArray");
const LLSDInteger_1 = require("./LLSDInteger");
const LLSDReal_1 = require("./LLSDReal");
const UUID_1 = require("../UUID");
const LLSDURI_1 = require("./LLSDURI");
class LLSDXML {
    static parseValue(element) {
        if (element.length !== 1) {
            throw new Error('Exactly one key expected');
        }
        const keys = Object.keys(element[0]);
        switch (keys[0]) {
            case 'map':
                {
                    return LLSDMap_1.LLSDMap.parseXML(element[0].map);
                }
            case 'string':
                {
                    const strNode = element[0].string;
                    if (strNode.length !== 1) {
                        return '';
                    }
                    const [node] = strNode;
                    if (node['#text'] === undefined) {
                        throw new Error('String is not a text node');
                    }
                    return String(node['#text']);
                }
            case 'uuid':
                {
                    const strNode = element[0].uuid;
                    if (strNode.length !== 1) {
                        return UUID_1.UUID.zero();
                    }
                    const [node] = strNode;
                    if (node['#text'] === undefined) {
                        throw new Error('UUID is not a text node');
                    }
                    return new UUID_1.UUID(String(node['#text']));
                }
            case 'uri':
                {
                    const strNode = element[0].uri;
                    if (strNode.length !== 1) {
                        return new LLSDURI_1.LLSDURI('');
                    }
                    const [node] = strNode;
                    if (node['#text'] === undefined) {
                        throw new Error('URI is not a text node');
                    }
                    return new LLSDURI_1.LLSDURI(String(node['#text']));
                }
            case 'date':
                {
                    const strNode = element[0].date;
                    if (strNode.length !== 1) {
                        return new Date(0);
                    }
                    const [node] = strNode;
                    if (node['#text'] === undefined) {
                        throw new Error('Date is not a text node');
                    }
                    return new Date(String(node['#text']));
                }
            case 'undef':
                {
                    return null;
                }
            case 'binary':
                {
                    const strNode = element[0].binary;
                    if (strNode.length !== 1) {
                        return Buffer.alloc(0);
                    }
                    const [node] = strNode;
                    if (node['#text'] === undefined) {
                        throw new Error('Binary is not a text node');
                    }
                    return Buffer.from(String(node['#text']), 'base64');
                }
            case 'boolean':
                {
                    const strNode = element[0].boolean;
                    if (strNode.length !== 1) {
                        return false;
                    }
                    const [node] = strNode;
                    if (node['#text'] === undefined) {
                        throw new Error('Boolean is not a text node');
                    }
                    const val = String(node['#text']);
                    return val.toLowerCase() === '1' || val === 'true';
                }
            case 'integer':
                {
                    const strNode = element[0].integer;
                    if (strNode.length !== 1) {
                        return new LLSDInteger_1.LLSDInteger(0);
                    }
                    const [node] = strNode;
                    if (node['#text'] === undefined) {
                        throw new Error('Integer is not a text node');
                    }
                    return new LLSDInteger_1.LLSDInteger(parseInt(String(node['#text']), 10));
                }
            case 'real':
                {
                    const strNode = element[0].real;
                    if (strNode.length !== 1) {
                        return new LLSDReal_1.LLSDReal(0);
                    }
                    const [node] = strNode;
                    if (node['#text'] === undefined) {
                        throw new Error('Real is not a text node');
                    }
                    return new LLSDReal_1.LLSDReal(String(node['#text']));
                }
            case 'array':
                {
                    return LLSDArray_1.LLSDArray.parseXML(element[0].array);
                }
            default:
                throw new Error('Unexpected XML element: ' + keys[0]);
        }
    }
    static encodeValue(value) {
        if (value instanceof LLSDMap_1.LLSDMap) {
            return value.toXML();
        }
        else if (value instanceof LLSDInteger_1.LLSDInteger) {
            return {
                'integer': [{
                        '#text': value.valueOf()
                    }]
            };
        }
        else if (value instanceof LLSDReal_1.LLSDReal) {
            const val = value.valueOf();
            if (isNaN(val)) {
                return {
                    'real': [{
                            '#text': 'NaNQ'
                        }]
                };
            }
            else if (val === -Infinity) {
                return {
                    'real': [{
                            '#text': '-Infinity'
                        }]
                };
            }
            else if (val === Infinity) {
                return {
                    'real': [{
                            '#text': '+Infinity'
                        }]
                };
            }
            else if (Object.is(val, -0)) {
                return {
                    'real': [{
                            '#text': '-Zero'
                        }]
                };
            }
            else if (val === 0) {
                return {
                    'real': [{
                            '#text': '+Zero'
                        }]
                };
            }
            return {
                'real': [{
                        '#text': val
                    }]
            };
        }
        else if (value instanceof UUID_1.UUID) {
            return {
                'uuid': [{
                        '#text': value.toString()
                    }]
            };
        }
        else if (value instanceof LLSDURI_1.LLSDURI) {
            return {
                'uri': [{
                        '#text': value.valueOf()
                    }]
            };
        }
        else if (value instanceof Buffer) {
            return {
                'binary': [{
                        '#text': value.toString('base64')
                    }]
            };
        }
        else if (value instanceof Date) {
            return {
                'date': [{
                        '#text': value.toISOString()
                    }]
            };
        }
        else if (value === null) {
            return {
                'undef': []
            };
        }
        else if (value === true) {
            return {
                'boolean': [{
                        '#text': true
                    }]
            };
        }
        else if (value === false) {
            return {
                'boolean': []
            };
        }
        else if (typeof value === 'string') {
            return {
                'string': [{
                        '#text': value.toString()
                    }]
            };
        }
        else if (Array.isArray(value)) {
            return LLSDArray_1.LLSDArray.toXML(value);
        }
        else {
            throw new Error('Unknown type: ' + String(value));
        }
    }
}
exports.LLSDXML = LLSDXML;
//# sourceMappingURL=LLSDXML.js.map