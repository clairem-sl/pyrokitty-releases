import type { ReflectionProbeFlags } from './ReflectionProbeFlags';
export declare class ReflectionProbeData {
    ambiance: number;
    clipDistance: number;
    flags: ReflectionProbeFlags;
    constructor(buf?: Buffer, pos?: number, length?: number);
    writeToBuffer(buf: Buffer, pos: number): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=ReflectionProbeData.d.ts.map