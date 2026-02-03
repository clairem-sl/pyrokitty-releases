import type { LLSDTokenType } from './LLSDTokenType';
export interface LLSDToken {
    type: LLSDTokenType;
    value: string;
    rawValue: string;
    dataContainer: {
        input: string;
        index: number;
    };
}
//# sourceMappingURL=LLSDToken.d.ts.map