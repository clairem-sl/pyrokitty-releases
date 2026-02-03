import { TextureEntryFace } from './TextureEntryFace';
import type { LLGLTFMaterialOverride } from './LLGLTFMaterialOverride';
export declare class TextureEntry {
    static MAX_UINT32: number;
    defaultTexture: TextureEntryFace | null;
    faces: TextureEntryFace[];
    gltfMaterialOverrides: Map<number, LLGLTFMaterialOverride>;
    static readFaceBitfield(buf: Buffer, pos: number): {
        result: boolean;
        pos: number;
        faceBits: number;
        bitfieldSize: number;
    };
    static getFaceBitfieldBuffer(bitfield: number): Buffer;
    static from(buf: Buffer): TextureEntry;
    getEffectiveEntryForFace(face: number): TextureEntryFace;
    toBuffer(): Buffer;
    getChunks(chunks: Buffer[], items: number[], func: (item: TextureEntryFace) => Buffer): void;
    toBase64(): string;
    private createFace;
}
//# sourceMappingURL=TextureEntry.d.ts.map