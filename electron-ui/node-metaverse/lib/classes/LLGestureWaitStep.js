"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLGestureWaitStep = void 0;
const LLGestureStep_1 = require("./LLGestureStep");
const LLGestureStepType_1 = require("../enums/LLGestureStepType");
const LLGestureWaitFlags_1 = require("../enums/LLGestureWaitFlags");
class LLGestureWaitStep extends LLGestureStep_1.LLGestureStep {
    stepType = LLGestureStepType_1.LLGestureStepType.Wait;
    waitTime;
    flags = LLGestureWaitFlags_1.LLGestureWaitFlags.None;
}
exports.LLGestureWaitStep = LLGestureWaitStep;
//# sourceMappingURL=LLGestureWaitStep.js.map