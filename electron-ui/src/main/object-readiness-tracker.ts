/**
 * ObjectReadinessTracker — tracks per-object asset readiness on the TypeScript
 * side so objects arrive at Godot in two clean phases:
 *   Phase 1 (object_create): lightweight placeholder with position/rotation/scale
 *   Phase 2 (object_complete): full mesh + faces + shape once all assets are cached
 */

import type { SendFn } from './godot-bridge-types';

interface PendingObject {
  localId: number;
  needsMesh: string | null;       // meshId or sculptMeshId, null for procedural prims
  needsTextures: Set<string>;     // all texture UUIDs needed
  meshReady: boolean;
  readyTextures: Set<string>;
  completeMsg: any;               // the full object_complete message payload
  createdAt: number;
}

export class ObjectReadinessTracker {
  private pending = new Map<number, PendingObject>();        // localId → state
  private meshToObjects = new Map<string, Set<number>>();    // meshId → localIds waiting
  private textureToObjects = new Map<string, Set<number>>(); // textureId → localIds waiting
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
      needsTextures: new Set(textureIds),
      meshReady: meshId === null, // no mesh needed → already ready
      readyTextures: new Set(),
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

    // Reverse index: texture → objects
    for (const tid of textureIds) {
      let set = this.textureToObjects.get(tid);
      if (!set) {
        set = new Set();
        this.textureToObjects.set(tid, set);
      }
      set.add(localId);
    }

    // Check if already complete (procedural prim with no textures)
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

  /** Mark texture as resolved for all waiting objects. */
  onTextureReady(textureUuid: string): void {
    const localIds = this.textureToObjects.get(textureUuid);
    if (!localIds) return;
    for (const lid of localIds) {
      const entry = this.pending.get(lid);
      if (entry) {
        entry.readyTextures.add(textureUuid);
        this.checkAndEmit(lid);
      }
    }
    this.textureToObjects.delete(textureUuid);
  }

  /** Mark texture as failed — proceed without it. */
  onTextureFailed(textureUuid: string): void {
    const localIds = this.textureToObjects.get(textureUuid);
    if (!localIds) return;
    for (const lid of localIds) {
      const entry = this.pending.get(lid);
      if (entry) {
        // Remove from needed set so it doesn't block completion
        entry.needsTextures.delete(textureUuid);
        this.checkAndEmit(lid);
      }
    }
    this.textureToObjects.delete(textureUuid);
  }

  /** Add texture requirements to an already-tracked object (for deferred texture promotion). */
  addTextures(localId: number, textureIds: Set<string>): void {
    const entry = this.pending.get(localId);
    if (!entry) return;
    for (const tid of textureIds) {
      entry.needsTextures.add(tid);
      let set = this.textureToObjects.get(tid);
      if (!set) {
        set = new Set();
        this.textureToObjects.set(tid, set);
      }
      set.add(localId);
    }
  }

  /** Remove object from tracking (killed before completion). */
  remove(localId: number): void {
    const entry = this.pending.get(localId);
    if (!entry) return;

    // Clean up reverse indices
    if (entry.needsMesh) {
      const set = this.meshToObjects.get(entry.needsMesh);
      if (set) {
        set.delete(localId);
        if (set.size === 0) this.meshToObjects.delete(entry.needsMesh);
      }
    }
    for (const tid of entry.needsTextures) {
      const set = this.textureToObjects.get(tid);
      if (set) {
        set.delete(localId);
        if (set.size === 0) this.textureToObjects.delete(tid);
      }
    }

    this.pending.delete(localId);
  }

  /** Clear all pending state (region change). */
  clearAll(): void {
    this.pending.clear();
    this.meshToObjects.clear();
    this.textureToObjects.clear();
  }

  /** Send partial object_complete for objects that have been pending too long. */
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
      console.warn(`[ReadinessTracker] Timeout for localId=${localId} (mesh=${entry.needsMesh ? (entry.meshReady ? 'ready' : 'MISSING') : 'n/a'}, tex=${entry.readyTextures.size}/${entry.needsTextures.size + entry.readyTextures.size})`);
      this.emit(localId);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Check if all assets are ready and emit if so. */
  private checkAndEmit(localId: number): void {
    const entry = this.pending.get(localId);
    if (!entry) return;
    if (!entry.meshReady) return;

    // Check all textures ready
    for (const tid of entry.needsTextures) {
      if (!entry.readyTextures.has(tid)) return;
    }

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
