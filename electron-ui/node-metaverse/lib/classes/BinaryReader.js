"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryReader = void 0;
const UUID_1 = require("./UUID");
class BinaryReader {
    buf;
    pos = 0;
    constructor(buf) {
        this.buf = buf;
    }
    seek(pos) {
        if (pos < 0 || pos > this.buf.length) {
            throw new RangeError(`Invalid seek position: ${pos}`);
        }
        this.pos = pos;
    }
    getPos() {
        return this.pos;
    }
    peekUInt8() {
        this.checkBounds(1);
        return this.buf.readUInt8(this.pos);
    }
    peekInt8() {
        this.checkBounds(1);
        return this.buf.readInt8(this.pos);
    }
    peekUInt16LE() {
        this.checkBounds(2);
        return this.buf.readUInt16LE(this.pos);
    }
    peekInt16LE() {
        this.checkBounds(2);
        return this.buf.readInt16LE(this.pos);
    }
    peekUInt16BE() {
        this.checkBounds(2);
        return this.buf.readUInt16BE(this.pos);
    }
    peekInt16BE() {
        this.checkBounds(2);
        return this.buf.readInt16BE(this.pos);
    }
    peekUInt32LE() {
        this.checkBounds(4);
        return this.buf.readUInt32LE(this.pos);
    }
    peekInt32LE() {
        this.checkBounds(4);
        return this.buf.readInt32LE(this.pos);
    }
    peekUInt32BE() {
        this.checkBounds(4);
        return this.buf.readUInt32BE(this.pos);
    }
    peekInt32BE() {
        this.checkBounds(4);
        return this.buf.readInt32BE(this.pos);
    }
    peekUInt64LE() {
        this.checkBounds(8);
        return this.buf.readBigUInt64LE(this.pos);
    }
    peekInt64LE() {
        this.checkBounds(8);
        return this.buf.readBigInt64LE(this.pos);
    }
    peekUInt64BE() {
        this.checkBounds(8);
        return this.buf.readBigUInt64BE(this.pos);
    }
    peekInt64BE() {
        this.checkBounds(8);
        return this.buf.readBigInt64BE(this.pos);
    }
    peekFloatLE() {
        this.checkBounds(4);
        return this.buf.readFloatLE(this.pos);
    }
    peekFloatBE() {
        this.checkBounds(4);
        return this.buf.readFloatBE(this.pos);
    }
    peekDoubleLE() {
        this.checkBounds(8);
        return this.buf.readDoubleLE(this.pos);
    }
    peekDoubleBE() {
        this.checkBounds(8);
        return this.buf.readDoubleBE(this.pos);
    }
    peekUUID() {
        this.checkBounds(16);
        return new UUID_1.UUID(this.buf, this.pos);
    }
    peekDate() {
        this.checkBounds(8);
        return new Date(Number(this.peekUInt64LE()));
    }
    peekBuffer(length) {
        if (this.pos + length > this.buf.length) {
            throw new RangeError("Attempt to read beyond buffer length");
        }
        return this.buf.subarray(this.pos, this.pos + length);
    }
    peekVarInt() {
        let value = 0n;
        let bytesRead = 0;
        let shift = 0n;
        while (this.pos + bytesRead < this.buf.length) {
            const byte = this.buf[this.pos + bytesRead];
            bytesRead++;
            const byteValue = BigInt(byte & 0x7F);
            value |= (byteValue << shift);
            if ((byte & 0x80) === 0) {
                break;
            }
            shift += 7n;
            if (bytesRead > 100) {
                throw new Error('VarInt is too long');
            }
        }
        if (bytesRead === 0 || (this.pos + bytesRead) > this.buf.length) {
            throw new Error('Incomplete VarInt');
        }
        const decoded = (value >> 1n) ^ -(value & 1n);
        if (decoded >= BigInt(Number.MIN_SAFE_INTEGER) &&
            decoded <= BigInt(Number.MAX_SAFE_INTEGER)) {
            return { value: Number(decoded), bytesRead };
        }
        else {
            return { value: decoded, bytesRead };
        }
    }
    peekString(metadata) {
        const { value: length, bytesRead } = this.peekVarInt();
        if (length < 0) {
            throw new Error('Error reading string: Length is negative');
        }
        this.checkBounds(bytesRead + Number(length));
        const start = this.pos + bytesRead;
        const end = start + Number(length);
        const stringData = this.buf.subarray(start, end);
        if (metadata) {
            metadata.length = length;
            metadata.bytesRead = bytesRead;
        }
        return new TextDecoder("utf-8").decode(stringData);
    }
    peekCString() {
        let tempPos = this.pos;
        const start = tempPos;
        while (tempPos < this.buf.length && this.buf[tempPos] !== 0) {
            tempPos++;
        }
        if (tempPos >= this.buf.length) {
            throw new RangeError("Null-terminated string not found");
        }
        const stringData = this.buf.subarray(start, tempPos);
        return new TextDecoder("utf-8").decode(stringData);
    }
    peekFixedString(length) {
        this.checkBounds(length);
        return this.buf.subarray(this.pos, this.pos + length).toString('utf-8');
    }
    // read
    readUInt8() {
        const num = this.peekUInt8();
        this.pos++;
        return num;
    }
    readInt8() {
        const num = this.peekInt8();
        this.pos++;
        return num;
    }
    readUInt16LE() {
        const num = this.peekUInt16LE();
        this.pos += 2;
        return num;
    }
    readInt16LE() {
        const num = this.peekInt16LE();
        this.pos += 2;
        return num;
    }
    readUInt16BE() {
        const num = this.peekUInt16BE();
        this.pos += 2;
        return num;
    }
    readInt16BE() {
        const num = this.peekInt16BE();
        this.pos += 2;
        return num;
    }
    readUInt32LE() {
        const num = this.peekUInt32LE();
        this.pos += 4;
        return num;
    }
    readInt32LE() {
        const num = this.peekInt32LE();
        this.pos += 4;
        return num;
    }
    readUInt32BE() {
        const num = this.peekUInt32BE();
        this.pos += 4;
        return num;
    }
    readInt32BE() {
        const num = this.peekInt32BE();
        this.pos += 4;
        return num;
    }
    readUInt64LE() {
        const num = this.peekUInt64LE();
        this.pos += 8;
        return num;
    }
    readInt64LE() {
        const num = this.peekInt64LE();
        this.pos += 8;
        return num;
    }
    readUInt64BE() {
        const num = this.peekUInt64BE();
        this.pos += 8;
        return num;
    }
    readInt64BE() {
        const num = this.peekInt64BE();
        this.pos += 8;
        return num;
    }
    readFloatLE() {
        const num = this.peekFloatLE();
        this.pos += 4;
        return num;
    }
    readFloatBE() {
        const num = this.peekFloatBE();
        this.pos += 4;
        return num;
    }
    readDoubleLE() {
        const num = this.peekDoubleLE();
        this.pos += 8;
        return num;
    }
    readDoubleBE() {
        const num = this.peekDoubleBE();
        this.pos += 8;
        return num;
    }
    readUUID() {
        const uuid = this.peekUUID();
        this.pos += 16;
        return uuid;
    }
    readDate() {
        const d = this.peekDate();
        this.pos += 8;
        return d;
    }
    readBuffer(length) {
        const buffer = this.peekBuffer(length);
        this.pos += length;
        return buffer;
    }
    readCString() {
        const str = this.peekCString();
        this.pos += Buffer.byteLength(str, "utf-8") + 1; // Include null terminator
        return str;
    }
    readString() {
        const md = {
            length: 0,
            bytesRead: 0
        };
        const str = this.peekString(md);
        this.pos += md.bytesRead + Number(md.length);
        return str;
    }
    readFixedString(length) {
        const str = this.peekFixedString(length);
        this.pos += length;
        return str;
    }
    length() {
        return this.buf.length;
    }
    readVarInt() {
        const { value, bytesRead } = this.peekVarInt();
        this.pos += bytesRead;
        return value;
    }
    checkBounds(length) {
        if (this.pos + length > this.buf.length) {
            throw new RangeError(`Attempt to read beyond buffer length: position=${this.pos}, length=${length}, bufferSize=${this.buf.length}`);
        }
    }
}
exports.BinaryReader = BinaryReader;
//# sourceMappingURL=BinaryReader.js.map