"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLGestureChatStep = void 0;
const LLGestureStep_1 = require("./LLGestureStep");
const LLGestureStepType_1 = require("../enums/LLGestureStepType");
const LLGestureChatFlags_1 = require("../enums/LLGestureChatFlags");
class LLGestureChatStep extends LLGestureStep_1.LLGestureStep {
    stepType = LLGestureStepType_1.LLGestureStepType.Chat;
    chatText;
    flags = LLGestureChatFlags_1.LLGestureChatFlags.None;
}
exports.LLGestureChatStep = LLGestureChatStep;
//# sourceMappingURL=LLGestureChatStep.js.map