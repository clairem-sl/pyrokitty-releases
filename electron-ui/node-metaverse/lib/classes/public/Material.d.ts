import { UUID } from '../UUID';
import { Color4 } from '../Color4';
export declare class Material {
    alphaMaskCutoff: number;
    diffuseAlphaMode: number;
    envIntensity: number;
    normMap: UUID;
    normOffsetX: number;
    normOffsetY: number;
    normRepeatX: number;
    normRepeatY: number;
    normRotation: number;
    specColor: Color4;
    specExp: number;
    specMap: UUID;
    specOffsetX: number;
    specOffsetY: number;
    specRepeatX: number;
    specRepeatY: number;
    specRotation: number;
    static fromLLSD(llsd: string): Material;
    static fromLLSDObject(parsed: any): Material;
    toLLSDObject(): any;
    toLLSD(): string;
    toAsset(uuid: UUID): Promise<Buffer>;
}
//# sourceMappingURL=Material.d.ts.map