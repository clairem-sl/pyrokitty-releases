"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GridCommands = void 0;
const Message_1 = require("../../enums/Message");
const MapBlockRequest_1 = require("../messages/MapBlockRequest");
const UUID_1 = require("../UUID");
const MapItemRequest_1 = require("../messages/MapItemRequest");
const Utils_1 = require("../Utils");
const GridItemType_1 = require("../../enums/GridItemType");
const CommandsBase_1 = require("./CommandsBase");
const AvatarPickerRequest_1 = require("../messages/AvatarPickerRequest");
const FilterResponse_1 = require("../../enums/FilterResponse");
const MapNameRequest_1 = require("../messages/MapNameRequest");
const GridLayerType_1 = require("../../enums/GridLayerType");
const MapBlock_1 = require("../MapBlock");
const TimeoutError_1 = require("../TimeoutError");
const UUIDNameRequest_1 = require("../messages/UUIDNameRequest");
const MapInfoReplyEvent_1 = require("../../events/MapInfoReplyEvent");
const PacketFlags_1 = require("../../enums/PacketFlags");
const Vector2_1 = require("../Vector2");
const MapInfoRangeReplyEvent_1 = require("../../events/MapInfoRangeReplyEvent");
const AvatarQueryResult_1 = require("../public/AvatarQueryResult");
const MoneyTransferRequest_1 = require("../messages/MoneyTransferRequest");
const MoneyTransactionType_1 = require("../../enums/MoneyTransactionType");
const TransactionFlags_1 = require("../../enums/TransactionFlags");
const MoneyBalanceRequest_1 = require("../messages/MoneyBalanceRequest");
class GridCommands extends CommandsBase_1.CommandsBase {
    async getRegionByName(regionName) {
        const { circuit } = this.currentRegion;
        const msg = new MapNameRequest_1.MapNameRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID,
            Flags: GridLayerType_1.GridLayerType.Objects,
            EstateID: 0,
            Godlike: false
        };
        msg.NameData = {
            Name: Utils_1.Utils.StringToBuffer(regionName)
        };
        circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const responseMsg = await circuit.waitForMessage(Message_1.Message.MapBlockReply, 10000, (filterMsg) => {
            let found = false;
            for (const region of filterMsg.Data) {
                const name = Utils_1.Utils.BufferToStringSimple(region.Name);
                if (name.trim().toLowerCase() === regionName.trim().toLowerCase()) {
                    found = true;
                }
            }
            if (found) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        for (const region of responseMsg.Data) {
            const name = Utils_1.Utils.BufferToStringSimple(region.Name);
            if (name.trim().toLowerCase() === regionName.trim().toLowerCase() && !(region.X === 0 && region.Y === 0)) {
                return new class {
                    X = region.X;
                    Y = region.Y;
                    name = name;
                    access = region.Access;
                    regionFlags = region.RegionFlags;
                    waterHeight = region.WaterHeight;
                    agents = region.Agents;
                    mapImageID = region.MapImageID;
                    handle = Utils_1.Utils.RegionCoordinatesToHandle(region.X * 256, region.Y * 256).regionHandle;
                };
            }
        }
        throw new Error('Region not found');
    }
    async getRegionMapInfo(gridX, gridY) {
        const { circuit } = this.currentRegion;
        const response = new MapInfoReplyEvent_1.MapInfoReplyEvent();
        const msg = new MapBlockRequest_1.MapBlockRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID,
            Flags: 0,
            EstateID: 0,
            Godlike: false
        };
        msg.PositionData = {
            MinX: gridX,
            MaxX: gridX,
            MinY: gridY,
            MaxY: gridY
        };
        circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const responseMsg = await circuit.waitForMessage(Message_1.Message.MapBlockReply, 10000, (filterMsg) => {
            let found = false;
            for (const data of filterMsg.Data) {
                if (data.X === gridX && data.Y === gridY) {
                    found = true;
                }
            }
            if (found) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        for (const data of responseMsg.Data) {
            if (data.X === gridX && data.Y === gridY) {
                response.block = new MapBlock_1.MapBlock();
                response.block.name = Utils_1.Utils.BufferToStringSimple(data.Name);
                response.block.accessFlags = data.Access;
                response.block.mapImage = data.MapImageID;
            }
        }
        //  Now get the region handle
        const regionHandle = Utils_1.Utils.RegionCoordinatesToHandle(gridX * 256, gridY * 256).regionHandle;
        const mi = new MapItemRequest_1.MapItemRequestMessage();
        mi.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: circuit.sessionID,
            Flags: 2,
            EstateID: 0,
            Godlike: false
        };
        mi.RequestData = {
            ItemType: GridItemType_1.GridItemType.AgentLocations,
            RegionHandle: regionHandle
        };
        circuit.sendMessage(mi, PacketFlags_1.PacketFlags.Reliable);
        const minX = gridX * 256;
        const maxX = minX + 256;
        const minY = gridY * 256;
        const maxY = minY + 256;
        response.avatars = [];
        const responseMsg2 = await circuit.waitForMessage(Message_1.Message.MapItemReply, 10000, (filterMsg) => {
            let found = false;
            for (const data of filterMsg.Data) {
                // Check if avatar is within our bounds
                if (data.X >= minX && data.X <= maxX && data.Y >= minY && data.Y <= maxY) {
                    found = true;
                }
            }
            if (found) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            else {
                return FilterResponse_1.FilterResponse.NoMatch;
            }
        });
        for (const data of responseMsg2.Data) {
            for (let index = 0; index <= data.Extra; index++) {
                response.avatars.push(new Vector2_1.Vector2([
                    data.X,
                    data.Y
                ]));
            }
        }
        return response;
    }
    async getRegionMapInfoRange(minX, minY, maxX, maxY) {
        const response = new MapInfoRangeReplyEvent_1.MapInfoRangeReplyEvent();
        try {
            const { circuit } = this.currentRegion;
            const msg = new MapBlockRequest_1.MapBlockRequestMessage();
            msg.AgentData = {
                AgentID: this.agent.agentID,
                SessionID: circuit.sessionID,
                Flags: 0,
                EstateID: 0,
                Godlike: false
            };
            msg.PositionData = {
                MinX: minX,
                MaxX: maxX,
                MinY: minY,
                MaxY: maxY
            };
            response.regions = [];
            circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
            await circuit.waitForMessage(Message_1.Message.MapBlockReply, 30000, (filterMsg) => {
                let found = false;
                for (const data of filterMsg.Data) {
                    if (data.X >= minX && data.X <= maxX && data.Y >= minY && data.Y <= maxY) {
                        found = true;
                        const mapBlock = new MapBlock_1.MapBlock();
                        mapBlock.name = Utils_1.Utils.BufferToStringSimple(data.Name);
                        mapBlock.accessFlags = data.Access;
                        mapBlock.mapImage = data.MapImageID;
                        mapBlock.x = data.X;
                        mapBlock.y = data.Y;
                        mapBlock.waterHeight = data.WaterHeight;
                        mapBlock.regionFlags = data.RegionFlags;
                        response.regions.push(mapBlock);
                    }
                }
                if (found) {
                    return FilterResponse_1.FilterResponse.Match;
                }
                return FilterResponse_1.FilterResponse.NoMatch;
            });
            return response;
        }
        catch (err) {
            if (err instanceof TimeoutError_1.TimeoutError && err.timeout) {
                return response;
            }
            else {
                throw err;
            }
        }
    }
    async avatarName2KeyAndName(name, useCap = true) {
        name = name.trim().replace('.', ' ');
        name = name.toLowerCase();
        if (!name.trim().includes(' ')) {
            name = name.trim() + ' resident';
        }
        if (useCap && await this.currentRegion.caps.isCapAvailable('AvatarPickerSearch')) {
            const trimmedName = name.replace(' resident', '');
            const result = await this.currentRegion.caps.capsGetXML(['AvatarPickerSearch', { page_size: '100', names: trimmedName }]);
            if (result.agents) {
                for (const agent of result.agents) {
                    if (agent.username === undefined) {
                        continue;
                    }
                    const avatarName = agent.legacy_first_name + ' ' + agent.legacy_last_name;
                    if (avatarName.toLowerCase() === name) {
                        return {
                            avatarName,
                            avatarKey: new UUID_1.UUID(agent.id.toString()),
                        };
                    }
                }
            }
        }
        const queryID = UUID_1.UUID.random();
        const aprm = new AvatarPickerRequest_1.AvatarPickerRequestMessage();
        aprm.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID,
            QueryID: queryID
        };
        aprm.Data = {
            Name: Utils_1.Utils.StringToBuffer(name)
        };
        this.circuit.sendMessage(aprm, PacketFlags_1.PacketFlags.Reliable);
        const apr = await this.circuit.waitForMessage(Message_1.Message.AvatarPickerReply, 10000, (filterMsg) => {
            if (filterMsg.AgentData.QueryID.toString() === queryID.toString()) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            else {
                return FilterResponse_1.FilterResponse.NoMatch;
            }
        });
        let foundKey = undefined;
        let foundName = undefined;
        for (const dataBlock of apr.Data) {
            const resultName = (Utils_1.Utils.BufferToStringSimple(dataBlock.FirstName) + ' ' +
                Utils_1.Utils.BufferToStringSimple(dataBlock.LastName));
            if (resultName.toLowerCase() === name) {
                foundKey = dataBlock.AvatarID;
                foundName = resultName;
            }
        }
        if (foundKey !== undefined && foundName !== undefined) {
            return {
                avatarName: foundName,
                avatarKey: foundKey
            };
        }
        else {
            throw new Error('Name not found');
        }
    }
    async avatarName2Key(name, useCap = true) {
        const result = await this.avatarName2KeyAndName(name, useCap);
        return result.avatarKey;
    }
    async getBalance() {
        const msg = new MoneyBalanceRequest_1.MoneyBalanceRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.MoneyData = {
            TransactionID: UUID_1.UUID.zero()
        };
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const result = await this.circuit.waitForMessage(Message_1.Message.MoneyBalanceReply, 10000);
        return result.MoneyData.MoneyBalance;
    }
    async payObject(target, amount) {
        const description = target.name ?? 'Object';
        const targetUUID = target.FullID;
        return this.pay(targetUUID, amount, description, MoneyTransactionType_1.MoneyTransactionType.PayObject);
    }
    async payGroup(target, amount, description) {
        if (typeof target === 'string') {
            target = new UUID_1.UUID(target);
        }
        return this.pay(target, amount, description, MoneyTransactionType_1.MoneyTransactionType.Gift, TransactionFlags_1.TransactionFlags.DestGroup);
    }
    async payAvatar(target, amount, description) {
        if (typeof target === 'string') {
            target = new UUID_1.UUID(target);
        }
        return this.pay(target, amount, description, MoneyTransactionType_1.MoneyTransactionType.Gift, TransactionFlags_1.TransactionFlags.None);
    }
    async avatarKey2Name(uuid) {
        const req = new UUIDNameRequest_1.UUIDNameRequestMessage();
        req.UUIDNameBlock = [];
        let arr = true;
        if (!Array.isArray(uuid)) {
            arr = false;
            uuid = [uuid];
        }
        const waitingFor = {};
        let remaining = 0;
        for (const id of uuid) {
            waitingFor[id.toString()] = null;
            req.UUIDNameBlock.push({ 'ID': id });
            remaining++;
        }
        this.circuit.sendMessage(req, PacketFlags_1.PacketFlags.Reliable);
        await this.circuit.waitForMessage(Message_1.Message.UUIDNameReply, 10000, (reply) => {
            let found = false;
            for (const name of reply.UUIDNameBlock) {
                if (waitingFor[name.ID.toString()] !== undefined) {
                    found = true;
                    if (waitingFor[name.ID.toString()] === null) {
                        waitingFor[name.ID.toString()] = {
                            firstName: Utils_1.Utils.BufferToStringSimple(name.FirstName),
                            lastName: Utils_1.Utils.BufferToStringSimple(name.LastName)
                        };
                        remaining--;
                    }
                }
            }
            if (remaining < 1) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            else if (found) {
                return FilterResponse_1.FilterResponse.Match;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        if (!arr) {
            const result = waitingFor[uuid[0].toString()];
            if (result === null) {
                throw new Error('Avatar not found');
            }
            return new AvatarQueryResult_1.AvatarQueryResult(uuid[0], result.firstName, result.lastName);
        }
        else {
            const response = [];
            for (const k of uuid) {
                const result = waitingFor[k.toString()];
                if (result === null) {
                    throw new Error('Avatar not found');
                }
                const av = new AvatarQueryResult_1.AvatarQueryResult(k, result.firstName, result.lastName);
                response.push(av);
            }
            return response;
        }
    }
    async pay(target, amount, description, type, flags = TransactionFlags_1.TransactionFlags.None) {
        if (amount % 1 !== 0) {
            throw new Error('Amount to pay must be a whole number');
        }
        const msg = new MoneyTransferRequest_1.MoneyTransferRequestMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID
        };
        msg.MoneyData = {
            Description: Utils_1.Utils.StringToBuffer(description),
            DestID: target,
            SourceID: this.agent.agentID,
            TransactionType: type,
            AggregatePermInventory: 0,
            AggregatePermNextOwner: 0,
            Flags: flags,
            Amount: amount
        };
        this.circuit.sendMessage(msg, PacketFlags_1.PacketFlags.Reliable);
        const result = await this.circuit.waitForMessage(Message_1.Message.MoneyBalanceReply, 10000, (mes) => {
            if (mes.TransactionInfo.DestID.equals(target) && mes.TransactionInfo.Amount === amount) {
                return FilterResponse_1.FilterResponse.Finish;
            }
            return FilterResponse_1.FilterResponse.NoMatch;
        });
        if (!result.MoneyData.TransactionSuccess) {
            throw new Error('Payment failed');
        }
    }
}
exports.GridCommands = GridCommands;
//# sourceMappingURL=GridCommands.js.map