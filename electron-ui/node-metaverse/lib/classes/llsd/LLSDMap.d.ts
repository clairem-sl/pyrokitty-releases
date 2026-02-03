import { LLSDObject } from './LLSDObject';
import type { LLSDTokenGenerator } from './LLSDTokenGenerator';
import type { LLSDType } from './LLSDType';
import type { BinaryReader } from '../BinaryReader';
import type { BinaryWriter } from '../BinaryWriter';
export declare class LLSDMap<T = Record<string, LLSDType>> extends LLSDObject {
    ___data: Map<string, LLSDType>;
    constructor(initialData?: [string, LLSDType][] | Record<string, LLSDType | undefined>);
    static parseNotation<S extends Record<string | number | symbol, LLSDType>>(gen: LLSDTokenGenerator): LLSDMap<S>;
    static parseBinary<S extends Record<string | number | symbol, LLSDType>>(reader: BinaryReader): LLSDMap<S>;
    static parseXML<S extends Record<string | number | symbol, LLSDType>>(element: Record<string, unknown>[]): LLSDMap<S>;
    get length(): number;
    get(key: LLSDType): LLSDType | undefined;
    toJSON(): unknown;
    add(key: string, value: LLSDType): void;
    set(key: string, value: LLSDType): void;
    toNotation(): string;
    toBinary(writer: BinaryWriter): void;
    toXML(): unknown;
    keys(): string[];
}
//# sourceMappingURL=LLSDMap.d.ts.map