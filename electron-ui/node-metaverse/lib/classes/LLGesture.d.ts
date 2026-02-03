import type { LLGestureStep } from './LLGestureStep';
export declare class LLGesture {
    version: number;
    key: number;
    mask: number;
    trigger: string;
    replace: string;
    steps: LLGestureStep[];
    constructor(data?: string);
    toAsset(): string;
}
//# sourceMappingURL=LLGesture.d.ts.map