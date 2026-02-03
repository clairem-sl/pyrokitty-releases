import type { ExtendedMeshFlags } from './ExtendedMeshFlags';
export declare class ExtendedMeshData {
    flags: ExtendedMeshFlags;
    constructor(buf?: Buffer, pos?: number, length?: number);
    writeToBuffer(buf: Buffer, pos: number): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=ExtendedMeshData.d.ts.map