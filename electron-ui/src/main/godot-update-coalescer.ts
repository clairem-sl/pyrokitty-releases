/**
 * GodotUpdateCoalescer — Coalesces terse and full object/avatar updates into
 * batched messages, separating physics (velocity) from static updates.
 * Extracted from GodotBridge.
 */

import type { Subscription } from 'rxjs';

export interface UpdateCoalescerDeps {
  /** Check if an object localId is being tracked */
  isTracked(localId: number): boolean;
  /** Check if an avatar UUID is being tracked */
  isAvatarTracked(id: string): boolean;
  /** Get light info for an object, or null */
  getLightInfo(obj: any): any;
  /** Send a message to Godot */
  send(msg: object): void;
}

export class GodotUpdateCoalescer {
  private deps: UpdateCoalescerDeps;
  private updateBuffer: Map<number, any> = new Map();
  private updateSeq: Map<number, number> = new Map();
  private recentTerse = new Set<number>();
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private avatarUpdateBuffer: Map<string, any> = new Map();
  private avatarUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private objectsWithLights = new Set<number>();
  private _debugFlushSeq = 0;

  constructor(deps: UpdateCoalescerDeps) {
    this.deps = deps;
  }

  /** Track that an object has a light (called from sendObject) */
  trackLight(localId: number): void {
    this.objectsWithLights.add(localId);
  }

  /** Check if an object has a tracked light */
  hasLight(localId: number): boolean {
    return this.objectsWithLights.has(localId);
  }

  /** Get or set sequence number for stale-update detection */
  getSeq(localId: number): number {
    return this.updateSeq.get(localId) ?? -1;
  }
  setSeq(localId: number, seq: number): void {
    this.updateSeq.set(localId, seq);
  }

  /** Subscribe to terse and full object update events. Returns subscriptions to track. */
  subscribe(events: any): Subscription[] {
    const subs: Subscription[] = [];

    // Terse updates (position/rotation) — coalesced into batches
    const terseSub = events.onObjectUpdatedTerseEvent.subscribe((event: any) => {
      const obj = event.object;

      // Avatar terse updates — event-driven instead of polling
      if (obj.PCode === 47) {
        const avatarId = obj.FullID?.toString();
        if (avatarId && this.deps.isAvatarTracked(avatarId)) {
          const pos = obj.Position;
          const rot = obj.Rotation;
          const vel = obj.Velocity;
          this.avatarUpdateBuffer.set(avatarId, {
            id: avatarId,
            ...(pos ? { position: [pos.x, pos.y, pos.z] } : {}),
            ...(rot ? { rotation: [rot.x, rot.y, rot.z, rot.w] } : {}),
            ...(vel ? { velocity: [vel.x, vel.y, vel.z] } : {}),
          });
          if (!this.avatarUpdateTimer) {
            this.avatarUpdateTimer = setTimeout(() => {
              this.flushAvatarUpdateBuffer();
              this.avatarUpdateTimer = null;
            }, 16);
          }
        }
        return;
      }

      // Object terse updates
      if (!this.deps.isTracked(obj.ID)) return;

      const seq = event.sequenceNumber;
      const prevSeq = this.updateSeq.get(obj.ID) ?? -1;
      const uid = obj.FullID?.toString() ?? '';
      const pos = obj.Position;

      // Log ALL updates for debug target
      if (uid === 'bbafd512-4ab8-9878-0e68-eba086760821') {
        console.log(`[ObjUpdate] TERSE localId=${obj.ID} seq=${seq} prevSeq=${prevSeq} pos=[${pos?.x.toFixed(2)},${pos?.y.toFixed(2)},${pos?.z.toFixed(2)}] vel=[${obj.Velocity?.x.toFixed(2)},${obj.Velocity?.y.toFixed(2)},${obj.Velocity?.z.toFixed(2)}]`);
      }

      // Drop stale updates — only accept newer sequence numbers
      if (seq < prevSeq) return;
      this.updateSeq.set(obj.ID, seq);

      const rot = obj.Rotation;
      const scl = obj.Scale;
      const vel = obj.Velocity;
      const accel = obj.Acceleration;
      const angVel = obj.AngularVelocity;

      this.updateBuffer.set(obj.ID, {
        localId: obj.ID,
        ...(pos ? { position: [pos.x, pos.y, pos.z] } : {}),
        ...(rot ? { rotation: [rot.x, rot.y, rot.z, rot.w] } : {}),
        ...(scl ? { scale: [scl.x, scl.y, scl.z] } : {}),
        ...(vel ? { velocity: [vel.x, vel.y, vel.z] } : {}),
        ...(accel ? { acceleration: [accel.x, accel.y, accel.z] } : {}),
        ...(angVel ? { angularVelocity: [angVel.x, angVel.y, angVel.z] } : {}),
      });
      this.recentTerse.add(obj.ID);

      // Flush every 16ms (~1 frame) for responsive corrections
      if (!this.updateTimer) {
        this.updateTimer = setTimeout(() => {
          this.flushUpdateBuffer();
          this.updateTimer = null;
        }, 16);
      }
    });
    subs.push(terseSub);

    // Full object updates (may include scale/light changes)
    const fullUpdateSub = events.onObjectUpdatedEvent.subscribe((event: any) => {
      const obj = event.object;
      if (!this.deps.isTracked(obj.ID)) return;

      const seq = event.sequenceNumber;
      const prevSeq = this.updateSeq.get(obj.ID) ?? -1;
      const uid = obj.FullID?.toString() ?? '';
      const pos = obj.Position;

      // Log ALL updates for debug target
      if (uid === 'bbafd512-4ab8-9878-0e68-eba086760821') {
        const terseGuard = this.updateBuffer.get(obj.ID)?.velocity || this.recentTerse.has(obj.ID);
        console.log(`[ObjUpdate] FULL localId=${obj.ID} seq=${seq} prevSeq=${prevSeq} pos=[${pos?.x.toFixed(2)},${pos?.y.toFixed(2)},${pos?.z.toFixed(2)}] vel=[${obj.Velocity?.x.toFixed(2)},${obj.Velocity?.y.toFixed(2)},${obj.Velocity?.z.toFixed(2)}] terseGuard=${terseGuard}`);
      }

      // Drop stale updates — only accept newer sequence numbers
      if (seq < prevSeq) return;
      this.updateSeq.set(obj.ID, seq);
      const rot = obj.Rotation;
      const scl = obj.Scale;
      const vel = obj.Velocity;
      const accel = obj.Acceleration;
      const angVel = obj.AngularVelocity;
      const lightInfo = this.deps.getLightInfo(obj);

      // Detect light removal: object had a light before but doesn't now
      let lightField: Record<string, any> = {};
      if (lightInfo) {
        lightField = { light: lightInfo };
        this.objectsWithLights.add(obj.ID);
      } else if (this.objectsWithLights.has(obj.ID)) {
        // Light was removed — send null so Godot destroys it
        lightField = { light: null };
        this.objectsWithLights.delete(obj.ID);
      }

      // If a terse update recently set motion data, don't overwrite position/velocity —
      // full/compressed updates can carry staler position than the latest terse update.
      const existing = this.updateBuffer.get(obj.ID);
      const terseHasMotion = existing?.velocity || this.recentTerse.has(obj.ID);
      if (terseHasMotion && pos) {
        console.log(`[ObjUpdate] FULL SKIP POS localId=${obj.ID} uuid=${obj.FullID} seq=${seq} (terse guard)`);
      } else if (pos) {
        const ex = existing?.position;
        if (ex) {
          const dx = pos.x - ex[0], dy = pos.y - ex[1], dz = pos.z - ex[2];
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (dist > 0.5) {
            console.log(`[ObjUpdate] FULL JUMP localId=${obj.ID} uuid=${obj.FullID} seq=${seq} dist=${dist.toFixed(2)}`);
          }
        }
      }
      this.updateBuffer.set(obj.ID, {
        ...(existing || {}),
        localId: obj.ID,
        ...(!terseHasMotion && pos ? { position: [pos.x, pos.y, pos.z] } : {}),
        ...(!terseHasMotion && rot ? { rotation: [rot.x, rot.y, rot.z, rot.w] } : {}),
        ...(scl ? { scale: [scl.x, scl.y, scl.z] } : {}),
        ...(!terseHasMotion && vel ? { velocity: [vel.x, vel.y, vel.z] } : {}),
        ...(!terseHasMotion && accel ? { acceleration: [accel.x, accel.y, accel.z] } : {}),
        ...(!terseHasMotion && angVel ? { angularVelocity: [angVel.x, angVel.y, angVel.z] } : {}),
        ...lightField,
      });

      if (!this.updateTimer) {
        this.updateTimer = setTimeout(() => {
          this.flushUpdateBuffer();
          this.updateTimer = null;
        }, 16);
      }
    });
    subs.push(fullUpdateSub);

    return subs;
  }

