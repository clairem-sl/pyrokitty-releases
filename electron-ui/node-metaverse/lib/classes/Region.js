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
exports.Region = void 0;
const Circuit_1 = require("./Circuit");
const Caps_1 = require("./Caps");
const Comms_1 = require("./Comms");
const ObjectStoreFull_1 = require("./ObjectStoreFull");
const ObjectStoreLite_1 = require("./ObjectStoreLite");
const RequestRegionInfo_1 = require("./messages/RequestRegionInfo");
const Message_1 = require("../enums/Message");
const Utils_1 = require("./Utils");
const MapNameRequest_1 = require("./messages/MapNameRequest");
const GridLayerType_1 = require("../enums/GridLayerType");
const FilterResponse_1 = require("../enums/FilterResponse");
const LayerType_1 = require("../enums/LayerType");
const rxjs_1 = require("rxjs");
const BitPack_1 = require("./BitPack");
const builder = __importStar(require("xmlbuilder"));
const SimAccessFlags_1 = require("../enums/SimAccessFlags");
const ParcelDwellRequest_1 = require("./messages/ParcelDwellRequest");
const Parcel_1 = require("./public/Parcel");
const LandFlags_1 = require("../enums/LandFlags");
const ParcelPropertiesRequest_1 = require("./messages/ParcelPropertiesRequest");
const UUID_1 = require("./UUID");
const RegionFlags_1 = require("../enums/RegionFlags");
const BotOptionFlags_1 = require("../enums/BotOptionFlags");
const PacketFlags_1 = require("../enums/PacketFlags");
const Vector3_1 = require("./Vector3");
const ObjectResolver_1 = require("./ObjectResolver");
const SimStatsEvent_1 = require("../events/SimStatsEvent");
const StatID_1 = require("../enums/StatID");
const Avatar_1 = require("./public/Avatar");
const BalanceUpdatedEvent_1 = require("../events/BalanceUpdatedEvent");
const Logger_1 = require("./Logger");
const EconomyDataRequest_1 = require("./messages/EconomyDataRequest");
const RegionEnvironment_1 = require("./public/RegionEnvironment");
const LLSD_1 = require("./llsd/LLSD");
class Region {
    static CopyMatrix16 = [];
    static CosineTable16 = [];
    static DequantizeTable16 = [];
    static setup = false;
    static OO_SQRT_2 = 0.707106781186547;
    regionName;
    regionOwner;
    regionID;
    regionSizeX = 256;
    regionSizeY = 256;
    regionHandle;
    xCoordinate;
    yCoordinate;
    estateID;
    parentEstateID;
    regionFlags;
    mapImage;
    simAccess;
    maxAgents;
    billableFactor;
    objectBonusFactor;
    waterHeight;
    terrainRaiseLimit;
    terrainLowerLimit;
    pricePerMeter;
    redirectGridX;
    redirectGridY;
    useEstateSun;
    sunHour;
    productSKU;
    productName;
    maxAgents32;
    hardMaxAgents;
    hardMaxObjects;
    cacheID;
    cpuClassID;
    cpuRatio;
    coloName;
    terrainBase0;
    terrainBase1;
    terrainBase2;
    terrainBase3;
    terrainDetail0;
    terrainDetail1;
    terrainDetail2;
    terrainDetail3;
    terrainStartHeight00;
    terrainStartHeight01;
    terrainStartHeight10;
    terrainStartHeight11;
    terrainHeightRange00;
    terrainHeightRange01;
    terrainHeightRange10;
    terrainHeightRange11;
    handshakeComplete = false;
    handshakeCompleteEvent = new rxjs_1.Subject();
    circuit;
    objects;
    caps;
    comms;
    clientEvents;
    clientCommands;
    options;
    agent;
    messageSubscription;
    parcelPropertiesSubscription;
    terrain = [];
    tilesReceived = 0;
    terrainComplete = false;
    terrainCompleteEvent = new rxjs_1.Subject();
    parcelsComplete = false;
    parcelsCompleteEvent = new rxjs_1.Subject();
    parcelOverlayComplete = false;
    parcelOverlayCompleteEvent = new rxjs_1.Subject();
    parcelOverlay = [];
    parcels = {};
    parcelsByUUID = {};
    parcelMap = [];
    textures = {};
    parcelCoordinates = [];
    environment;
    timeOffset = 0;
    resolver = new ObjectResolver_1.ObjectResolver(this);
    agents = new Map();
    uploadCost;
    parcelOverlayReceived = {};
    constructor(agent, clientEvents, options) {
        if (!Region.setup) {
            Region.InitialSetup();
        }
        for (let x = 0; x < 256; x++) {
            this.terrain.push([]);
            for (let y = 0; y < 256; y++) {
                this.terrain[x].push(-1);
            }
        }
        for (let x = 0; x < 64; x++) {
            this.parcelMap.push([]);
            for (let y = 0; y < 64; y++) {
                this.parcelMap[x].push(0);
            }
        }
        this.agent = agent;
        this.options = options;
        this.clientEvents = clientEvents;
        this.circuit = new Circuit_1.Circuit();
        if (options & BotOptionFlags_1.BotOptionFlags.LiteObjectStore) {
            this.objects = new ObjectStoreLite_1.ObjectStoreLite(this.circuit, agent, clientEvents, options);
        }
        else {
            this.objects = new ObjectStoreFull_1.ObjectStoreFull(this.circuit, agent, clientEvents, options);
        }
        this.comms = new Comms_1.Comms(this.circuit, agent, clientEvents);
        this.parcelPropertiesSubscription = this.clientEvents.onParcelPropertiesEvent.subscribe((parcelProperties) => {
            this.resolveParcel(parcelProperties).catch((_e) => {
                // ignore
            });
        });
        this.messageSubscription = this.circuit.subscribeToMessages([
            Message_1.Message.ParcelOverlay,
            Message_1.Message.LayerData,
            Message_1.Message.SimulatorViewerTimeMessage,
            Message_1.Message.SimStats,
            Message_1.Message.CoarseLocationUpdate,
            Message_1.Message.MoneyBalanceReply
        ], async (packet) => {
            switch (packet.message.id) {
                case Message_1.Message.MoneyBalanceReply:
                    {
                        const msg = packet.message;
                        const evt = new BalanceUpdatedEvent_1.BalanceUpdatedEvent();
                        if (msg.TransactionInfo.Amount === -1) {
                            // This is a requested balance update, so don't sent an event
                            return;
                        }
                        evt.balance = msg.MoneyData.MoneyBalance;
                        evt.transaction = {
                            type: msg.TransactionInfo.TransactionType,
                            amount: msg.TransactionInfo.Amount,
                            from: msg.TransactionInfo.SourceID,
                            to: msg.TransactionInfo.DestID,
                            success: msg.MoneyData.TransactionSuccess,
                            fromGroup: msg.TransactionInfo.IsSourceGroup,
                            toGroup: msg.TransactionInfo.IsDestGroup,
                            description: Utils_1.Utils.BufferToStringSimple(msg.TransactionInfo.ItemDescription)
                        };
                        this.clientEvents.onBalanceUpdated.next(evt);
                        break;
                    }
                case Message_1.Message.CoarseLocationUpdate:
                    {
                        const locations = packet.message;
                        const foundAgents = {};
                        for (let x = 0; x < locations.AgentData.length; x++) {
                            const agentData = locations.AgentData[x];
                            const location = locations.Location[x];
                            const newPosition = new Vector3_1.Vector3([location.X, location.Y, location.Z * 4]);
                            foundAgents[agentData.AgentID.toString()] = newPosition;
                            const foundAgent = this.agents.get(agentData.AgentID.toString());
                            if (foundAgent === undefined) {
                                let resolved = await this.clientCommands.grid.avatarKey2Name(agentData.AgentID);
                                if (Array.isArray(resolved)) {
                                    resolved = resolved[0];
                                }
                                const ag = new Avatar_1.Avatar(agentData.AgentID, resolved.getFirstName(), resolved.getLastName());
                                ag.coarsePosition = newPosition;
                                this.agents.set(agentData.AgentID.toString(), ag);
                                this.clientEvents.onAvatarEnteredRegion.next(ag);
                            }
                            else {
                                foundAgent.coarsePosition = newPosition;
                            }
                        }
                        const keys = this.agents.keys();
                        for (const agentID of keys) {
                            if (foundAgents[agentID] === undefined) {
                                const foundAgent = this.agents.get(agentID);
                                if (foundAgent !== undefined) {
                                    foundAgent.coarseLeftRegion();
                                    this.agents.delete(agentID);
                                }
                            }
                        }
                        break;
                    }
                case Message_1.Message.SimStats:
                    {
                        const stats = packet.message;
                        if (stats.Stat.length > 0) {
                            const evt = new SimStatsEvent_1.SimStatsEvent();
                            for (const pair of stats.Stat) {
                                const value = pair.StatValue;
                                switch (pair.StatID) {
                                    case StatID_1.StatID.TimeDilation:
                                        evt.timeDilation = value;
                                        break;
                                    case StatID_1.StatID.FPS:
                                        evt.fps = value;
                                        break;
                                    case StatID_1.StatID.PhysFPS:
                                        evt.physFPS = value;
                                        break;
                                    case StatID_1.StatID.AgentUPS:
                                        evt.agentUPS = value;
                                        break;
                                    case StatID_1.StatID.FrameMS:
                                        evt.frameMS = value;
                                        break;
                                    case StatID_1.StatID.NetMS:
                                        evt.netMS = value;
                                        break;
                                    case StatID_1.StatID.SimOtherMS:
                                        evt.simOtherMS = value;
                                        break;
                                    case StatID_1.StatID.SimPhysicsMS:
                                        evt.simPhysicsMS = value;
                                        break;
                                    case StatID_1.StatID.AgentMS:
                                        evt.agentMS = value;
                                        break;
                                    case StatID_1.StatID.ImagesMS:
                                        evt.imagesMS = value;
                                        break;
                                    case StatID_1.StatID.ScriptMS:
                                        evt.scriptMS = value;
                                        break;
                                    case StatID_1.StatID.NumTasks:
                                        evt.numTasks = value;
                                        break;
                                    case StatID_1.StatID.NumTasksActive:
                                        evt.numTasksActive = value;
                                        break;
                                    case StatID_1.StatID.NumAgentMain:
                                        evt.numAgentMain = value;
                                        break;
                                    case StatID_1.StatID.NumAgentChild:
                                        evt.numAgentChild = value;
                                        break;
                                    case StatID_1.StatID.NumScriptsActive:
                                        evt.numScriptsActive = value;
                                        break;
                                    case StatID_1.StatID.LSLIPS:
                                        evt.lslIPS = value;
                                        break;
                                    case StatID_1.StatID.InPPS:
                                        evt.inPPS = value;
                                        break;
                                    case StatID_1.StatID.OutPPS:
                                        evt.outPPS = value;
                                        break;
                                    case StatID_1.StatID.PendingDownloads:
                                        evt.pendingDownloads = value;
                                        break;
                                    case StatID_1.StatID.PendingUploads:
                                        evt.pendingUploads = value;
                                        break;
                                    case StatID_1.StatID.VirtualSizeKB:
                                        evt.virtualSizeKB = value;
                                        break;
                                    case StatID_1.StatID.ResidentSizeKB:
                                        evt.residentSizeKB = value;
                                        break;
                                    case StatID_1.StatID.PendingLocalUploads:
                                        evt.pendingLocalUploads = value;
                                        break;
                                    case StatID_1.StatID.TotalUnackedBytes:
                                        evt.totalUnackedBytes = value;
                                        break;
                                    case StatID_1.StatID.PhysicsPinnedTasks:
                                        evt.physicsPinnedTasks = value;
                                        break;
                                    case StatID_1.StatID.PhysicsLODTasks:
                                        evt.physicsLODTasks = value;
                                        break;
                                    case StatID_1.StatID.SimPhysicsStepMS:
                                        evt.simPhysicsStepMS = value;
                                        break;
                                    case StatID_1.StatID.SimPhysicsShapeMS:
                                        evt.simPhysicsShapeMS = value;
                                        break;
                                    case StatID_1.StatID.SimPhysicsOtherMS:
                                        evt.simPhysicsOtherMS = value;
                                        break;
                                    case StatID_1.StatID.SimPhysicsMemory:
                                        evt.simPhysicsMemory = value;
                                        break;
                                    case StatID_1.StatID.ScriptEPS:
                                        evt.scriptEPS = value;
                                        break;
                                    case StatID_1.StatID.SimSpareTime:
                                        evt.simSpareTime = value;
                                        break;
                                    case StatID_1.StatID.SimSleepTime:
                                        evt.simSleepTime = value;
                                        break;
                                    case StatID_1.StatID.IOPumpTime:
                                        evt.ioPumpTime = value;
                                        break;
                                    case StatID_1.StatID.PCTScriptsRun:
                                        evt.pctScriptsRun = value;
                                        break;
                                    case StatID_1.StatID.RegionIdle:
                                        evt.regionIdle = value;
                                        break;
                                    case StatID_1.StatID.RegionIdlePossible:
                                        evt.regionIdlePossible = value;
                                        break;
                                    case StatID_1.StatID.SimAIStepTimeMS:
                                        evt.simAIStepTimeMS = value;
                                        break;
                                    case StatID_1.StatID.SkippedAISilStepsPS:
                                        evt.skippedAISilStepsPS = value;
                                        break;
                                    case StatID_1.StatID.PCTSteppedCharacters:
                                        evt.pctSteppedCharacters = value;
                                        break;
                                }
                                this.clientEvents.onSimStats.next(evt);
                            }
                        }
                        break;
                    }
                case Message_1.Message.ParcelOverlay:
                    {
                        const parcelData = packet.message;
                        const sequence = parcelData.ParcelData.SequenceID;
                        if (this.parcelOverlayReceived[sequence] !== undefined) {
                            this.parcelOverlayReceived = {};
                        }
                        this.parcelOverlayReceived[sequence] = parcelData.ParcelData.Data;
                        let totalLength = 0;
                        let highestSeq = 0;
                        for (const seq of Object.keys(this.parcelOverlayReceived)) {
                            const sequenceID = parseInt(seq, 10);
                            totalLength += this.parcelOverlayReceived[sequenceID].length;
                            if (sequenceID > highestSeq) {
                                highestSeq = sequenceID;
                            }
                        }
                        if (totalLength !== (this.regionSizeX / 4) * (this.regionSizeY / 4)) {
                            // Overlay is incomplete
                            return;
                        }
                        for (let x = 0; x <= highestSeq; x++) {
                            if (this.parcelOverlayReceived[x] === undefined) {
                                // Overlay is incomplete
                                return;
                            }
                        }
                        this.parcelOverlay = [];
                        for (let seq = 0; seq <= highestSeq; seq++) {
                            const data = this.parcelOverlayReceived[seq];
                            for (let x = 0; x < data.length; x++) {
                                const block = data.readUInt8(x);
                                this.parcelOverlay.push({
                                    landType: block & 0xF,
                                    landFlags: block & ~0xF,
                                    parcelID: -1
                                });
                            }
                        }
                        this.parcelCoordinates = [];
                        let currentParcelID = 0;
                        for (let y = 63; y > -1; y--) {
                            for (let x = 63; x > -1; x--) {
                                if (this.parcelOverlay[(y * 64) + x].parcelID === -1) {
                                    this.parcelCoordinates.push({ x, y });
                                    currentParcelID++;
                                    this.fillParcel(currentParcelID, x, y);
                                }
                            }
                        }
                        if (!this.parcelOverlayComplete) {
                            this.parcelOverlayComplete = true;
                            this.parcelOverlayCompleteEvent.next();
                        }
                        this.parcelOverlayReceived = {};
                        break;
                    }
                case Message_1.Message.LayerData:
                    {
                        const layerData = packet.message;
                        const type = layerData.LayerID.Type;
                        const nibbler = new BitPack_1.BitPack(layerData.LayerData.Data, 0);
                        // stride - unused for now
                        nibbler.UnpackBits(16);
                        const patchSize = nibbler.UnpackBits(8);
                        const headerLayerType = nibbler.UnpackBits(8);
                        switch (type) {
                            case LayerType_1.LayerType.Land:
                                {
                                    if (headerLayerType === type) // Quick sanity check
                                     {
                                        let x = 0;
                                        let y = 0;
                                        const patches = [];
                                        for (let xi = 0; xi < 32 * 32; xi++) {
                                            patches.push(0);
                                        }
                                        while (true) {
                                            // DecodePatchHeader
                                            const quantWBits = nibbler.UnpackBits(8);
                                            if (quantWBits === 97) {
                                                break;
                                            }
                                            const dcOffset = nibbler.UnpackFloat();
                                            const range = nibbler.UnpackBits(16);
                                            const patchIDs = nibbler.UnpackBits(10);
                                            const wordBits = (quantWBits & 0x0f) + 2;
                                            x = patchIDs >> 5;
                                            y = patchIDs & 0x1F;
                                            if (x >= 16 || y >= 16) {
                                                console.error('Invalid land packet. x: ' + x + ', y: ' + y + ', patchSize: ' + patchSize);
                                                return;
                                            }
                                            else {
                                                // Decode patch
                                                let temp = 0;
                                                for (let n = 0; n < patchSize * patchSize; n++) {
                                                    temp = nibbler.UnpackBits(1);
                                                    if (temp !== 0) {
                                                        temp = nibbler.UnpackBits(1);
                                                        if (temp !== 0) {
                                                            temp = nibbler.UnpackBits(1);
                                                            if (temp !== 0) {
                                                                // negative
                                                                temp = nibbler.UnpackBits(wordBits);
                                                                patches[n] = temp * -1;
                                                            }
                                                            else {
                                                                // positive
                                                                temp = nibbler.UnpackBits(wordBits);
                                                                patches[n] = temp;
                                                            }
                                                        }
                                                        else {
                                                            for (let o = n; o < patchSize * patchSize; o++) {
                                                                patches[o] = 0;
                                                            }
                                                            break;
                                                        }
                                                    }
                                                    else {
                                                        patches[n] = 0;
                                                    }
                                                }
                                                // Decompress this patch
                                                const block = [];
                                                const output = [];
                                                const prequant = (quantWBits >> 4) + 2;
                                                const quantize = 1 << prequant;
                                                const ooq = 1.0 / quantize;
                                                const mult = ooq * range;
                                                const addVal = mult * (1 << (prequant - 1)) + dcOffset;
                                                if (patchSize === 16) {
                                                    for (let n = 0; n < 16 * 16; n++) {
                                                        block.push(patches[Region.CopyMatrix16[n]] * Region.DequantizeTable16[n]);
                                                    }
                                                    const ftemp = [];
                                                    for (let o = 0; o < 16 * 16; o++) {
                                                        ftemp.push(o);
                                                    }
                                                    for (let o = 0; o < 16; o++) {
                                                        Region.IDCTColumn16(block, ftemp, o);
                                                    }
                                                    for (let o = 0; o < 16; o++) {
                                                        Region.IDCTLine16(ftemp, block, o);
                                                    }
                                                }
                                                else {
                                                    throw new Error('IDCTPatchLarge not implemented');
                                                }
                                                for (const bl of block) {
                                                    output.push(bl * mult + addVal);
                                                }
                                                let outputIndex = 0;
                                                for (let yPoint = y * 16; yPoint < (y + 1) * 16; yPoint++) {
                                                    for (let xPoint = x * 16; xPoint < (x + 1) * 16; xPoint++) {
                                                        if (this.terrain[yPoint][xPoint] === -1) {
                                                            this.tilesReceived++;
                                                        }
                                                        this.terrain[yPoint][xPoint] = output[outputIndex++];
                                                    }
                                                }
                                                if (this.tilesReceived === 65536) {
                                                    this.terrainComplete = true;
                                                    this.terrainCompleteEvent.next();
                                                }
                                            }
                                        }
                                    }
                                    break;
                                }
                            default:
                                break;
                        }
                        break;
                    }
                case Message_1.Message.SimulatorViewerTimeMessage:
                    {
                        const msg = packet.message;
                        const timeStamp = msg.TimeInfo.UsecSinceStart.toNumber() / 1000000;
                        this.timeOffset = (new Date().getTime() / 1000) - timeStamp;
                        break;
                    }
                default:
                    break;
            }
        });
    }
    static IDCTColumn16(linein, lineout, column) {
        let total = 0;
        let usize = 0;
        for (let n = 0; n < 16; n++) {
            total = this.OO_SQRT_2 * linein[column];
            for (let u = 1; u < 16; u++) {
                usize = u * 16;
                total += linein[usize + column] * this.CosineTable16[usize + n];
            }
            lineout[16 * n + column] = total;
        }
    }
    static IDCTLine16(linein, lineout, line) {
        const oosob = 2.0 / 16.0;
        const lineSize = line * 16;
        let total = 0;
        for (let n = 0; n < 16; n++) {
            total = this.OO_SQRT_2 * linein[lineSize];
            for (let u = 1; u < 16; u++) {
                total += linein[lineSize + u] * this.CosineTable16[u * 16 + n];
            }
            lineout[lineSize + n] = total * oosob;
        }
    }
    static InitialSetup() {
        // Build copy matrix 16
        {
            let diag = false;
            let right = true;
            let i = 0;
            let j = 0;
            let count = 0;
            for (let x = 0; x < 16 * 16; x++) {
                this.CopyMatrix16.push(0);
                this.DequantizeTable16.push(0);
                this.CosineTable16.push(0);
            }
            while (i < 16 && j < 16) {
                this.CopyMatrix16[j * 16 + i] = count++;
                if (!diag) {
                    if (right) {
                        if (i < 16 - 1) {
                            i++;
                        }
                        else {
                            j++;
                        }
                        right = false;
                        diag = true;
                    }
                    else {
                        if (j < 16 - 1) {
                            j++;
                        }
                        else {
                            i++;
                        }
                        right = true;
                        diag = true;
                    }
                }
                else {
                    if (right) {
                        i++;
                        j--;
                        if (i === 16 - 1 || j === 0) {
                            diag = false;
                        }
                    }
                    else {
                        i--;
                        j++;
                        if (j === 16 - 1 || i === 0) {
                            diag = false;
                        }
                    }
                }
            }
        }
        {
            for (let j = 0; j < 16; j++) {
                for (let i = 0; i < 16; i++) {
                    this.DequantizeTable16[j * 16 + i] = 1.0 + 2.0 * (i + j);
                }
            }
        }
        {
            const hposz = Math.PI * 0.5 / 16.0;
            for (let u = 0; u < 16; u++) {
                for (let n = 0; n < 16; n++) {
                    this.CosineTable16[u * 16 + n] = Math.cos((2.0 * n + 1.0) * u * hposz);
                }
            }
        }
        this.setup = true;
    }
    async getUploadCost() {
        if (this.uploadCost !== undefined) {
            return this.uploadCost;
        }
        const msg = new EconomyDataRequest_1.EconomyDataRequestMessage();
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const economyReply = await this.circuit.waitForMessage(Message_1.Message.EconomyData, 10000, (_message) => {
            return FilterResponse_1.FilterResponse.Finish;
        });
        this.uploadCost = economyReply.Info.PriceUpload;
        return this.uploadCost;
    }
    async getParcelProperties(x, y) {
        return new Promise((resolve, reject) => {
            const request = new ParcelPropertiesRequest_1.ParcelPropertiesRequestMessage();
            request.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: this.circuit.sessionID
            };
            request.ParcelData = {
                North: y + 1,
                East: x + 1,
                South: y,
                West: x,
                SequenceID: -10000,
                SnapSelection: false
            };
            this.circuit.sendMessage(request, PacketFlags_1.PacketFlags.Reliable);
            let messageAwait = undefined;
            let messageWaitTimer = undefined;
            messageAwait = this.clientEvents.onParcelPropertiesEvent.subscribe((parcelProperties) => {
                if (Region.doesBitmapContainCoordinate(parcelProperties.Bitmap, x, y)) {
                    if (messageAwait !== undefined) {
                        messageAwait.unsubscribe();
                        messageAwait = undefined;
                    }
                    if (messageWaitTimer !== undefined) {
                        clearTimeout(messageWaitTimer);
                        messageWaitTimer = undefined;
                    }
                    this.resolveParcel(parcelProperties).then((value) => {
                        resolve(value);
                    }).catch((e) => {
                        reject(e);
                    });
                }
            });
            messageWaitTimer = setTimeout(() => {
                if (messageAwait !== undefined) {
                    messageAwait.unsubscribe();
                    messageAwait = undefined;
                }
                if (messageWaitTimer !== undefined) {
                    clearTimeout(messageWaitTimer);
                    messageWaitTimer = undefined;
                }
                reject(new Error('Timed out'));
            }, 10000);
        });
    }
    async getParcels() {
        await this.waitForParcelOverlay();
        const parcels = [];
        for (const parcel of this.parcelCoordinates) {
            try {
                parcels.push(await this.getParcelProperties(parcel.x * 4.0, parcel.y * 4.0));
            }
            catch (error) {
                console.error(error);
            }
        }
        return parcels;
    }
    resetParcels() {
        this.parcelMap = [];
        for (let x = 0; x < 64; x++) {
            this.parcelMap.push([]);
            for (let y = 0; y < 64; y++) {
                this.parcelMap[x].push(0);
            }
        }
        this.parcels = {};
        this.parcelsByUUID = {};
        this.parcelsComplete = false;
    }
    async waitForParcelOverlay() {
        return new Promise((resolve, reject) => {
            if (this.parcelOverlayComplete) {
                resolve();
            }
            else {
                let timeout = null;
                const subscription = this.parcelOverlayCompleteEvent.subscribe(() => {
                    if (timeout !== null) {
                        clearTimeout(timeout);
                    }
                    subscription.unsubscribe();
                    resolve();
                });
                timeout = setTimeout(() => {
                    subscription.unsubscribe();
                    reject(new Error('Timeout waiting for parcel overlay'));
                }, 10000);
            }
        });
    }
    async waitForParcels() {
        return new Promise((resolve, reject) => {
            if (this.parcelsComplete) {
                resolve();
            }
            else {
                let timeout = null;
                const subscription = this.parcelsCompleteEvent.subscribe(() => {
                    if (timeout !== null) {
                        clearTimeout(timeout);
                    }
                    subscription.unsubscribe();
                    resolve();
                });
                timeout = setTimeout(() => {
                    subscription.unsubscribe();
                    reject(new Error('Timeout waiting for parcels'));
                }, 10000);
            }
        });
    }
    async waitForTerrain() {
        return new Promise((resolve, reject) => {
            if (this.terrainComplete) {
                resolve();
            }
            else {
                let timeout = null;
                const subscription = this.terrainCompleteEvent.subscribe(() => {
                    if (timeout !== null) {
                        clearTimeout(timeout);
                    }
                    subscription.unsubscribe();
                    resolve();
                });
                timeout = setTimeout(() => {
                    subscription.unsubscribe();
                    reject(new Error('Timeout waiting for terrain'));
                }, 10000);
            }
        });
    }
    getTerrainHeightAtPoint(x, y) {
        const patchX = Math.floor(x / 16);
        const patchY = Math.floor(y / 16);
        x = x % 16;
        y = y % 16;
        const p = this.terrain[patchY * 16 + patchX];
        if (p === null) {
            return 0;
        }
        return p[y * 16 + x];
    }
    exportXML() {
        const document = builder.create('RegionSettings');
        const general = document.ele('General');
        general.ele('AllowDamage', (this.regionFlags & RegionFlags_1.RegionFlags.AllowDamage) ? 'True' : 'False');
        general.ele('AllowLandResell', !(this.regionFlags & RegionFlags_1.RegionFlags.BlockLandResell) ? 'True' : 'False');
        general.ele('AllowLandJoinDivide', (this.regionFlags & RegionFlags_1.RegionFlags.AllowParcelChanges) ? 'True' : 'False');
        general.ele('BlockFly', (this.regionFlags & RegionFlags_1.RegionFlags.NoFly) ? 'True' : 'False');
        general.ele('BlockLandShowInSearch', (this.regionFlags & RegionFlags_1.RegionFlags.BlockParcelSearch) ? 'True' : 'False');
        general.ele('BlockTerraform', (this.regionFlags & RegionFlags_1.RegionFlags.BlockTerraform) ? 'True' : 'False');
        general.ele('DisableCollisions', (this.regionFlags & RegionFlags_1.RegionFlags.SkipCollisions) ? 'True' : 'False');
        general.ele('DisablePhysics', (this.regionFlags & RegionFlags_1.RegionFlags.SkipPhysics) ? 'True' : 'False');
        general.ele('DisableScripts', (this.regionFlags & RegionFlags_1.RegionFlags.EstateSkipScripts) ? 'True' : 'False');
        general.ele('MaturityRating', (this.simAccess & SimAccessFlags_1.SimAccessFlags.Mature & SimAccessFlags_1.SimAccessFlags.Adult & SimAccessFlags_1.SimAccessFlags.PG));
        general.ele('RestrictPushing', (this.regionFlags & RegionFlags_1.RegionFlags.RestrictPushObject) ? 'True' : 'False');
        general.ele('AgentLimit', this.maxAgents);
        general.ele('ObjectBonus', this.objectBonusFactor);
        const groundTextures = document.ele('GroundTextures');
        groundTextures.ele('Texture1', this.terrainDetail0.toString());
        groundTextures.ele('Texture2', this.terrainDetail1.toString());
        groundTextures.ele('Texture3', this.terrainDetail2.toString());
        groundTextures.ele('Texture4', this.terrainDetail3.toString());
        groundTextures.ele('ElevationLowSW', this.terrainStartHeight00);
        groundTextures.ele('ElevationLowNW', this.terrainStartHeight01);
        groundTextures.ele('ElevationLowSE', this.terrainStartHeight10);
        groundTextures.ele('ElevationLowNE', this.terrainStartHeight11);
        groundTextures.ele('ElevationHighSW', this.terrainHeightRange00);
        groundTextures.ele('ElevationHighNW', this.terrainHeightRange01);
        groundTextures.ele('ElevationHighSE', this.terrainHeightRange10);
        groundTextures.ele('ElevationHighNE', this.terrainHeightRange11);
        const terrain = document.ele('Terrain');
        terrain.ele('WaterHeight', this.waterHeight);
        terrain.ele('TerrainRaiseLimit', this.terrainRaiseLimit);
        terrain.ele('TerrainLowerLimit', this.terrainLowerLimit);
        terrain.ele('UseEstateSun', (this.useEstateSun) ? 'True' : 'False');
        terrain.ele('FixedSun', (this.regionFlags & RegionFlags_1.RegionFlags.SunFixed) ? 'True' : 'False');
        terrain.ele('SunPosition', this.sunHour);
        if (this.environment) {
            const env = document.ele('Environment');
            env.ele('data', this.environment.toNotation());
        }
        return document.end({ pretty: true, allowEmpty: true });
    }
    activateCaps(seedURL) {
        if (this.caps !== undefined) {
            this.caps.shutdown();
        }
        this.caps = new Caps_1.Caps(this.agent, seedURL, this.clientEvents);
    }
    async handshake(handshake) {
        this.regionName = Utils_1.Utils.BufferToStringSimple(handshake.RegionInfo.SimName);
        this.simAccess = handshake.RegionInfo.SimAccess;
        this.regionFlags = handshake.RegionInfo.RegionFlags;
        this.regionOwner = handshake.RegionInfo.SimOwner;
        this.agent.setIsEstateManager(handshake.RegionInfo.IsEstateManager);
        this.waterHeight = handshake.RegionInfo.WaterHeight;
        this.billableFactor = handshake.RegionInfo.BillableFactor;
        this.cacheID = handshake.RegionInfo.CacheID;
        this.terrainBase0 = handshake.RegionInfo.TerrainBase0;
        this.terrainBase1 = handshake.RegionInfo.TerrainBase1;
        this.terrainBase2 = handshake.RegionInfo.TerrainBase2;
        this.terrainBase3 = handshake.RegionInfo.TerrainBase3;
        this.terrainDetail0 = handshake.RegionInfo.TerrainDetail0;
        this.terrainDetail1 = handshake.RegionInfo.TerrainDetail1;
        this.terrainDetail2 = handshake.RegionInfo.TerrainDetail2;
        this.terrainDetail3 = handshake.RegionInfo.TerrainDetail3;
        this.terrainStartHeight00 = handshake.RegionInfo.TerrainStartHeight00;
        this.terrainStartHeight01 = handshake.RegionInfo.TerrainStartHeight01;
        this.terrainStartHeight10 = handshake.RegionInfo.TerrainStartHeight10;
        this.terrainStartHeight11 = handshake.RegionInfo.TerrainStartHeight11;
        this.terrainHeightRange00 = handshake.RegionInfo.TerrainHeightRange00;
        this.terrainHeightRange01 = handshake.RegionInfo.TerrainHeightRange01;
        this.terrainHeightRange10 = handshake.RegionInfo.TerrainHeightRange10;
        this.terrainHeightRange11 = handshake.RegionInfo.TerrainHeightRange11;
        this.regionID = handshake.RegionInfo2.RegionID;
        this.cpuClassID = handshake.RegionInfo3.CPUClassID;
        this.cpuRatio = handshake.RegionInfo3.CPURatio;
        this.coloName = Utils_1.Utils.BufferToStringSimple(handshake.RegionInfo3.ColoName);
        this.productSKU = Utils_1.Utils.BufferToStringSimple(handshake.RegionInfo3.ProductSKU);
        this.productName = Utils_1.Utils.BufferToStringSimple(handshake.RegionInfo3.ProductName);
        const request = new RequestRegionInfo_1.RequestRegionInfoMessage();
        request.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        this.circuit.sendMessage(request, PacketFlags_1.PacketFlags.Reliable);
        const regionInfo = await this.circuit.waitForMessage(Message_1.Message.RegionInfo, 30000);
        this.estateID = regionInfo.RegionInfo.EstateID;
        this.parentEstateID = regionInfo.RegionInfo.ParentEstateID;
        this.maxAgents = regionInfo.RegionInfo.MaxAgents;
        this.objectBonusFactor = regionInfo.RegionInfo.ObjectBonusFactor;
        this.terrainRaiseLimit = regionInfo.RegionInfo.TerrainRaiseLimit;
        this.terrainLowerLimit = regionInfo.RegionInfo.TerrainLowerLimit;
        this.pricePerMeter = regionInfo.RegionInfo.PricePerMeter;
        this.redirectGridX = regionInfo.RegionInfo.RedirectGridX;
        this.redirectGridY = regionInfo.RegionInfo.RedirectGridY;
        this.useEstateSun = regionInfo.RegionInfo.UseEstateSun;
        this.sunHour = regionInfo.RegionInfo.SunHour;
        this.maxAgents32 = regionInfo.RegionInfo2.MaxAgents32;
        this.hardMaxAgents = regionInfo.RegionInfo2.HardMaxAgents;
        this.hardMaxObjects = regionInfo.RegionInfo2.HardMaxObjects;
        const msg = new MapNameRequest_1.MapNameRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID,
            Flags: GridLayerType_1.GridLayerType.Objects,
            EstateID: 0,
            Godlike: false
        };
        msg.NameData = {
            Name: handshake.RegionInfo.SimName
        };
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForMessage(Message_1.Message.MapBlockReply, 30000, (filterMsg) => {
            for (const region of filterMsg.Data) {
                const name = Utils_1.Utils.BufferToStringSimple(region.Name);
                if (name.trim().toLowerCase() === this.regionName.trim().toLowerCase()) {
                    this.xCoordinate = region.X;
                    this.yCoordinate = region.Y;
                    this.mapImage = region.MapImageID;
                    const globalPos = Utils_1.Utils.RegionCoordinatesToHandle(this.xCoordinate, this.yCoordinate);
                    this.regionHandle = globalPos.regionHandle;
                    return FilterResponse_1.FilterResponse.Finish;
                }
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        await this.caps.waitForSeedCapability();
        try {
            const extResponse = await this.caps.capsGetString('ExtEnvironment');
            this.environment = new RegionEnvironment_1.RegionEnvironment(LLSD_1.LLSD.parseXML(extResponse));
        }
        catch (e) {
            Logger_1.Logger.Error(e);
            Logger_1.Logger.Warn('Unable to get environment settings from region');
        }
        this.handshakeComplete = true;
        this.handshakeCompleteEvent.next();
    }
    shutdown() {
        this.parcelPropertiesSubscription.unsubscribe();
        this.messageSubscription.unsubscribe();
        this.comms.shutdown();
        this.caps.shutdown();
        this.objects.shutdown();
        this.resolver.shutdown();
        this.circuit.shutdown();
    }
    static doesBitmapContainCoordinate(bitmap, x, y) {
        const mapBlockX = Math.floor(x / 4);
        const mapBlockY = Math.floor(y / 4);
        let index = (mapBlockY * 64) + mapBlockX;
        const bit = index % 8;
        index >>= 3;
        return ((bitmap[index] & (1 << bit)) !== 0);
    }
    async resolveParcel(parcelProperties) {
        // Get the parcel UUID
        const msg = new ParcelDwellRequest_1.ParcelDwellRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.Data = {
            LocalID: parcelProperties.LocalID,
            ParcelID: UUID_1.UUID.zero()
        };
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const dwellReply = await this.circuit.waitForMessage(Message_1.Message.ParcelDwellReply, 10000, (message) => {
            if (message.Data.LocalID === parcelProperties.LocalID) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            else {
                return FilterResponse_1.FilterResponse.NoMatch;
            }
        });
        const parcelID = dwellReply.Data.ParcelID.toString();
        let parcel = new Parcel_1.Parcel(this);
        if (this.parcelsByUUID[parcelID]) {
            parcel = this.parcelsByUUID[parcelID];
        }
        parcel.LocalID = parcelProperties.LocalID;
        parcel.ParcelID = new UUID_1.UUID(dwellReply.Data.ParcelID.toString());
        parcel.RegionDenyAgeUnverified = parcelProperties.RegionDenyTransacted;
        parcel.MediaDesc = parcelProperties.MediaDesc;
        parcel.MediaHeight = parcelProperties.MediaHeight;
        parcel.MediaLoop = parcelProperties.MediaLoop;
        parcel.MediaType = parcelProperties.MediaType;
        parcel.MediaWidth = parcelProperties.MediaWidth;
        parcel.ObscureMedia = parcelProperties.ObscureMedia;
        parcel.ObscureMusic = parcelProperties.ObscureMusic;
        parcel.AABBMax = parcelProperties.AABBMax;
        parcel.AABBMin = parcelProperties.AABBMin;
        parcel.AnyAVSounds = parcelProperties.AnyAVSounds;
        parcel.Area = parcelProperties.Area;
        parcel.AuctionID = parcelProperties.AuctionID;
        parcel.AuthBuyerID = new UUID_1.UUID(parcelProperties.AuthBuyerID.toString());
        parcel.Bitmap = parcelProperties.Bitmap;
        parcel.Category = parcelProperties.Category;
        parcel.ClaimDate = parcelProperties.ClaimDate;
        parcel.ClaimPrice = parcelProperties.ClaimPrice;
        parcel.Desc = parcelProperties.Desc;
        parcel.Dwell = dwellReply.Data.Dwell;
        parcel.GroupAVSounds = parcelProperties.GroupAVSounds;
        parcel.GroupID = new UUID_1.UUID(parcelProperties.GroupID.toString());
        parcel.GroupPrims = parcelProperties.GroupPrims;
        parcel.IsGroupOwned = parcelProperties.IsGroupOwned;
        parcel.LandingType = parcelProperties.LandingType;
        parcel.MaxPrims = parcelProperties.MaxPrims;
        parcel.MediaAutoScale = parcelProperties.MediaAutoScale;
        parcel.MediaID = new UUID_1.UUID(parcelProperties.MediaID.toString());
        parcel.MediaURL = parcelProperties.MediaURL;
        parcel.MusicURL = parcelProperties.MusicURL;
        parcel.Name = parcelProperties.Name;
        parcel.OtherCleanTime = parcelProperties.OtherCleanTime;
        parcel.OtherCount = parcelProperties.OtherCount;
        parcel.OtherPrims = parcelProperties.OtherPrims;
        parcel.OwnerID = new UUID_1.UUID(parcelProperties.OwnerID.toString());
        parcel.OwnerPrims = parcelProperties.OwnerPrims;
        parcel.ParcelFlags = parcelProperties.ParcelFlags;
        parcel.ParcelPrimBonus = parcelProperties.ParcelPrimBonus;
        parcel.PassHours = parcelProperties.PassHours;
        parcel.PassPrice = parcelProperties.PassPrice;
        parcel.PublicCount = parcelProperties.PublicCount;
        parcel.RegionDenyAnonymous = parcelProperties.RegionDenyAnonymous;
        parcel.RegionDenyIdentified = parcelProperties.RegionDenyIdentified;
        parcel.RegionPushOverride = parcelProperties.RegionPushOverride;
        parcel.RegionDenyTransacted = parcelProperties.RegionDenyTransacted;
        parcel.RentPrice = parcelProperties.RentPrice;
        parcel.RequestResult = parcelProperties.RequestResult;
        parcel.SalePrice = parcelProperties.SalePrice;
        parcel.SeeAvs = parcelProperties.SeeAvs;
        parcel.SelectedPrims = parcelProperties.SelectedPrims;
        parcel.SelfCount = parcelProperties.SelfCount;
        parcel.SequenceID = parcelProperties.SequenceID;
        parcel.SimWideMaxPrims = parcelProperties.SimWideMaxPrims;
        parcel.SimWideTotalPrims = parcelProperties.SimWideTotalPrims;
        parcel.SnapSelection = parcelProperties.SnapSelection;
        parcel.SnapshotID = new UUID_1.UUID(parcelProperties.SnapshotID.toString());
        parcel.Status = parcelProperties.Status;
        parcel.TotalPrims = parcelProperties.TotalPrims;
        parcel.UserLocation = parcelProperties.UserLocation;
        parcel.UserLookAt = parcelProperties.UserLookAt;
        parcel.RegionAllowAccessOverride = parcelProperties.RegionAllowAccessOverride;
        this.parcels[parcelProperties.LocalID] = parcel;
        let foundEmpty = false;
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                if (Region.doesBitmapContainCoordinate(parcel.Bitmap, x * 4, y * 4)) {
                    this.parcelMap[y][x] = parcel.LocalID;
                }
                else {
                    if (this.parcelMap[y][x] === 0) {
                        foundEmpty = true;
                    }
                }
            }
        }
        if (!foundEmpty) {
            if (!this.parcelsComplete) {
                this.parcelsComplete = true;
                this.parcelsCompleteEvent.next();
            }
        }
        else if (this.parcelsComplete) {
            this.parcelsComplete = false;
        }
        return parcel;
    }
    /* // This was useful for debugging, so leaving it here for the future
    private drawParcelMap()
    {
        console.log('====================================================');
        for (let y2 = 63; y2 > -1; y2--)
        {
            let row = '';
            for (let x2 = 0; x2 < 64; x2++)
            {
                const parcelID = this.parcelOverlay[(y2 * 64) + x2].parcelID;
                if (parcelID === -1)
                {
                    row += 'X';
                }
                else if (parcelID < 10)
                {
                    row += String(parcelID);
                }
                else
                {
                    row += '#';
                }
            }
            console.log(row);
        }
    }
     */
    fillParcel(parcelID, x, y) {
        if (x < 0 || y < 0 || x > 63 || y > 63) {
            return;
        }
        if (this.parcelOverlay[(y * 64) + x].parcelID !== -1) {
            return;
        }
        this.parcelOverlay[(y * 64) + x].parcelID = parcelID;
        const flags = this.parcelOverlay[(y * 64) + x].landFlags;
        if (!(flags & LandFlags_1.LandFlags.BorderSouth)) {
            this.fillParcel(parcelID, x, y - 1);
        }
        if (!(flags & LandFlags_1.LandFlags.BorderWest)) {
            this.fillParcel(parcelID, x - 1, y);
        }
        if (x < 63 && !(this.parcelOverlay[(y * 64) + (x + 1)].landFlags & LandFlags_1.LandFlags.BorderWest)) {
            this.fillParcel(parcelID, x + 1, y);
        }
        if (y < 63 && !(this.parcelOverlay[((y + 1) * 64) + x].landFlags & LandFlags_1.LandFlags.BorderSouth)) {
            this.fillParcel(parcelID, x, y + 1);
        }
    }
}
exports.Region = Region;
//# sourceMappingURL=Region.js.map