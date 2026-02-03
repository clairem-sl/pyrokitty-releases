"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovementCommands = void 0;
const __1 = require("../..");
const MessageClasses_1 = require("../MessageClasses");
const CommandsBase_1 = require("./CommandsBase");
class MovementCommands extends CommandsBase_1.CommandsBase {
    async sitOnObject(targetID, offset) {
        await this.requestSitOnObject(targetID, offset);
        await this.sitOn();
    }
    sitOnGround() {
        this.agent.setControlFlag(__1.ControlFlags.AGENT_CONTROL_SIT_ON_GROUND);
        this.agent.sendAgentUpdate();
    }
    stand() {
        this.agent.clearControlFlag(__1.ControlFlags.AGENT_CONTROL_SIT_ON_GROUND);
        this.agent.setControlFlag(__1.ControlFlags.AGENT_CONTROL_STAND_UP);
        this.agent.sendAgentUpdate();
        this.agent.clearControlFlag(__1.ControlFlags.AGENT_CONTROL_STAND_UP);
        this.agent.sendAgentUpdate();
    }
    async requestSitOnObject(targetID, offset) {
        const msg = new MessageClasses_1.AgentRequestSitMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID,
        };
        msg.TargetObject = {
            TargetID: targetID,
            Offset: offset,
        };
        const seqID = this.circuit.sendMessage(msg, __1.PacketFlags.Reliable);
        return this.circuit.waitForAck(seqID, 10000);
    }
    async sitOn() {
        const msg = new MessageClasses_1.AgentSitMessage();
        msg.AgentData = {
            AgentID: this.agent.agentID,
            SessionID: this.circuit.sessionID,
        };
        const seqID = this.circuit.sendMessage(msg, __1.PacketFlags.Reliable);
        return this.circuit.waitForAck(seqID, 10000);
    }
}
exports.MovementCommands = MovementCommands;
//# sourceMappingURL=MovementCommands.js.map