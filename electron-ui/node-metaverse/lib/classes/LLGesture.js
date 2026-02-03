"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLGesture = void 0;
const LLGestureStepType_1 = require("../enums/LLGestureStepType");
const LLGestureAnimationStep_1 = require("./LLGestureAnimationStep");
const UUID_1 = require("./UUID");
const LLGestureSoundStep_1 = require("./LLGestureSoundStep");
const LLGestureWaitStep_1 = require("./LLGestureWaitStep");
const LLGestureChatStep_1 = require("./LLGestureChatStep");
class LLGesture {
    version;
    key;
    mask;
    trigger;
    replace;
    steps = [];
    constructor(data) {
        if (data !== undefined) {
            const lines = data.replace(/\r\n/g, '\n').split('\n');
            if (lines.length > 5) {
                this.version = parseInt(lines[0].trim(), 10);
                this.key = parseInt(lines[1].trim(), 10);
                this.mask = parseInt(lines[2].trim(), 10);
                this.trigger = lines[3].trim();
                this.replace = lines[4].trim();
                const stepCount = parseInt(lines[5].trim(), 10);
                let lineNumber = 6;
                for (let step = 0; step < stepCount; step++) {
                    if (lineNumber >= lines.length) {
                        throw new Error('Invalid gesture step - unexpected end of file');
                    }
                    const stepType = parseInt(lines[lineNumber++].trim(), 10);
                    let gestureStep = undefined;
                    switch (stepType) {
                        case LLGestureStepType_1.LLGestureStepType.Animation:
                            {
                                if (lineNumber + 2 >= lines.length) {
                                    throw new Error('Invalid animation gesture step - unexpected end of file');
                                }
                                const animStep = new LLGestureAnimationStep_1.LLGestureAnimationStep();
                                animStep.animationName = lines[lineNumber++].trim();
                                animStep.assetID = new UUID_1.UUID(lines[lineNumber++].trim());
                                animStep.flags = parseInt(lines[lineNumber++].trim(), 10);
                                gestureStep = animStep;
                                break;
                            }
                        case LLGestureStepType_1.LLGestureStepType.Sound:
                            {
                                if (lineNumber + 2 >= lines.length) {
                                    throw new Error('Invalid sound gesture step - unexpected end of file');
                                }
                                const soundStep = new LLGestureSoundStep_1.LLGestureSoundStep();
                                soundStep.soundName = lines[lineNumber++].trim();
                                soundStep.assetID = new UUID_1.UUID(lines[lineNumber++].trim());
                                soundStep.flags = parseInt(lines[lineNumber++].trim(), 10);
                                gestureStep = soundStep;
                                break;
                            }
                        case LLGestureStepType_1.LLGestureStepType.Chat:
                            {
                                if (lineNumber + 1 >= lines.length) {
                                    throw new Error('Invalid chat gesture step - unexpected end of file');
                                }
                                const chatStep = new LLGestureChatStep_1.LLGestureChatStep();
                                chatStep.chatText = lines[lineNumber++].trim();
                                chatStep.flags = parseInt(lines[lineNumber++].trim(), 10);
                                gestureStep = chatStep;
                                break;
                            }
                        case LLGestureStepType_1.LLGestureStepType.Wait:
                            {
                                if (lineNumber + 1 >= lines.length) {
                                    throw new Error('Invalid wait gesture step - unexpected end of file');
                                }
                                const waitStep = new LLGestureWaitStep_1.LLGestureWaitStep();
                                waitStep.waitTime = parseFloat(lines[lineNumber++].trim());
                                waitStep.flags = parseInt(lines[lineNumber++].trim(), 10);
                                gestureStep = waitStep;
                                break;
                            }
                        default:
                            throw new Error('Unknown gesture step type: ' + String(stepType));
                    }
                    if (gestureStep !== undefined) {
                        this.steps.push(gestureStep);
                    }
                }
            }
            else {
                throw new Error('Invalid gesture asset - unexpected end of file');
            }
        }
    }
    toAsset() {
        const lines = [
            String(this.version),
            String(this.key),
            String(this.mask),
            this.trigger,
            this.replace,
            String(this.steps.length)
        ];
        for (const step of this.steps) {
            lines.push(String(step.stepType));
            switch (step.stepType) {
                case LLGestureStepType_1.LLGestureStepType.Animation:
                    {
                        const gStep = step;
                        lines.push(gStep.animationName);
                        lines.push(gStep.assetID.toString());
                        lines.push(String(gStep.flags));
                        break;
                    }
                case LLGestureStepType_1.LLGestureStepType.Sound:
                    {
                        const gStep = step;
                        lines.push(gStep.soundName);
                        lines.push(gStep.assetID.toString());
                        lines.push(String(gStep.flags));
                        break;
                    }
                case LLGestureStepType_1.LLGestureStepType.Chat:
                    {
                        const gStep = step;
                        lines.push(gStep.chatText);
                        lines.push(String(gStep.flags));
                        break;
                    }
                case LLGestureStepType_1.LLGestureStepType.Wait:
                    {
                        const gStep = step;
                        lines.push(gStep.waitTime.toFixed(6));
                        lines.push(String(gStep.flags));
                        break;
                    }
            }
        }
        lines.push('\n');
        return lines.join('\n');
    }
}
exports.LLGesture = LLGesture;
//# sourceMappingURL=LLGesture.js.map