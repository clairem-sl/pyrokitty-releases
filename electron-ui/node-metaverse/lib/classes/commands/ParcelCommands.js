"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParcelCommands = void 0;
const CommandsBase_1 = require("./CommandsBase");
const ParcelInfoRequest_1 = require("../messages/ParcelInfoRequest");
const UUID_1 = require("../UUID");
const Message_1 = require("../../enums/Message");
const FilterResponse_1 = require("../../enums/FilterResponse");
const Utils_1 = require("../Utils");
const PacketFlags_1 = require("../../enums/PacketFlags");
const Vector3_1 = require("../Vector3");
const LandStatRequest_1 = require("../messages/LandStatRequest");
// This class was added to provide a new "Category" of commands, since we don't have any parcel specific functionality yet.
class ParcelCommands extends CommandsBase_1.CommandsBase {
    async getParcelInfo(parcelID) {
        if (typeof parcelID === 'string') {
            parcelID = new UUID_1.UUID(parcelID);
        }
        const msg = new ParcelInfoRequest_1.ParcelInfoRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.Data = {
            ParcelID: parcelID
        };
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const parcelInfoReply = (await this.circuit.waitForMessage(Message_1.Message.ParcelInfoRequest, 10000, (replyMessage) => {
            if (replyMessage.Data.ParcelID.equals(parcelID)) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        }));
        return new class {
            OwnerID = parcelInfoReply.Data.OwnerID;
            ParcelName = Utils_1.Utils.BufferToStringSimple(parcelInfoReply.Data.Name);
            ParcelDescription = Utils_1.Utils.BufferToStringSimple(parcelInfoReply.Data.Desc);
            Area = parcelInfoReply.Data.ActualArea;
            BillableArea = parcelInfoReply.Data.BillableArea;
            Flags = parcelInfoReply.Data.Flags;
            GlobalCoordinates = new Vector3_1.Vector3([parcelInfoReply.Data.GlobalX, parcelInfoReply.Data.GlobalY, parcelInfoReply.Data.GlobalZ]);
            RegionName = Utils_1.Utils.BufferToStringSimple(parcelInfoReply.Data.SimName);
            SnapshotID = parcelInfoReply.Data.SnapshotID;
            Traffic = parcelInfoReply.Data.Dwell;
            SalePrice = parcelInfoReply.Data.SalePrice;
            AuctionID = parcelInfoReply.Data.AuctionID;
        };
    }
    async getLandStats(parcelID, reportType, flags, filter) {
        if (parcelID instanceof UUID_1.UUID) {
            parcelID = parcelID.toString();
        }
        if (typeof parcelID === 'string') {
            const parcels = await this.bot.clientCommands.region.getParcels();
            for (const parcel of parcels) {
                if (parcel.ParcelID.toString() === parcelID) {
                    parcelID = parcel.LocalID;
                    break;
                }
            }
        }
        if (typeof parcelID !== 'number') {
            throw new Error('Unable to locate parcel');
        }
        if (filter === undefined) {
            filter = '';
        }
        const msg = new LandStatRequest_1.LandStatRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.RequestData = {
            ParcelLocalID: parcelID,
            ReportType: reportType,
            Filter: Utils_1.Utils.StringToBuffer(filter),
            RequestFlags: flags
        };
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        return Utils_1.Utils.waitOrTimeOut(this.currentRegion.clientEvents.onLandStatReplyEvent, 10000);
    }
}
exports.ParcelCommands = ParcelCommands;
//# sourceMappingURL=ParcelCommands.js.map