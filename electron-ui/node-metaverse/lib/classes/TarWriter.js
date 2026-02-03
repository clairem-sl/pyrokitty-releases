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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TarWriter = void 0;
const fs = __importStar(require("fs"));
const stream_1 = require("stream");
class TarWriter extends stream_1.Transform {
    thisFileSize = 0;
    fileActive = false;
    async newFile(archivePath, realPath) {
        if (this.fileActive) {
            await this.endFile();
        }
        const stat = fs.statSync(realPath);
        const buf = Buffer.from(archivePath, 'ascii');
        await this.writeHeader(this.chopString('././@LongName', 100), stat.mode, stat.uid, stat.gid, buf.length, stat.mtime, 'L');
        this.thisFileSize = buf.length;
        await this.pipeFromBuffer(buf);
        await this.endFile();
        await this.writeHeader(this.chopString(archivePath, 100), stat.mode, stat.uid, stat.gid, stat.size, stat.mtime, '0');
        this.thisFileSize = stat.size;
        this.fileActive = true;
    }
    async pipeFromBuffer(buf) {
        const readableInstanceStream = new stream_1.Readable({
            read() {
                this.push(buf);
                this.push(null);
            }
        });
        return this.pipeFrom(readableInstanceStream);
    }
    async pipeFrom(str) {
        return new Promise((resolve, reject) => {
            str.on('error', (err) => {
                reject(err);
            });
            str.on('end', () => {
                resolve();
            });
            str.pipe(this, { end: false });
        });
    }
    async endFile() {
        const finalSize = Math.ceil(this.thisFileSize / 512) * 512;
        const remainingSize = finalSize - this.thisFileSize;
        const buf = Buffer.alloc(remainingSize);
        await this.pipeFromBuffer(buf);
        this.fileActive = false;
    }
    _transform(chunk, encoding, callback) {
        this.push(chunk, encoding);
        callback();
    }
    async writeHeader(fileName, mode, uid, gid, fileSize, mTime, fileType) {
        const header = Buffer.alloc(512);
        const name = this.chopString(fileName, 100);
        header.write(name, 0, (name.length <= 100 ? name.length : 100));
        this.octalBuf(mode, 8).copy(header, 100);
        this.octalBuf(uid, 8).copy(header, 108);
        this.octalBuf(gid, 8).copy(header, 116);
        this.octalBuf(fileSize, 12).copy(header, 124);
        this.octalBuf(Math.floor(mTime.getTime() / 1000), 12).copy(header, 136);
        header.write(fileType, 156, 1);
        let sum = 8 * 32;
        for (let x = 0; x < 512; x++) {
            if (x < 148 || x > 155) {
                sum += header.readUInt8(x);
            }
        }
        let sumStr = this.octalString(sum, 6);
        while (sumStr.length < 6) {
            sumStr = '0' + sumStr;
        }
        sumStr += '\0 ';
        header.write(sumStr, 148, sumStr.length);
        return this.pipeFromBuffer(header);
    }
    chopString(str, maxLength) {
        return str.substring(0, maxLength - 1);
    }
    octalBuf(num, length) {
        const buf = Buffer.alloc(length - 1, '0');
        const result = this.chopString(Math.floor(num).toString(8), length);
        buf.write(result, length - (result.length + 1), result.length);
        return buf;
    }
    octalString(num, length) {
        return this.octalBuf(num, length).toString('ascii');
    }
}
exports.TarWriter = TarWriter;
//# sourceMappingURL=TarWriter.js.map