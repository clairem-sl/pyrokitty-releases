"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryCommands = void 0;
const CommandsBase_1 = require("./CommandsBase");
const InstantMessageDialog_1 = require("../../enums/InstantMessageDialog");
const ImprovedInstantMessage_1 = require("../messages/ImprovedInstantMessage");
const Utils_1 = require("../Utils");
const UUID_1 = require("../UUID");
const Vector3_1 = require("../Vector3");
const PacketFlags_1 = require("../../enums/PacketFlags");
const ChatSourceType_1 = require("../../enums/ChatSourceType");
class InventoryCommands extends CommandsBase_1.CommandsBase {
    getInventoryRoot() {
        return this.agent.inventory.getRootFolderMain();
    }
    getLibraryRoot() {
        return this.agent.inventory.getRootFolderLibrary();
    }
    async getInventoryItem(item) {
        if (typeof item === 'string') {
            item = new UUID_1.UUID(item);
        }
        const result = await this.currentRegion.agent.inventory.fetchInventoryItem(item);
        if (result === null) {
            throw new Error('Unable to get inventory item');
        }
        else {
            return result;
        }
    }
    async acceptInventoryOffer(event) {
        if (event.source === ChatSourceType_1.ChatSourceType.Object) {
            return this.respondToInventoryOffer(event, InstantMessageDialog_1.InstantMessageDialog.TaskInventoryAccepted);
        }
        else {
            return this.respondToInventoryOffer(event, InstantMessageDialog_1.InstantMessageDialog.InventoryAccepted);
        }
    }
    async rejectInventoryOffer(event) {
        if (event.source === ChatSourceType_1.ChatSourceType.Object) {
            await this.respondToInventoryOffer(event, InstantMessageDialog_1.InstantMessageDialog.TaskInventoryDeclined);
            return;
        }
        else {
            await this.respondToInventoryOffer(event, InstantMessageDialog_1.InstantMessageDialog.InventoryDeclined);
            return;
        }
    }
    async respondToInventoryOffer(event, response) {
        const agentName = this.agent.firstName + ' ' + this.agent.lastName;
        const im = new ImprovedInstantMessage_1.ImprovedInstantMessageMessage();
        const folderType = event.type;
        const folder = this.agent.inventory.findFolderForType(folderType);
        const binary = Buffer.allocUnsafe(16);
        folder.writeToBuffer(binary, 0);
        im.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        im.MessageBlock = {
            FromGroup: false,
            ToAgentID: event.from,
            ParentEstateID: 0,
            RegionID: UUID_1.UUID.zero(),
            Position: Vector3_1.Vector3.getZero(),
            Offline: 0,
            Dialog: response,
            ID: event.requestID,
            Timestamp: Math.floor(new Date().getTime() / 1000),
            FromAgentName: Utils_1.Utils.StringToBuffer(agentName),
            Message: Utils_1.Utils.StringToBuffer(''),
            BinaryBucket: binary
        };
        const sequenceNo = this.circuit.sendMessage(im, PacketFlags_1.PacketFlags.Reliable);
        return this.circuit.waitForAck(sequenceNo, 10000);
    }
}
exports.InventoryCommands = InventoryCommands;
//# sourceMappingURL=InventoryCommands.js.map