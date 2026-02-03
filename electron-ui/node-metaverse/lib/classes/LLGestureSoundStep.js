"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLGestureSoundStep = void 0;
const LLGestureStep_1 = require("./LLGestureStep");
const LLGestureStepType_1 = require("../enums/LLGestureStepType");
const LLGestureSoundFlags_1 = require("../enums/LLGestureSoundFlags");
class LLGestureSoundStep extends LLGestureStep_1.LLGestureStep {
    stepType = LLGestureStepType_1.LLGestureStepType.Sound;
    soundName;
    assetID;
    flags = LLGestureSoundFlags_1.LLGestureSoundFlags.None;
}
exports.LLGestureSoundStep = LLGestureSoundStep;
//# sourceMappingURL=LLGestureSoundStep.js.map