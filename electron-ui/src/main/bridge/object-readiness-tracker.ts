/**
 * ObjectReadinessTracker — tracks per-object asset readiness on the TypeScript
 * side so objects arrive at Godot in two clean phases:
 *   Phase 1 (object_create): lightweight placeholder with position/rotation/scale
 *   Phase 2 (object_complete): full mesh + faces + shape once mesh is cached
 *
 * Textures are NOT gated here — Godot applies placeholder materials for uncached
 * textures and progressively refines via _tex_waiting when they arrive.
 *
 * Objects are keyed by UUID (not localId) for multi-region safety.
 */

import type { SendFn } from './godot-bridge-types';

interface PendingObject {
  uuid: string;
  needsMesh: string | null;       // meshId or sculptMeshId, null for procedural prims
  meshReady: boolean;
  completeMsg: any;               // the full object_complete message payload
  createdAt: number;
}

export class ObjectReadinessTracker {
  private pending = new Map<string, PendingObject>();        // object UUID → state
  private meshToObjects = new Map<string, Set<string>>();    // meshId → object UUIDs waiting
  private send: SendFn;

  constructor(send: SendFn) {
    this.send = send;
  }

  /** Register an object for readiness tracking. */
  track(uuid: string, meshId: string | null, textureIds: Set<string>, completeMsg: any): void {
    // Remove any prior entry (object re-creation)
    this.remove(uuid);

    const entry: PendingObject = {
      uuid,
      needsMesh: meshId,
      meshReady: meshId === null, // no mesh needed → already ready
      completeMsg,
      createdAt: Date.now(),
    };
    this.pending.set(uuid, entry);

    // Reverse index: mesh → objects
    if (meshId) {
      let set = this.meshToObjects.get(meshId);
      if (!set) {
        set = new Set();
        this.meshToObjects.set(meshId, set);
      }
      set.add(uuid);
    }

    // Check if already complete (procedural prim with no mesh needed)
    this.checkAndEmit(uuid);
  }

  /** Mark mesh as resolved for all waiting objects. */
  onMeshReady(meshUuid: string): void {
    const objectUuids = this.meshToObjects.get(meshUuid);
    if (!objectUuids) return;
    for (const uuid of objectUuids) {
      const entry = this.pending.get(uuid);
      if (entry) {
        entry.meshReady = true;
        this.checkAndEmit(uuid);
      }
    }
    this.meshToObjects.delete(meshUuid);
  }

  /** Mark mesh as failed — send object_complete with placeholder. */
  onMeshFailed(meshUuid: string): void {
    const objectUuids = this.meshToObjects.get(meshUuid);
    if (!objectUuids) return;
    for (const uuid of objectUuids) {
      const entry = this.pending.get(uuid);
      if (entry) {
        entry.meshReady = true;
        // Clear the meshId so Godot uses shape or placeholder
        entry.completeMsg.meshId = undefined;
        this.checkAndEmit(uuid);
      }
    }
    this.meshToObjects.delete(meshUuid);
  }

  /** No-op — textures no longer gate object completion. Kept for API compat. */
  onTextureReady(_textureUuid: string): void {}

  /** No-op — textures no longer gate object completion. Kept for API compat. */
  onTextureFailed(_textureUuid: string): void {}

  /** No-op — textures no longer gate object completion. Kept for API compat. */
  addTextures(_uuid: string, _textureIds: Set<string>): void {}

  /**
   * Patch a pending object_complete's face data before it ships.
   * Called when async material resolution (PBR or legacy) completes while
   * the object is still waiting for its mesh. Returns true if patched.
   */
  updatePendingFaces(uuid: string, faceData: any): boolean {
    const entry = this.pending.get(uuid);
    if (!entry) return false;

    if (!entry.completeMsg.faces) {
      entry.completeMsg.faces = [faceData];
    } else {
      const idx = entry.completeMsg.faces.findIndex((f: any) => f.index === faceData.index);
      if (idx >= 0) {
        entry.completeMsg.faces[idx] = faceData;
      } else {
        entry.completeMsg.faces.push(faceData);
      }
    }
    return true;
  }

  /** Remove object from tracking (killed before completion). */
  remove(uuid: string): void {
    const entry = this.pending.get(uuid);
    if (!entry) return;

    // Clean up reverse index
    if (entry.needsMesh) {
      const set = this.meshToObjects.get(entry.needsMesh);
      if (set) {
        set.delete(uuid);
        if (set.size === 0) this.meshToObjects.delete(entry.needsMesh);
      }
    }

    this.pending.delete(uuid);
  }

  /** Clear all pending state (region change). */
  clearAll(): void {
    this.pending.clear();
    this.meshToObjects.clear();
  }

  /** Log objects that have been pending a long time (mesh not yet arrived). */
  sweepTimeouts(maxAgeMs: number = 30000): void {
    const now = Date.now();
    let staleCount = 0;

    for (const [, entry] of this.pending) {
      if (now - entry.createdAt > maxAgeMs && !entry.meshReady) {
        staleCount++;
      }
    }

    if (staleCount > 0) {
      console.log(`[ReadinessTracker] ${staleCount} objects still waiting for mesh (>${(maxAgeMs / 1000).toFixed(0)}s)`);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Emit as soon as mesh is ready (or no mesh needed). */
  private checkAndEmit(uuid: string): void {
    const entry = this.pending.get(uuid);
    if (!entry) return;
    if (!entry.meshReady) return;
    this.emit(uuid);
  }

  /** Send the object_complete message and clean up. */
  private emit(uuid: string): void {
    const entry = this.pending.get(uuid);
    if (!entry) return;

    this.send(entry.completeMsg);
    this.remove(uuid);
  }
}
