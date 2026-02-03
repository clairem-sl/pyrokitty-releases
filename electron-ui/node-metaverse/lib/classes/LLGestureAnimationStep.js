"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLGestureAnimationStep = void 0;
const LLGestureStep_1 = require("./LLGestureStep");
const LLGestureStepType_1 = require("../enums/LLGestureStepType");
const LLGestureAnimationFlags_1 = require("../enums/LLGestureAnimationFlags");
class LLGestureAnimationStep extends LLGestureStep_1.LLGestureStep {
    stepType = LLGestureStepType_1.LLGestureStepType.Animation;
    animationName;
    assetID;
    flags = LLGestureAnimationFlags_1.LLGestureAnimationFlags.None;
}
exports.LLGestureAnimationStep = LLGestureAnimationStep;
//# sourceMappingURL=LLGestureAnimationStep.js.map