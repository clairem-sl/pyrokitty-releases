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
exports.Packet = void 0;
const Zerocoder_1 = require("./Zerocoder");
const MessageClass = __importStar(require("./MessageClasses"));
const MessageClasses_1 = require("./MessageClasses");
const MessageFlags_1 = require("../enums/MessageFlags");
const PacketFlags_1 = require("../enums/PacketFlags");
class Packet {
    packetFlags = 0;
    sequenceNumber = 0;
    extraHeader = Buffer.allocUnsafe(0);
    message;
    getSize() {
        let idSize = 4;
        if (this.message.messageFlags & MessageFlags_1.MessageFlags.FrequencyHigh) {
            idSize = 1;
        }
        else if (this.message.messageFlags & MessageFlags_1.MessageFlags.FrequencyMedium) {
            idSize = 2;
        }
        return 1 + 4 + 1 + this.extraHeader.length + idSize + this.message.getSize();
    }
    writeToBuffer(buf, pos, options) {
        if (options === undefined) {
            options = 0;
        }
        if (this.message.messageFlags & MessageFlags_1.MessageFlags.Zerocoded && !((options ?? 0) & 1)) {
            this.packetFlags = this.packetFlags | PacketFlags_1.PacketFlags.Zerocoded;
        }
        buf.writeUInt8(this.packetFlags, pos++);
        buf.writeUInt32BE(this.sequenceNumber, pos);
        pos = pos + 4;
        buf.writeUInt8(this.extraHeader.length, pos++);
        if (this.extraHeader.length > 0) {
            this.extraHeader.copy(buf, pos);
            pos += this.extraHeader.length;
        }
        const bodyStart = pos;
        if (this.message.messageFlags & MessageFlags_1.MessageFlags.FrequencyHigh) {
            buf.writeUInt8(this.message.id, pos++);
        }
        else if (this.message.messageFlags & MessageFlags_1.MessageFlags.FrequencyMedium) {
            buf.writeUInt16BE(this.message.id, pos);
            pos += 2;
        }
        else {
            buf.writeUInt32BE(this.message.id, pos);
            pos += 4;
        }
        const expectedLength = this.message.getSize();
        const actualLength = this.message.writeToBuffer(buf, pos);
        if (actualLength !== expectedLength) {
            console.error('WARNING: Bytes written does not match expected message data length');
        }
        pos += actualLength;
        if (pos < buf.length) {
            console.error('WARNING: BUFFER UNDERFLOW: Finished writing but we are not at the end of the buffer (Written: ' + pos + ' bytes, expected ' + buf.length);
        }
        if (this.packetFlags & PacketFlags_1.PacketFlags.Zerocoded) {
            buf = Zerocoder_1.Zerocoder.Encode(buf, bodyStart, pos);
        }
        return buf;
    }
    readFromBuffer(buf, pos, ackReceived, sendAck) {
        this.packetFlags = buf.readUInt8(pos++);
        this.sequenceNumber = buf.readUInt32BE(pos);
        if (this.packetFlags & PacketFlags_1.PacketFlags.Reliable) {
            sendAck(this.sequenceNumber);
        }
        pos = pos + 4;
        const extraBytes = buf.readUInt8(pos++);
        if (extraBytes > 0) {
            this.extraHeader = buf.subarray(pos, pos + extraBytes);
            pos += extraBytes;
        }
        else {
            this.extraHeader = Buffer.allocUnsafe(0);
        }
        let appendedAcks = 0;
        if (this.packetFlags & PacketFlags_1.PacketFlags.Ack) {
            appendedAcks = buf.readUInt8(buf.length - 1);
        }
        if (this.packetFlags & PacketFlags_1.PacketFlags.Zerocoded) {
            // Annoyingly, the AppendedAcks aren't zerocoded so we need to stop decode early
            let tail = 0;
            if (this.packetFlags & PacketFlags_1.PacketFlags.Ack) {
                // Final byte in the packet contains the number of Acks
                tail = 1;
                if (appendedAcks > 0) {
                    tail += appendedAcks * 4;
                }
            }
            buf = Zerocoder_1.Zerocoder.Decode(buf, pos, buf.length - 1, tail);
        }
        let messageID = buf.readUInt8(pos);
        if (messageID === 0xFF) {
            messageID = buf.readUInt16BE(pos);
            if (messageID === 0xFFFF) {
                messageID = buf.readUInt32BE(pos);
                pos += 4;
            }
            else {
                pos += 2;
            }
        }
        else {
            pos++;
        }
        this.message = new MessageClass[(0, MessageClasses_1.nameFromID)(messageID)]();
        pos += this.message.readFromBuffer(buf, pos);
        if (this.packetFlags & PacketFlags_1.PacketFlags.Ack) {
            for (let i = 0; i < appendedAcks; i++) {
                const ackID = buf.readUInt32BE(pos);
                ackReceived(ackID);
                pos += 4;
            }
            // Account for the final byte
            pos++;
        }
        if (pos < buf.length) {
            console.error('WARNING: Finished reading ' + (0, MessageClasses_1.nameFromID)(messageID) + ' but we\'re not at the end of the packet (' + pos + ' < ' + buf.length + ', seq ' + this.sequenceNumber + ')');
        }
        return pos;
    }
}
exports.Packet = Packet;
//# sourceMappingURL=Packet.js.map