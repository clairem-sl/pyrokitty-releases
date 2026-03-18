/**
 * ObjectReadinessTracker — tracks per-object asset readiness on the TypeScript
 * side so objects arrive at Godot in two clean phases:
 *   Phase 1 (object_create): lightweight placeholder with position/rotation/scale
 *   Phase 2 (object_complete): full mesh + faces + shape once mesh is cached
 *
 * Textures are NOT gated here — Godot applies placeholder materials for uncached
 * textures and progressively refines via _tex_waiting when they arrive.
 */

import type { SendFn } from './godot-bridge-types';

interface PendingObject {
  localId: number;
  needsMesh: string | null;       // meshId or sculptMeshId, null for procedural prims
  meshReady: boolean;
  completeMsg: any;               // the full object_complete message payload
  createdAt: number;
}

export class ObjectReadinessTracker {
  private pending = new Map<number, PendingObject>();        // localId → state
  private meshToObjects = new Map<string, Set<number>>();    // meshId → localIds waiting
  private send: SendFn;

  constructor(send: SendFn) {
    this.send = send;
  }

  /** Register an object for readiness tracking. */
  track(localId: number, meshId: string | null, textureIds: Set<string>, completeMsg: any): void {
    // Remove any prior entry (object re-creation)
    this.remove(localId);

    const entry: PendingObject = {
      localId,
      needsMesh: meshId,
      meshReady: meshId === null, // no mesh needed → already ready
      completeMsg,
      createdAt: Date.now(),
    };
    this.pending.set(localId, entry);

    // Reverse index: mesh → objects
    if (meshId) {
      let set = this.meshToObjects.get(meshId);
      if (!set) {
        set = new Set();
        this.meshToObjects.set(meshId, set);
      }
      set.add(localId);
    }

    // Check if already complete (procedural prim with no mesh needed)
    this.checkAndEmit(localId);
  }

  /** Mark mesh as resolved for all waiting objects. */
  onMeshReady(meshUuid: string): void {
    const localIds = this.meshToObjects.get(meshUuid);
    if (!localIds) return;
    for (const lid of localIds) {
      const entry = this.pending.get(lid);
      if (entry) {
        entry.meshReady = true;
        this.checkAndEmit(lid);
      }
    }
    this.meshToObjects.delete(meshUuid);
  }

  /** Mark mesh as failed — send object_complete with placeholder. */
  onMeshFailed(meshUuid: string): void {
    const localIds = this.meshToObjects.get(meshUuid);
    if (!localIds) return;
    for (const lid of localIds) {
      const entry = this.pending.get(lid);
      if (entry) {
        entry.meshReady = true;
        // Clear the meshId so Godot uses shape or placeholder
        entry.completeMsg.meshId = undefined;
        this.checkAndEmit(lid);
      }
    }
    this.meshToObjects.delete(meshUuid);
  }

  /** No-op — textures no longer gate object completion. Kept for API compat. */
  onTextureReady(_textureUuid: string): void {}

  /** No-op — textures no longer gate object completion. Kept for API compat. */
  onTextureFailed(_textureUuid: string): void {}

  /** No-op — textures no longer gate object completion. Kept for API compat. */
  addTextures(_localId: number, _textureIds: Set<string>): void {}

  /** Remove object from tracking (killed before completion). */
  remove(localId: number): void {
    const entry = this.pending.get(localId);
    if (!entry) return;

    // Clean up reverse index
    if (entry.needsMesh) {
      const set = this.meshToObjects.get(entry.needsMesh);
      if (set) {
        set.delete(localId);
        if (set.size === 0) this.meshToObjects.delete(entry.needsMesh);
      }
    }

    this.pending.delete(localId);
  }

  /** Clear all pending state (region change). */
  clearAll(): void {
    this.pending.clear();
    this.meshToObjects.clear();
  }

  /** Send object_complete for objects that have been pending too long (mesh never arrived). */
  sweepTimeouts(maxAgeMs: number = 30000): void {
    const now = Date.now();
    const timedOut: number[] = [];

    for (const [localId, entry] of this.pending) {
      if (now - entry.createdAt > maxAgeMs) {
        timedOut.push(localId);
      }
    }

    for (const localId of timedOut) {
      const entry = this.pending.get(localId);
      if (!entry) continue;
      const meshStatus = entry.needsMesh ? (entry.meshReady ? 'ready' : 'MISSING') : 'n/a';
      const ageS = ((now - entry.createdAt) / 1000).toFixed(1);
      console.warn(`[ReadinessTracker] Timeout for localId=${localId} (mesh=${meshStatus} id=${entry.needsMesh?.slice(0, 8) || '-'} age=${ageS}s)`);
      this.emit(localId);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Emit as soon as mesh is ready (or no mesh needed). */
  private checkAndEmit(localId: number): void {
    const entry = this.pending.get(localId);
    if (!entry) return;
    if (!entry.meshReady) return;
    this.emit(localId);
  }

  /** Send the object_complete message and clean up. */
  private emit(localId: number): void {
    const entry = this.pending.get(localId);
    if (!entry) return;

    this.send(entry.completeMsg);
    this.remove(localId);
  }
}
