"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryWriter = void 0;
class BinaryWriter {
    segments = [];
    length() {
        let size = 0;
        for (const seg of this.segments) {
            size += seg.length;
        }
        return size;
    }
    writeBuffer(buf, start = 0, end = buf.length) {
        this.segments.push(buf.subarray(start, end));
    }
    writeVarInt(value) {
        // noinspection JSUnusedAssignment
        let n = 0n;
        if (typeof value === 'number') {
            n = BigInt(value);
        }
        else {
            n = value;
        }
        const encoded = (n << 1n) ^ (n < 0n ? -1n : 0n);
        const bytes = [];
        let remaining = encoded;
        while (remaining >= 0x80n) {
            bytes.push(Number((remaining & 0x7fn) | 0x80n));
            remaining >>= 7n;
        }
        bytes.push(Number(remaining));
        const encodedBuffer = Buffer.from(bytes);
        this.writeBuffer(encodedBuffer);
    }
    get() {
        return Buffer.concat(this.segments);
    }
    // Write Methods
    writeUInt8(value) {
        const buf = Buffer.allocUnsafe(1);
        buf.writeUInt8(value, 0);
        this.segments.push(buf);
    }
    writeInt8(value) {
        const buf = Buffer.allocUnsafe(1);
        buf.writeInt8(value, 0);
        this.segments.push(buf);
    }
    writeUInt16LE(value) {
        const buf = Buffer.allocUnsafe(2);
        buf.writeUInt16LE(value, 0);
        this.segments.push(buf);
    }
    writeInt16LE(value) {
        const buf = Buffer.allocUnsafe(2);
        buf.writeInt16LE(value, 0);
        this.segments.push(buf);
    }
    writeUInt16BE(value) {
        const buf = Buffer.allocUnsafe(2);
        buf.writeUInt16BE(value, 0);
        this.segments.push(buf);
    }
    writeInt16BE(value) {
        const buf = Buffer.allocUnsafe(2);
        buf.writeInt16BE(value, 0);
        this.segments.push(buf);
    }
    writeUInt32LE(value) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeUInt32LE(value, 0);
        this.segments.push(buf);
    }
    writeInt32LE(value) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeInt32LE(value, 0);
        this.segments.push(buf);
    }
    writeUInt32BE(value) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeUInt32BE(value, 0);
        this.segments.push(buf);
    }
    writeInt32BE(value) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeInt32BE(value, 0);
        this.segments.push(buf);
    }
    writeUInt64LE(value) {
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64LE(value, 0);
        this.segments.push(buf);
    }
    writeInt64LE(value) {
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigInt64LE(value, 0);
        this.segments.push(buf);
    }
    writeUInt64BE(value) {
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64BE(value, 0);
        this.segments.push(buf);
    }
    writeInt64BE(value) {
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigInt64BE(value, 0);
        this.segments.push(buf);
    }
    writeFloatLE(value) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeFloatLE(value, 0);
        this.segments.push(buf);
    }
    writeVector3F(vec) {
        const buf = Buffer.allocUnsafe(12);
        buf.writeFloatLE(vec.x, 0);
        buf.writeFloatLE(vec.y, 4);
        buf.writeFloatLE(vec.z, 8);
        this.segments.push(buf);
    }
    writeFloatBE(value) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeFloatBE(value, 0);
        this.segments.push(buf);
    }
    writeDoubleLE(value) {
        const buf = Buffer.allocUnsafe(8);
        buf.writeDoubleLE(value, 0);
        this.segments.push(buf);
    }
    writeDoubleBE(value) {
        const buf = Buffer.allocUnsafe(8);
        buf.writeDoubleBE(value, 0);
        this.segments.push(buf);
    }
    writeUUID(uuid) {
        const buf = uuid.getBuffer();
        if (buf.length !== 16) {
            throw new Error('UUID must be 16 bytes long');
        }
        this.segments.push(buf);
    }
    writeDate(date) {
        const timestamp = BigInt(date.getTime());
        this.writeUInt64LE(timestamp);
    }
    writeCString(str) {
        const strBuf = Buffer.from(str, 'utf-8');
        this.writeBuffer(strBuf);
        this.writeUInt8(0); // Null terminator
    }
    writeString(str) {
        const strBuf = Buffer.from(str, 'utf-8');
        this.writeVarInt(BigInt(strBuf.length));
        this.writeBuffer(strBuf);
    }
    writeFixedString(str, len) {
        const buf = Buffer.from(str, 'utf-8');
        if (len !== undefined) {
            if (buf.length > len) {
                this.writeBuffer(buf.subarray(0, len));
            }
            else if (buf.length < len) {
                const paddedBuffer = Buffer.alloc(len, 0);
                buf.copy(paddedBuffer);
                this.writeBuffer(paddedBuffer);
            }
            else {
                this.writeBuffer(buf);
            }
        }
        else {
            this.writeBuffer(buf);
        }
    }
    writeUUIDFromParts(timeLow, timeMid, timeHiAndVersion, clockSeq, node) {
        if (node.length !== 6) {
            throw new Error('Node must be 6 bytes long');
        }
        const buf = Buffer.allocUnsafe(16);
        buf.writeUInt32LE(timeLow, 0);
        buf.writeUInt16LE(timeMid, 4);
        buf.writeUInt16LE(timeHiAndVersion, 6);
        buf.writeUInt8((clockSeq >> 8) & 0xff, 8);
        buf.writeUInt8(clockSeq & 0xff, 9);
        node.copy(buf, 10);
        this.segments.push(buf);
    }
}
exports.BinaryWriter = BinaryWriter;
//# sourceMappingURL=BinaryWriter.js.map