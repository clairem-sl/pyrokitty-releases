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
exports.Circuit = void 0;
const UUID_1 = require("./UUID");
const dgram = __importStar(require("dgram"));
const Packet_1 = require("./Packet");
const PacketAck_1 = require("./messages/PacketAck");
const Message_1 = require("../enums/Message");
const CompletePingCheck_1 = require("./messages/CompletePingCheck");
const operators_1 = require("rxjs/operators");
const FilterResponse_1 = require("../enums/FilterResponse");
const rxjs_1 = require("rxjs");
const TimeoutError_1 = require("./TimeoutError");
const RequestXfer_1 = require("./messages/RequestXfer");
const SendXferPacket_1 = require("./messages/SendXferPacket");
const ConfirmXferPacket_1 = require("./messages/ConfirmXferPacket");
const PacketFlags_1 = require("../enums/PacketFlags");
const Utils_1 = require("./Utils");
class Circuit {
    secureSessionID;
    sessionID;
    circuitCode;
    udpBlacklist;
    timestamp;
    port;
    ipAddress;
    client = null;
    sequenceNumber = 0;
    awaitingAck = new Map();
    receivedPackets = new Map();
    active = false;
    onPacketReceived;
    onAckReceived;
    constructor() {
        this.onPacketReceived = new rxjs_1.Subject();
        this.onAckReceived = new rxjs_1.Subject();
    }
    subscribeToMessages(ids, callback) {
        const lookupObject = {};
        for (const id of ids) {
            lookupObject[id] = true;
        }
        return this.onPacketReceived.pipe((0, operators_1.filter)((packet) => {
            return lookupObject[packet.message.id];
        })).subscribe(callback);
    }
    sendMessage(message, flags) {
        if (!this.active) {
            throw new Error('Attempting to send a message on a closed circuit');
        }
        const packet = new Packet_1.Packet();
        packet.message = message;
        packet.sequenceNumber = this.sequenceNumber++;
        packet.packetFlags = flags;
        this.sendPacket(packet);
        return packet.sequenceNumber;
    }
    async XferFileUp(xferID, data) {
        return new Promise((resolve, reject) => {
            let packetID = 0;
            const pos = {
                position: 0
            };
            const subs = this.subscribeToMessages([
                Message_1.Message.AbortXfer,
                Message_1.Message.ConfirmXferPacket
            ], (packet) => {
                switch (packet.message.id) {
                    case Message_1.Message.ConfirmXferPacket:
                        {
                            const msg = packet.message;
                            if (msg.XferID.ID.equals(xferID)) {
                                if (pos.position > -1) {
                                    packetID++;
                                    this.sendXferPacket(xferID, packetID, data, pos);
                                }
                            }
                            break;
                        }
                    case Message_1.Message.AbortXfer:
                        {
                            const msg = packet.message;
                            if (msg.XferID.ID.equals(xferID)) {
                                subs.unsubscribe();
                                reject(new Error('Transfer aborted'));
                            }
                            break;
                        }
                    default:
                        break;
                }
            });
            this.sendXferPacket(xferID, packetID, data, pos);
            if (pos.position === -1) {
                subs.unsubscribe();
                resolve();
            }
        });
    }
    async XferFileDown(fileName, deleteOnCompletion, useBigPackets, vFileID, vFileType, fromCache) {
        return new Promise((resolve, reject) => {
            let subscription = null;
            let timeout = null;
            const receivedChunks = {};
            const resetTimeout = function () {
                if (timeout !== null) {
                    clearTimeout(timeout);
                }
                timeout = setTimeout(() => {
                    if (subscription !== null) {
                        subscription.unsubscribe();
                    }
                    reject(new Error('Xfer Timeout'));
                }, 10000);
            };
            resetTimeout();
            const xferRequest = new RequestXfer_1.RequestXferMessage();
            const transferID = UUID_1.UUID.random().getLong();
            xferRequest.XferID = {
                ID: transferID,
                Filename: Utils_1.Utils.StringToBuffer(fileName),
                FilePath: (fromCache) ? 4 : 0,
                DeleteOnCompletion: deleteOnCompletion,
                UseBigPackets: useBigPackets,
                VFileID: vFileID,
                VFileType: vFileType
            };
            this.sendMessage(xferRequest, PacketFlags_1.PacketFlags.Reliable);
            let finished = false;
            let finishID = 0;
            let firstPacket = true;
            let dataSize = 0;
            subscription = this.subscribeToMessages([
                Message_1.Message.SendXferPacket,
                Message_1.Message.AbortXfer
            ], (packet) => {
                switch (packet.message.id) {
                    case Message_1.Message.AbortXfer:
                        {
                            const message = packet.message;
                            if (message.XferID.ID.compare(transferID) === 0) {
                                if (timeout !== null) {
                                    clearTimeout(timeout);
                                }
                                if (subscription !== null) {
                                    subscription.unsubscribe();
                                }
                                reject(new Error('Xfer Aborted'));
                            }
                            break;
                        }
                    case Message_1.Message.SendXferPacket:
                        {
                            const message = packet.message;
                            if (message.XferID.ID.compare(transferID) === 0) {
                                resetTimeout();
                                const packetNum = message.XferID.Packet & 0x7FFFFFFF;
                                const finishedNow = message.XferID.Packet & 0x80000000;
                                if (firstPacket) {
                                    dataSize = message.DataPacket.Data.readUInt32LE(0);
                                    receivedChunks[packetNum] = message.DataPacket.Data.subarray(4);
                                    firstPacket = false;
                                }
                                else {
                                    receivedChunks[packetNum] = message.DataPacket.Data;
                                }
                                const confirm = new ConfirmXferPacket_1.ConfirmXferPacketMessage();
                                confirm.XferID = {
                                    ID: transferID,
                                    Packet: packetNum
                                };
                                this.sendMessage(confirm, PacketFlags_1.PacketFlags.Reliable);
                                if (finishedNow) {
                                    finished = true;
                                    finishID = packetNum;
                                }
                                if (finished) {
                                    // Check if we have all the pieces
                                    for (let x = 0; x <= finishID; x++) {
                                        if (!receivedChunks[x]) {
                                            return;
                                        }
                                    }
                                    const conc = [];
                                    for (let x = 0; x <= finishID; x++) {
                                        conc.push(receivedChunks[x]);
                                    }
                                    if (timeout !== null) {
                                        clearTimeout(timeout);
                                    }
                                    if (subscription !== null) {
                                        subscription.unsubscribe();
                                    }
                                    const buf = Buffer.concat(conc);
                                    if (buf.length !== dataSize) {
                                        console.warn('Warning: Received data size does not match expected');
                                    }
                                    resolve(buf);
                                }
                            }
                            break;
                        }
                    default:
                        break;
                }
            });
        });
    }
    async waitForAck(ack, timeout) {
        return new Promise((resolve, reject) => {
            const handleObj = {
                timeout: null,
                subscription: null
            };
            handleObj.timeout = setTimeout(() => {
                if (handleObj.subscription !== null) {
                    handleObj.subscription.unsubscribe();
                    reject(new Error('Timeout'));
                }
            }, timeout);
            handleObj.subscription = this.onAckReceived.subscribe((sequenceNumber) => {
                if (sequenceNumber === ack) {
                    if (handleObj.timeout !== null) {
                        clearTimeout(handleObj.timeout);
                        handleObj.timeout = null;
                    }
                    if (handleObj.subscription !== null) {
                        handleObj.subscription.unsubscribe();
                        handleObj.subscription = null;
                    }
                    resolve();
                }
            });
        });
    }
    init() {
        if (this.client !== null) {
            this.client.close();
        }
        this.client = dgram.createSocket('udp4');
        this.client.on('message', (message, remote) => {
            if (remote.address === this.ipAddress) {
                this.receivedPacket(message);
            }
        });
        this.active = true;
    }
    shutdown() {
        for (const seqKey of this.awaitingAck.keys()) {
            const ack = this.awaitingAck.get(seqKey);
            if (ack !== undefined) {
                clearTimeout(ack.timeout);
            }
            this.awaitingAck.delete(seqKey);
        }
        for (const seqKey of this.receivedPackets.keys()) {
            const s = this.receivedPackets.get(seqKey);
            if (s !== undefined) {
                clearTimeout(s);
            }
            this.receivedPackets.delete(seqKey);
        }
        if (this.client !== null) {
            this.client.close();
            this.client = null;
            this.onPacketReceived.complete();
            this.onAckReceived.complete();
        }
        this.active = false;
    }
    async sendAndWaitForMessage(message, flags, id, timeout, messageFilter) {
        const awaiter = this.waitForMessage(id, timeout, messageFilter);
        this.sendMessage(message, flags);
        return awaiter;
    }
    async waitForMessage(id, timeout, messageFilter) {
        return new Promise((resolve, reject) => {
            const handleObj = {
                timeout: null,
                subscription: null
            };
            const timeoutFunc = () => {
                if (handleObj.subscription !== null) {
                    handleObj.subscription.unsubscribe();
                    const err = new TimeoutError_1.TimeoutError('Timeout waiting for message of type ' + Message_1.Message[id]);
                    err.timeout = true;
                    err.waitingForMessage = id;
                    reject(err);
                }
            };
            handleObj.timeout = setTimeout(timeoutFunc, timeout);
            handleObj.subscription = this.subscribeToMessages([id], (packet) => {
                let finish = false;
                if (packet.message.id === id) {
                    if (messageFilter === undefined) {
                        finish = true;
                    }
                    else {
                        const filterResult = messageFilter(packet.message);
                        if (filterResult === FilterResponse_1.FilterResponse.Finish) {
                            finish = true;
                        }
                        else if (filterResult === FilterResponse_1.FilterResponse.Match) {
                            // Extend
                            if (handleObj.timeout !== null) {
                                clearTimeout(handleObj.timeout);
                            }
                            handleObj.timeout = setTimeout(timeoutFunc, timeout);
                        }
                    }
                }
                if (finish) {
                    if (handleObj.timeout !== null) {
                        clearTimeout(handleObj.timeout);
                        handleObj.timeout = null;
                    }
                    if (handleObj.subscription !== null) {
                        handleObj.subscription.unsubscribe();
                        handleObj.subscription = null;
                    }
                    resolve(packet.message);
                }
            });
        });
    }
    getOldestUnacked() {
        let result = 0;
        let oldest = -1;
        const keys = Array.from(this.awaitingAck.keys());
        for (const nSeq of keys) {
            const awaiting = this.awaitingAck.get(nSeq);
            if (awaiting !== undefined) {
                if (oldest === -1 || awaiting.sent < oldest) {
                    result = nSeq;
                    oldest = awaiting.sent;
                }
            }
        }
        return result;
    }
    sendXferPacket(xferID, packetID, data, pos) {
        const sendXfer = new SendXferPacket_1.SendXferPacketMessage();
        let final = false;
        sendXfer.XferID = {
            ID: xferID,
            Packet: packetID
        };
        const packetLength = Math.min(data.length - pos.position, 1000);
        if (packetLength < 1000) {
            sendXfer.XferID.Packet = (sendXfer.XferID.Packet | 0x80000000) >>> 0;
            final = true;
        }
        if (packetID === 0) {
            const packet = Buffer.allocUnsafe(packetLength + 4);
            packet.writeUInt32LE(data.length, 0);
            data.copy(packet, 4, 0, packetLength);
            sendXfer.DataPacket = {
                Data: packet
            };
            pos.position += packetLength;
        }
        else {
            const packet = data.subarray(pos.position, pos.position + packetLength);
            sendXfer.DataPacket = {
                Data: packet
            };
            pos.position += packetLength;
        }
        this.sendMessage(sendXfer, PacketFlags_1.PacketFlags.Reliable);
        if (final) {
            pos.position = -1;
        }
    }
    resend(sequenceNumber) {
        if (!this.active) {
            console.log('Resend triggered, but circuit is not active!');
            return;
        }
        const waiting = this.awaitingAck.get(sequenceNumber);
        if (waiting) {
            const toResend = waiting.packet;
            toResend.packetFlags = toResend.packetFlags | PacketFlags_1.PacketFlags.Resent;
            this.sendPacket(toResend);
        }
    }
    sendPacket(packet) {
        if (packet.packetFlags & PacketFlags_1.PacketFlags.Reliable) {
            this.awaitingAck.set(packet.sequenceNumber, {
                packet: packet,
                timeout: setTimeout(this.resend.bind(this, packet.sequenceNumber), 1000),
                sent: new Date().getTime()
            });
        }
        let dataToSend = Buffer.allocUnsafe(packet.getSize());
        dataToSend = packet.writeToBuffer(dataToSend, 0);
        if (this.client !== null) {
            this.client.send(dataToSend, 0, dataToSend.length, this.port, this.ipAddress, (_err, _bytes) => {
                // nothing
            });
        }
        else {
            console.error('Attempted to send packet but UDP client is null');
        }
    }
    ackReceived(sequenceNumber) {
        const awaiting = this.awaitingAck.get(sequenceNumber);
        if (awaiting !== undefined) {
            clearTimeout(awaiting.timeout);
            this.awaitingAck.delete(sequenceNumber);
        }
        this.onAckReceived.next(sequenceNumber);
    }
    sendAck(sequenceNumber) {
        const msg = new PacketAck_1.PacketAckMessage();
        msg.Packets = [
            {
                ID: sequenceNumber
            }
        ];
        this.sendMessage(msg, 0);
    }
    expireReceivedPacket(sequenceNumber) {
        // Enough time has elapsed that we can forget about this packet
        this.receivedPackets.delete(sequenceNumber);
    }
    receivedPacket(bytes) {
        const packet = new Packet_1.Packet();
        try {
            packet.readFromBuffer(bytes, 0, this.ackReceived.bind(this), this.sendAck.bind(this));
        }
        catch (erro) {
            console.error(erro);
            return;
        }
        const received = this.receivedPackets.get(packet.sequenceNumber);
        if (received) {
            clearTimeout(received);
            this.receivedPackets.set(packet.sequenceNumber, setTimeout(this.expireReceivedPacket.bind(this, packet.sequenceNumber), 10000));
            this.sendAck(packet.sequenceNumber);
            return;
        }
        this.receivedPackets.set(packet.sequenceNumber, setTimeout(this.expireReceivedPacket.bind(this, packet.sequenceNumber), 10000));
        // console.log('<--- ' + packet.message.name);
        if (packet.message.id === Message_1.Message.PacketAck) {
            const msg = packet.message;
            for (const obj of msg.Packets) {
                this.ackReceived(obj.ID);
            }
        }
        else if (packet.message.id === Message_1.Message.StartPingCheck) {
            const msg = packet.message;
            const reply = new CompletePingCheck_1.CompletePingCheckMessage();
            reply.PingID = {
                PingID: msg.PingID.PingID
            };
            this.sendMessage(reply, 0);
        }
        this.onPacketReceived.next(packet);
    }
}
exports.Circuit = Circuit;
//# sourceMappingURL=Circuit.js.map