  private flushUpdateBuffer(): void {
    if (this.updateBuffer.size === 0) return;

    const statics: any[] = [];
    const physics: any[] = [];

    for (const obj of this.updateBuffer.values()) {
      const hasMotion =
        obj.velocity || obj.acceleration || obj.angularVelocity;
      // Tag each entry with a monotonic flush sequence for bridge↔Godot correlation
      obj._fseq = ++this._debugFlushSeq;
      (hasMotion ? physics : statics).push(obj);
    }
    this.updateBuffer.clear();
    this.recentTerse.clear();

    // Log what we're actually flushing for the debug object
    const debugLocalId = 642829107;
    for (const obj of physics) {
      if (obj.localId === debugLocalId) {
        console.log(`[ObjFlush] PHYSICS fseq=${obj._fseq} pos=[${obj.position?.[0]?.toFixed(2)},${obj.position?.[1]?.toFixed(2)},${obj.position?.[2]?.toFixed(2)}] vel=[${obj.velocity?.[0]?.toFixed(2)},${obj.velocity?.[1]?.toFixed(2)},${obj.velocity?.[2]?.toFixed(2)}]`);
      }
    }
    for (const obj of statics) {
      if (obj.localId === debugLocalId) {
        console.log(`[ObjFlush] STATIC fseq=${obj._fseq} pos=[${obj.position?.[0]?.toFixed(2)},${obj.position?.[1]?.toFixed(2)},${obj.position?.[2]?.toFixed(2)}]`);
      }
    }

    if (physics.length > 0) {
      this.deps.send({ type: 'object_update_physics', objects: physics });
    }
    if (statics.length > 0) {
      this.deps.send({ type: 'object_update_batch', objects: statics });
    }
  }

  private flushAvatarUpdateBuffer(): void {
    if (this.avatarUpdateBuffer.size === 0) return;

    const avatars = Array.from(this.avatarUpdateBuffer.values());
    this.avatarUpdateBuffer.clear();

    this.deps.send({
      type: 'avatar_update_batch',
      avatars,
    });
  }

  cleanup(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    if (this.avatarUpdateTimer) {
      clearTimeout(this.avatarUpdateTimer);
      this.avatarUpdateTimer = null;
    }
    this.updateBuffer.clear();
    this.updateSeq.clear();
    this.recentTerse.clear();
    this.objectsWithLights.clear();
    this.avatarUpdateBuffer.clear();
  }
}
