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
exports.TarReader = void 0;
const TarFile_1 = require("./TarFile");
const TarArchive_1 = require("./TarArchive");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const uuid = __importStar(require("uuid"));
class TarReader {
    outFile;
    async parse(stream) {
        return new Promise((resolve, reject) => {
            let longName = false;
            let readState = 0; // 0 = waiting for header, 1 = reading file, 2 = padding, 3 = end of file
            let queuedChunks = [];
            let fileChunks = [];
            let queuedBytes = 0;
            let remainingBytes = 0;
            let longNameStr = undefined;
            let fileSize = 0;
            let paddingSize = 0;
            let pos = 0;
            const archive = new TarArchive_1.TarArchive();
            this.outFile = path.resolve(os.tmpdir() + '/' + uuid.v4() + '.tar');
            const outStream = fs.openSync(this.outFile, 'w');
            stream.on('data', (chunk) => {
                fs.writeSync(outStream, chunk);
                let goAgain = false;
                do {
                    goAgain = false;
                    if (readState === 1) {
                        if (chunk.length > remainingBytes) {
                            const wantedBytes = chunk.length - remainingBytes;
                            if (longName) {
                                fileChunks.push(chunk.subarray(0, chunk.length - wantedBytes));
                            }
                            queuedChunks = [chunk.subarray(chunk.length - wantedBytes)];
                            queuedBytes = queuedChunks[0].length;
                            remainingBytes = 0;
                        }
                        else {
                            remainingBytes -= chunk.length;
                            if (longName) {
                                fileChunks.push(chunk);
                            }
                        }
                    }
                    else {
                        queuedChunks.push(chunk);
                        queuedBytes += chunk.length;
                    }
                    if (readState === 0) {
                        if (queuedBytes >= 512) {
                            const buf = Buffer.concat(queuedChunks);
                            const header = buf.subarray(0, 512);
                            queuedChunks = [buf.subarray(512)];
                            queuedBytes = queuedChunks[0].length;
                            let hdrFileName = this.trimEntry(header.subarray(0, 100));
                            console.log('Filename: ' + hdrFileName);
                            const hdrFileMode = this.decodeOctal(header.subarray(100, 100 + 8));
                            const hdrUserID = this.decodeOctal(header.subarray(108, 108 + 8));
                            const hdrGroupID = this.decodeOctal(header.subarray(116, 116 + 8));
                            fileSize = this.decodeOctal(header.subarray(124, 124 + 12));
                            const hdrModifyTime = this.decodeOctal(header.subarray(136, 136 + 12));
                            const checksum = this.decodeOctal(header.subarray(148, 148 + 8));
                            const linkIndicator = header[156];
                            const linkedFile = this.trimEntry(header.subarray(157, 157 + 100));
                            paddingSize = (Math.ceil(fileSize / 512) * 512) - fileSize;
                            // Check CRC
                            let sum = 8 * 32;
                            for (let x = 0; x < 512; x++) {
                                if (x < 148 || x > 155) {
                                    sum += header[x];
                                }
                            }
                            if (sum !== checksum) {
                                readState = 3;
                                continue;
                            }
                            if (linkIndicator === 76) {
                                longName = true;
                            }
                            else {
                                if (longNameStr !== undefined) {
                                    hdrFileName = longNameStr;
                                    longNameStr = undefined;
                                    longName = false;
                                }
                                const file = new TarFile_1.TarFile();
                                file.archiveFile = this.outFile;
                                file.fileName = hdrFileName;
                                file.fileMode = hdrFileMode;
                                file.userID = hdrUserID;
                                file.groupID = hdrGroupID;
                                file.modifyTime = new Date(hdrModifyTime * 1000);
                                file.linkIndicator = linkIndicator;
                                file.linkedFile = linkedFile;
                                file.offset = pos + 512;
                                file.fileSize = fileSize;
                                archive.files.push(file);
                            }
                            remainingBytes = fileSize;
                            readState = 1;
                            goAgain = true;
                            chunk = queuedChunks[0];
                            queuedBytes = 0;
                            queuedChunks = [];
                            pos += 512;
                            continue;
                        }
                    }
                    if (readState === 1 && remainingBytes === 0) {
                        if (longName) {
                            longNameStr = Buffer.concat(fileChunks).toString('ascii');
                            fileChunks = [];
                        }
                        pos += fileSize;
                        readState = 2;
                    }
                    if (readState === 2 && queuedBytes >= paddingSize) {
                        const buf = Buffer.concat(queuedChunks);
                        queuedChunks = [buf.subarray(paddingSize)];
                        queuedBytes = queuedChunks[0].length;
                        readState = 0;
                        chunk = Buffer.alloc(0);
                        goAgain = true;
                        pos += paddingSize;
                    }
                } while (goAgain);
            }).on('end', () => {
                if ((readState !== 0 && readState !== 3) || queuedBytes > 0) {
                    console.warn('Warning: Garbage at end of file');
                }
                fs.closeSync(outStream);
                resolve(archive);
            }).on('error', (err) => {
                reject(err);
            });
        });
    }
    close() {
        fs.unlinkSync(this.outFile);
        this.outFile = '';
    }
    trimEntry(buf) {
        let end = buf.indexOf('\0');
        if (end === -1) {
            end = buf.length - 1;
        }
        return buf.subarray(0, end).toString('ascii');
    }
    decodeOctal(buf) {
        const str = this.trimEntry(buf);
        return parseInt(str, 8);
    }
}
exports.TarReader = TarReader;
//# sourceMappingURL=TarReader.js.map