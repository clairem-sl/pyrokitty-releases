/**
 * Viewer-agnostic resolved material types.
 * Every face — whether legacy or PBR — resolves to a single ResolvedMaterial.
 * Viewers consume this uniform shape without caring about the source.
 */

export interface ResolvedMaterial {
  baseColorTexture: string;      // texture UUID
  baseColorFactor: number[];     // [r, g, b, a]
  normalTexture?: string;
  ormTexture?: string;
  emissiveTexture?: string;
  emissiveFactor: number[];      // [r, g, b]
  metallicFactor: number;
  roughnessFactor: number;
  alphaMode: number;             // 0=opaque, 1=blend, 2=mask, -1=unresolved (viewer decides)
  alphaCutoff: number;
  doubleSided: boolean;
  unshaded: boolean;             // SL fullbright — viewer decides rendering
  repeatU: number;
  repeatV: number;
  offsetU: number;
  offsetV: number;
  rotation: number;
  mappingType?: number;          // 0=default, 2=planar
}

export type MaterialResolvedCallback =
  (objectUuid: string, faceIndex: number, material: ResolvedMaterial) => void;

export interface BakeTextureProvider {
  findOwnerAvatar(parentUuid: string): string | undefined;
  getBakedTextures(avatarId: string): string[] | undefined;
}
