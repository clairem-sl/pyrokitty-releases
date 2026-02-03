import type { LLSDType } from './LLSDType';
import type { LLSDToken } from './LLSDToken';
import type { LLSDTokenGenerator } from './LLSDTokenGenerator';
export declare class LLSDNotation {
    private static readonly tokenSpecs;
    static parseValueToken(gen: LLSDTokenGenerator, initialToken?: LLSDToken): LLSDType;
    static tokenize(input: string): Generator<LLSDToken>;
    static encodeValue(value: LLSDType): string;
    static escapeStringSimple(input: string, quote: string): string;
    static unescapeStringSimple(input: string, quote: string): string;
}
//# sourceMappingURL=LLSDNotation.d.ts.map