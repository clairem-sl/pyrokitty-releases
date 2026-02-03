"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;
const long_1 = __importDefault(require("long"));
const rxjs_1 = require("rxjs");
const xml2js = __importStar(require("xml2js"));
const zlib = __importStar(require("zlib"));
const FilterResponse_1 = require("../enums/FilterResponse");
const Quaternion_1 = require("./Quaternion");
const Vector3_1 = require("./Vector3");
const crypto = __importStar(require("crypto"));
class Utils {
    static TWO_PI = 6.283185307179586;
    static CUT_QUANTA = 0.00002;
    static SCALE_QUANTA = 0.01;
    static SHEAR_QUANTA = 0.01;
    static TAPER_QUANTA = 0.01;
    static REV_QUANTA = 0.015;
    static HOLLOW_QUANTA = 0.00002;
    static StringToBuffer(str) {
        return Buffer.from(str + '\0', 'utf8');
    }
    static SHA1String(str) {
        return crypto.createHash('sha1').update(str).digest('hex');
    }
    static MD5String(input) {
        const hash = crypto.createHash('md5');
        hash.update(input);
        return hash.digest('hex');
    }
    static BufferToStringSimple(buf) {
        if (buf.length === 0) {
            return '';
        }
        if (buf[buf.length - 1] === 0) {
            return buf.subarray(0, buf.length - 1).toString('utf8');
        }
        else {
            return buf.toString('utf8');
        }
    }
    static Clamp(value, min, max) {
        value = (value > max) ? max : value;
        value = (value < min) ? min : value;
        return value;
    }
    static fillArray(value, count) {
        const arr = new Array(count);
        while (count--) {
            arr[count] = value;
        }
        return arr;
    }
    static JSONStringify(obj, space) {
        const cache = [];
        return JSON.stringify(obj, function (_, value) {
            if (typeof value === 'object' && value !== null) {
                if (cache.includes(value)) {
                    try {
                        return JSON.parse(JSON.stringify(value));
                    }
                    catch (_error) {
                        return 'Circular Reference';
                    }
                }
                cache.push(value);
            }
            return value;
        }, space);
    }
    static BufferToString(buf, startPos) {
        if (buf.length === 0) {
            return {
                readLength: 0,
                result: ''
            };
        }
        if (startPos === undefined) {
            startPos = 0;
        }
        let foundNull = -1;
        for (let x = startPos; x <= buf.length; x++) {
            if (buf[x] === 0) {
                foundNull = x;
                break;
            }
        }
        if (foundNull === -1) {
            console.error('BufferToString: Null terminator not found after ' + (buf.length - startPos) + ' bytes. Buffer length: ' + buf.length + ', startPos: ' + startPos);
            foundNull = buf.length - 1;
        }
        return {
            readLength: (foundNull - startPos) + 1,
            result: buf.subarray(startPos, foundNull).toString('utf8')
        };
    }
    static RegionCoordinatesToHandle(regionX, regionY) {
        const realRegionX = Math.floor(regionX / 256) * 256;
        const realRegionY = Math.floor(regionY / 256) * 256;
        const localX = regionX - realRegionX;
        const localY = regionY - realRegionY;
        const handle = new long_1.default(realRegionY, realRegionX);
        return {
            'regionHandle': handle,
            'regionX': realRegionX / 256,
            'regionY': realRegionY / 256,
            'localX': localX,
            'localY': localY
        };
    }
    static FloatToByte(val, lower, upper) {
        val = Utils.Clamp(val, lower, upper);
        val -= lower;
        val /= (upper - lower);
        return Math.round(val * 255);
    }
    static ByteToFloat(byte, lower, upper) {
        const ONE_OVER_BYTEMAX = 1.0 / 255;
        let fval = byte * ONE_OVER_BYTEMAX;
        const delta = (upper - lower);
        fval *= delta;
        fval += lower;
        const error = delta * ONE_OVER_BYTEMAX;
        if (Math.abs(fval) < error) {
            fval = 0.0;
        }
        return fval;
    }
    static UInt16ToFloat(val, lower, upper, correctError = true) {
        const ONE_OVER_U16_MAX = 1.0 / 65535;
        let fval = val * ONE_OVER_U16_MAX;
        const delta = upper - lower;
        fval *= delta;
        fval += lower;
        if (correctError) {
            const maxError = delta * ONE_OVER_U16_MAX;
            if (Math.abs(fval) < maxError) {
                fval = 0.0;
            }
        }
        return fval;
    }
    static FloatToUInt16(val, lower, upper) {
        const U16_MAX = 65535;
        const delta = upper - lower;
        let normalized = (val - lower) / delta;
        normalized = Math.max(0, Math.min(1, normalized));
        return Math.round(normalized * U16_MAX);
    }
    static Base64EncodeString(str) {
        const buff = Buffer.from(str, 'utf8');
        return buff.toString('base64');
    }
    static Base64DecodeString(str) {
        const buff = Buffer.from(str, 'base64');
        return buff.toString('utf8');
    }
    static HexToLong(hex) {
        while (hex.length < 16) {
            hex = '0' + hex;
        }
        return new long_1.default(parseInt(hex.substring(8), 16), parseInt(hex.substring(0, 8), 16));
    }
    static ReadRotationFloat(buf, pos) {
        return ((buf[pos] | (buf[pos + 1] << 8)) / 32768.0) * Utils.TWO_PI;
    }
    static ReadGlowFloat(buf, pos) {
        return buf[pos] / 255;
    }
    static ReadOffsetFloat(buf, pos) {
        const offset = buf.readInt16LE(pos);
        return offset / 32767.0;
    }
    static TEOffsetShort(num) {
        num = Utils.Clamp(num, -1.0, 1.0);
        num *= 32767.0;
        return Math.round(num);
    }
    static IEEERemainder(x, y) {
        if (isNaN(x)) {
            return x; // IEEE 754-2008: NaN payload must be preserved
        }
        if (isNaN(y)) {
            return y; // IEEE 754-2008: NaN payload must be preserved
        }
        const regularMod = x % y;
        if (isNaN(regularMod)) {
            return NaN;
        }
        if (regularMod === 0) {
            if (Math.sign(x) < 0) {
                return -0;
            }
        }
        const alternativeResult = regularMod - (Math.abs(y) * Math.sign(x));
        if (Math.abs(alternativeResult) === Math.abs(regularMod)) {
            const divisionResult = x / y;
            const roundedResult = Math.round(divisionResult);
            if (Math.abs(roundedResult) > Math.abs(divisionResult)) {
                return alternativeResult;
            }
            else {
                return regularMod;
            }
        }
        if (Math.abs(alternativeResult) < Math.abs(regularMod)) {
            return alternativeResult;
        }
        else {
            return regularMod;
        }
    }
    static TERotationShort(rotation) {
        return Math.floor(((Utils.IEEERemainder(rotation, Utils.TWO_PI) / Utils.TWO_PI) * 32768.0) + 0.5);
    }
    static OctetsToUInt32BE(octets) {
        const buf = Buffer.allocUnsafe(4);
        let pos = 0;
        for (let x = octets.length - 4; x < octets.length; x++) {
            if (x >= 0) {
                buf.writeUInt8(octets[x], pos++);
            }
            else {
                pos++;
            }
        }
        return buf.readUInt32BE(0);
    }
    static OctetsToUInt32LE(octets) {
        const buf = Buffer.allocUnsafe(4);
        let pos = 0;
        for (let x = octets.length - 4; x < octets.length; x++) {
            if (x >= 0) {
                buf.writeUInt8(octets[x], pos++);
            }
            else {
                pos++;
            }
        }
        return buf.readUInt32LE(0);
    }
    static numberToFixedHex(num) {
        let str = num.toString(16);
        while (str.length < 8) {
            str = '0' + str;
        }
        return str;
    }
    static TEGlowByte(glow) {
        return (glow * 255.0);
    }
    static NumberToByteBuffer(num) {
        const buf = Buffer.allocUnsafe(1);
        buf.writeUInt8(num, 0);
        return buf;
    }
    static NumberToShortBuffer(num) {
        const buf = Buffer.allocUnsafe(2);
        buf.writeInt16LE(num, 0);
        return buf;
    }
    static NumberToFloatBuffer(num) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeFloatLE(num, 0);
        return buf;
    }
    static numberOrZero(num) {
        if (num === undefined) {
            return 0;
        }
        return num;
    }
    static vector3OrZero(vec) {
        if (vec === undefined) {
            return Vector3_1.Vector3.getZero();
        }
        return vec;
    }
    static quaternionOrZero(quat) {
        if (quat === undefined) {
            return Quaternion_1.Quaternion.getIdentity();
        }
        return quat;
    }
    static packBeginCut(beginCut) {
        return Math.round(beginCut / Utils.CUT_QUANTA);
    }
    static packEndCut(endCut) {
        return (50000 - Math.round(endCut / Utils.CUT_QUANTA));
    }
    static packPathScale(pathScale) {
        return (200 - Math.round(pathScale / Utils.SCALE_QUANTA));
    }
    static packPathShear(pathShear) {
        return Math.round(pathShear / Utils.SHEAR_QUANTA);
    }
    static packPathTwist(pathTwist) {
        return Math.round(pathTwist / Utils.SCALE_QUANTA);
    }
    static packPathTaper(pathTaper) {
        return Math.round(pathTaper / Utils.TAPER_QUANTA);
    }
    static packPathRevolutions(pathRevolutions) {
        return Math.round((pathRevolutions - 1) / Utils.REV_QUANTA);
    }
    static packProfileHollow(profileHollow) {
        return Math.round(profileHollow / Utils.HOLLOW_QUANTA);
    }
    static unpackBeginCut(beginCut) {
        return beginCut * Utils.CUT_QUANTA;
    }
    static unpackEndCut(endCut) {
        return (50000 - endCut) * Utils.CUT_QUANTA;
    }
    static unpackPathScale(pathScale) {
        return (200 - pathScale) * Utils.SCALE_QUANTA;
    }
    static unpackPathShear(pathShear) {
        return pathShear * Utils.SHEAR_QUANTA;
    }
    static unpackPathTwist(pathTwist) {
        return pathTwist * Utils.SCALE_QUANTA;
    }
    static unpackPathTaper(pathTaper) {
        return pathTaper * Utils.TAPER_QUANTA;
    }
    static unpackPathRevolutions(pathRevolutions) {
        return pathRevolutions * Utils.REV_QUANTA + 1;
    }
    static unpackProfileHollow(profileHollow) {
        return profileHollow * Utils.HOLLOW_QUANTA;
    }
    static nullTerminatedString(str) {
        const index = str.indexOf('\0');
        if (index === -1) {
            return str;
        }
        else {
            return str.substring(0, index - 1);
        }
    }
    static async promiseConcurrent(promises, concurrency, timeout) {
        const originalConcurrency = concurrency;
        const promiseQueue = [];
        for (const promise of promises) {
            promiseQueue.push(promise);
        }
        const slotAvailable = new rxjs_1.Subject();
        const errors = [];
        const results = [];
        async function waitForAvailable() {
            return new Promise((resolve1) => {
                const subs = slotAvailable.subscribe(() => {
                    subs.unsubscribe();
                    resolve1();
                });
            });
        }
        function runPromise(promise) {
            concurrency--;
            let timedOut = false;
            let timeo = undefined;
            promise().then((result) => {
                if (timedOut) {
                    return;
                }
                if (timeo !== undefined) {
                    clearTimeout(timeo);
                }
                results.push(result);
                concurrency++;
                slotAvailable.next();
            }).catch((err) => {
                if (timedOut) {
                    return;
                }
                if (timeo !== undefined) {
                    clearTimeout(timeo);
                }
                errors.push(err);
                concurrency++;
                slotAvailable.next();
            });
            if (timeout > 0) {
                timeo = setTimeout(() => {
                    timedOut = true;
                    errors.push(new Error('Promise timed out'));
                    concurrency++;
                    slotAvailable.next();
                }, timeout);
            }
        }
        while (promiseQueue.length > 0) {
            if (concurrency < 1) {
                await waitForAvailable();
            }
            else {
                const thunk = promiseQueue.shift();
                if (thunk !== undefined) {
                    runPromise(thunk);
                }
            }
        }
        while (concurrency < originalConcurrency) {
            await waitForAvailable();
        }
        return ({ results: results, errors: errors });
    }
    static async waitFor(timeout) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, timeout);
        });
    }
    static getFromXMLJS(obj, param) {
        if (obj[param] === undefined) {
            return undefined;
        }
        let retParam = '';
        if (Array.isArray(obj[param])) {
            retParam = obj[param][0];
        }
        else {
            retParam = obj[param];
        }
        if (typeof retParam === 'string') {
            if (retParam.toLowerCase() === 'false') {
                return false;
            }
            if (retParam.toLowerCase() === 'true') {
                return true;
            }
            const numVar = parseInt(retParam, 10);
            if (numVar >= Number.MIN_SAFE_INTEGER && numVar <= Number.MAX_SAFE_INTEGER && String(numVar) === retParam) {
                return numVar;
            }
        }
        return retParam;
    }
    static async inflate(buf) {
        return new Promise((resolve, reject) => {
            zlib.inflate(buf, (error, result) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve(result);
                }
            });
        });
    }
    static async deflate(buf) {
        return new Promise((resolve, reject) => {
            zlib.deflate(buf, { level: 9 }, (error, result) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve(result);
                }
            });
        });
    }
    static async waitOrTimeOut(subject, timeout, callback) {
        return new Promise((resolve, reject) => {
            let timer = undefined;
            let subs = undefined;
            subs = subject.subscribe((result) => {
                if (callback !== undefined) {
                    const accepted = callback(result);
                    if (accepted !== FilterResponse_1.FilterResponse.Finish) {
                        return;
                    }
                }
                if (timer !== undefined) {
                    clearTimeout(timer);
                    timer = undefined;
                }
                if (subs !== undefined) {
                    subs.unsubscribe();
                    subs = undefined;
                }
                resolve(result);
            });
            if (timeout !== undefined) {
                timer = setTimeout(() => {
                    if (timer !== undefined) {
                        clearTimeout(timer);
                        timer = undefined;
                    }
                    if (subs !== undefined) {
                        subs.unsubscribe();
                        subs = undefined;
                    }
                    reject(new Error('Timeout'));
                }, timeout);
            }
        });
    }
    static parseLine(line) {
        line = line.trim().replace(/[\t]/gu, ' ').trim();
        while (line.indexOf('\u0020\u0020') > 0) {
            line = line.replace(/\u0020\u0020/gu, '\u0020');
        }
        let key = null;
        let value = '';
        if (line.length > 2) {
            const sep = line.indexOf(' ');
            if (sep > 0) {
                key = line.substring(0, sep);
                value = line.substring(sep + 1);
            }
        }
        else if (line.length === 1) {
            key = line;
        }
        else if (line.length > 0) {
            return {
                'key': line,
                'value': ''
            };
        }
        if (key !== null) {
            key = key.trim();
        }
        return {
            'key': key,
            'value': value
        };
    }
    static sanitizePath(input) {
        return input.replace(/[^a-z0-9]/gi, '').replace(/ /gi, '_');
    }
    static async parseXML(input) {
        return new Promise((resolve, reject) => {
            xml2js.parseString(input, (err, result) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });
    }
    static getNotecardLine(lineObj) {
        const line = lineObj.lines[lineObj.lineNum++];
        lineObj.pos += Buffer.byteLength(line) + 1;
        return line.replace(/\r/, '').trim().replace(/[\t ]+/g, ' ');
    }
    static async sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, ms);
        });
    }
}
exports.Utils = Utils;
//# sourceMappingURL=Utils.js.map