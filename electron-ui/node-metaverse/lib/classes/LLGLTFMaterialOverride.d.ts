export interface LLGLTFTextureTransformOverride {
    offset?: number[];
    scale?: number[];
    rotation?: number;
}
export declare class LLGLTFMaterialOverride {
    textures?: (string | null)[];
    baseColor?: number[];
    emissiveFactor?: number[];
    metallicFactor?: number;
    roughnessFactor?: number;
    alphaMode?: number;
    alphaCutoff?: number;
    doubleSided?: boolean;
    textureTransforms?: (LLGLTFTextureTransformOverride | null)[];
    static fromFullMaterialJSON(json: string): LLGLTFMaterialOverride;
    getFullMaterialJSON(): string;
    setTexture(idx: number, uuid: string): void;
    setTransform(idx: number, trans: LLGLTFTextureTransformOverride): void;
}
//# sourceMappingURL=LLGLTFMaterialOverride.d.ts.map