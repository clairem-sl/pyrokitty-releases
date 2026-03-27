/**
 * GodotFaceUpdateBatcher — coalesces per-object face updates into batched
 * messages for delivery to Godot over WebSocket.
 *
 * All material resolution logic has moved to MaterialResolver.
 */

import type { SendFn } from './godot-bridge-types';
import type { ResolvedMaterial } from '../materials/resolved-material';

/** Convert a ResolvedMaterial to the legacy Godot face wire format */
export function resolvedToGodotFace(index: number, material: ResolvedMaterial): any {
  const face: any = {
    index,
    textureId: material.baseColorTexture,
    color: material.baseColorFactor,
    fullBright: material.unshaded,
    doubleSided: material.doubleSided,
    alphaMode: material.alphaMode,
    alphaCutoff: material.alphaCutoff,
    repeatU: material.repeatU,
    repeatV: material.repeatV,
    offsetU: material.offsetU,
    offsetV: material.offsetV,
    rotation: material.rotation,
  };
  if (material.mappingType) face.mappingType = material.mappingType;
  if (material.normalTexture) face.normalTextureId = material.normalTexture;
  if (material.ormTexture) face.ormTextureId = material.ormTexture;
  if (material.emissiveTexture) face.emissiveTextureId = material.emissiveTexture;
  if (material.metallicFactor !== 0) face.metallicFactor = material.metallicFactor;
  if (material.roughnessFactor !== 1) face.roughnessFactor = material.roughnessFactor;
  if (material.emissiveFactor.some(v => v !== 0)) face.emissiveFactor = material.emissiveFactor;

  return face;
}

export class GodotFaceUpdateBatcher {
  private faceUpdateBuffer = new Map<string, any[]>();
  private faceUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FACE_UPDATE_FLUSH_MS = 50;

  constructor(private send: SendFn) {}

  /** Queue a face update for batched delivery to Godot. Multiple updates for the same
   *  object within the flush window are coalesced (latest per face index wins). */
  queueFaceUpdate(objectUuid: string, faces: any[]): void {
    const existing = this.faceUpdateBuffer.get(objectUuid);
    if (existing) {
      for (const face of faces) {
        const idx = existing.findIndex((f: any) => f.index === face.index);
        if (idx >= 0) {
          existing[idx] = face;
        } else {
          existing.push(face);
        }
      }
    } else {
      this.faceUpdateBuffer.set(objectUuid, [...faces]);
    }
    if (!this.faceUpdateTimer) {
      this.faceUpdateTimer = setTimeout(() => this.flushFaceUpdates(), GodotFaceUpdateBatcher.FACE_UPDATE_FLUSH_MS);
    }
  }

  private flushFaceUpdates(): void {
    this.faceUpdateTimer = null;
    if (this.faceUpdateBuffer.size === 0) return;

    const objects: any[] = [];
    for (const [uuid, faces] of this.faceUpdateBuffer) {
      objects.push({ uuid, faces });
    }
    this.faceUpdateBuffer.clear();

    this.send({ type: 'object_update_faces_batch', objects });
  }

  cleanup(): void {
    if (this.faceUpdateTimer) {
      clearTimeout(this.faceUpdateTimer);
      this.faceUpdateTimer = null;
    }
    this.faceUpdateBuffer.clear();
  }
}
