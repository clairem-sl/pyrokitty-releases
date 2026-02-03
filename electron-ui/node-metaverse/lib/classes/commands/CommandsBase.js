"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandsBase = void 0;
class CommandsBase {
    currentRegion;
    agent;
    bot;
    circuit;
    constructor(region, agent, bot) {
        this.currentRegion = region;
        this.agent = agent;
        this.bot = bot;
        this.circuit = this.currentRegion.circuit;
    }
    shutdown() {
        // optional override
    }
}
exports.CommandsBase = CommandsBase;
//# sourceMappingURL=CommandsBase.js.map