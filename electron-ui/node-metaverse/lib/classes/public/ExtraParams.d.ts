import { FlexibleData } from './FlexibleData';
import { LightData } from './LightData';
import { LightImageData } from './LightImageData';
import { MeshData } from './MeshData';
import { SculptData } from './SculptData';
import type { UUID } from '../UUID';
import type { Vector3 } from '../Vector3';
import type { Color4 } from '../Color4';
import { ExtendedMeshData } from './ExtendedMeshData';
import { RenderMaterialData } from './RenderMaterialData';
import { ReflectionProbeData } from './ReflectionProbeData';
import type { ExtendedMeshFlags } from './ExtendedMeshFlags';
import type { ReflectionProbeFlags } from './ReflectionProbeFlags';
import type { RenderMaterialParam } from './RenderMaterialParam';
export declare class ExtraParams {
    flexibleData: FlexibleData | null;
    lightData: LightData | null;
    lightImageData: LightImageData | null;
    meshData: MeshData | null;
    sculptData: SculptData | null;
    extendedMeshData: ExtendedMeshData | null;
    renderMaterialData: RenderMaterialData | null;
    reflectionProbeData: ReflectionProbeData | null;
    static getLengthOfParams(buf: Buffer, pos: number): number;
    static from(buf: Buffer): ExtraParams;
    setMeshData(type: number, uuid: UUID): void;
    setExtendedMeshData(flags: ExtendedMeshFlags): void;
    setReflectionProbeData(ambiance: number, clipDistance: number, flags: ReflectionProbeFlags): void;
    setRenderMaterialData(params: RenderMaterialParam[]): void;
    setSculptData(type: number, uuid: UUID): void;
    setFlexiData(softness: number, tension: number, drag: number, gravity: number, wind: number, force: Vector3): void;
    setLightData(color: Color4, radius: number, cutoff: number, falloff: number, intensity: number): void;
    toBuffer(): Buffer;
    toBase64(): string;
}
//# sourceMappingURL=ExtraParams.d.ts.map