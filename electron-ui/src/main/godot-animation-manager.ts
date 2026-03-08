/**
 * Manages animation batching for avatars and animesh objects.
 * Deduplicates animation sets, waits for all fetches to complete,
 * then sends a single batch to Godot.
 */

import type { Bot } from '../../node-metaverse/dist/lib';
import { Message } from '../../node-metaverse/dist/lib/enums/Message';
import type { ObjectAnimationMessage } from '../../node-metaverse/dist/lib/classes/messages/ObjectAnimation';
import type { AvatarAnimationMessage } from '../../node-metaverse/dist/lib/classes/messages/AvatarAnimation';
import type { Subscription } from 'rxjs';
import type { AnimationFetchQueue } from './animation-fetch-queue';
import type { SendFn } from './godot-bridge-types';

export class GodotAnimationManager {
  private animRootPending = new Map<number, Set<string>>(); // localId → set of anim UUIDs needed
  private animRootLastSet = new Map<number, string>(); // localId → sorted anim ID string (for dedup)
  private animeshAnimState = new Map<string, { animId: string; sequenceId: number }[]>(); // UUID → latest animation list
  private animeshObjects = new Map<string, number>(); // UUID → localId for animesh objects
  private avatarAnimState = new Map<string, { animId: string; sequenceId: number }[]>(); // avatar UUID → latest animation list
  private animationFetchQueue: AnimationFetchQueue | null = null;
  private connected = false;

  constructor(
    private bot: Bot,
    private send: SendFn,
    private avatarLocalIds: Map<string, number>,
  ) {}

  /** Seed from MetaverseConnection's early ObjectAnimation buffer */
  seedObjectAnimationBuffer(buffer: Map<string, { animId: string; sequenceId: number }[]>): void {
    for (const [uuid, anims] of buffer) {
      this.animeshAnimState.set(uuid, anims);
    }
    console.log(`[GodotBridge] Seeded ${buffer.size} ObjectAnimation entries from login buffer`);
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  initFetchQueue(queue: AnimationFetchQueue): void {
    this.animationFetchQueue = queue;
  }

  /** Register an animesh object UUID → localId mapping */
  registerAnimeshObject(uuid: string, localId: number): void {
    this.animeshObjects.set(uuid, localId);
  }

  /** Get localId for an animesh object by UUID */
  getAnimeshLocalId(uuid: string): number | undefined {
    return this.animeshObjects.get(uuid);
  }

  /** Get buffered object animation state */
  getBufferedObjectAnims(uuid: string): { animId: string; sequenceId: number }[] | undefined {
    return this.animeshAnimState.get(uuid);
  }

  /** Get buffered avatar animation state */
  getBufferedAvatarAnims(id: string): { animId: string; sequenceId: number }[] | undefined {
    return this.avatarAnimState.get(id);
  }

  /** Subscribe to ObjectAnimation circuit messages. Returns subscription or null. */
  subscribeToObjectAnimation(): Subscription | null {
    try {
      const circuit = this.bot.currentRegion?.circuit;
      if (!circuit) return null;
      return circuit.subscribeToMessages([
        Message.ObjectAnimation,
      ], (packet: any) => {
        const msg = packet.message as ObjectAnimationMessage;
        const senderUuid = msg.Sender.ID.toString();
        const animations = msg.AnimationList.map(a => ({
          animId: a.AnimID.toString(),
          sequenceId: a.AnimSequenceID,
        }));

        console.log(`[Animesh] ObjectAnimation received for ${senderUuid.slice(0, 8)}: ${animations.length} anims [${animations.map(a => a.animId.slice(0, 8)).join(', ')}]`);

        this.animeshAnimState.set(senderUuid, animations);

        const localId = this.animeshObjects.get(senderUuid);
        if (localId !== undefined && this.connected) {
          console.log(`[Animesh] ObjectAnimation for localId=${localId} uuid=${senderUuid.slice(0, 8)}: ${animations.length} anims`);
          this.updateAnimSet(localId, animations.map(a => a.animId));
        } else {
          console.log(`[Animesh] Buffering ObjectAnimation for ${senderUuid.slice(0, 8)} (known=${localId !== undefined}, connected=${this.connected})`);
        }
      });
    } catch { return null; }
  }

  /** Subscribe to AvatarAnimation circuit messages. Returns subscription or null. */
  subscribeToAvatarAnimation(): Subscription | null {
    try {
      const circuit = this.bot.currentRegion?.circuit;
      if (!circuit) return null;
      return circuit.subscribeToMessages([
        Message.AvatarAnimation,
      ], (packet: any) => {
        const msg = packet.message as AvatarAnimationMessage;
        const avatarId = msg.Sender.ID.toString();
        const animations = msg.AnimationList.map(a => ({
          animId: a.AnimID.toString(),
          sequenceId: a.AnimSequenceID,
        }));

        this.avatarAnimState.set(avatarId, animations);

        const localId = this.avatarLocalIds.get(avatarId);
        if (localId !== undefined && this.connected) {
          this.updateAnimSet(localId, animations.map(a => a.animId));
        }
      });
    } catch { return null; }
  }

  /**
   * Update the animation set for a root (avatar or animesh object).
   * Dedup: skip if identical to previous set.
   * Batch: request all fetches, then only notify Godot when ALL are cached.
   */
  updateAnimSet(localId: number, animIds: string[]): void {
    const sorted = [...animIds].sort();
    const key = sorted.join(',');
    if (this.animRootLastSet.get(localId) === key) return;
    this.animRootLastSet.set(localId, key);

    const needed = new Set(sorted.filter(id => id.length > 0));
    this.animRootPending.set(localId, needed);

    if (this.animationFetchQueue) {
      for (const animId of needed) {
        this.animationFetchQueue.request(animId, localId);
      }
    }

    this.checkAnimBatchReadyForRoot(localId);
  }

  /** Called when a single animation finishes fetching — check all roots that need it */
  checkAnimBatchReady(animUuid: string): void {
    for (const [localId, needed] of this.animRootPending) {
      if (needed.has(animUuid)) {
        this.checkAnimBatchReadyForRoot(localId);
      }
    }
  }

  /** Reverse-lookup UUID for a localId (checks animesh objects and avatar maps) */
  private getUuidForLocalId(localId: number): string {
    for (const [uuid, lid] of this.animeshObjects) {
      if (lid === localId) return uuid;
    }
    for (const [uuid, lid] of this.avatarLocalIds) {
      if (lid === localId) return uuid;
    }
    return '';
  }

  /** Check if all animations for a specific root are cached. If so, send batch to Godot. */
  private checkAnimBatchReadyForRoot(localId: number): void {
    const needed = this.animRootPending.get(localId);
    if (!needed || needed.size === 0 || !this.animationFetchQueue || !this.connected) return;

    const allData: Record<string, any> = {};
    for (const animId of needed) {
      const cached = this.animationFetchQueue.getCached(animId);
      if (cached) {
        allData[animId] = cached;
      } else if (this.animationFetchQueue.hasFailed(animId)) {
        continue;
      } else {
        return; // Still fetching
      }
    }

    this.animRootPending.delete(localId);
    const animDataArray = Object.values(allData);
    if (animDataArray.length === 0) return;

    const uuid = this.getUuidForLocalId(localId);
    // Check if this is the self avatar
    let isSelf = false;
    try { isSelf = (uuid === this.bot.agent?.agentID?.toString()); } catch {}
    console.log(`[Animesh] Batch ready for localId=${localId} uuid=${uuid.slice(0, 8)}: ${Object.keys(allData).map(id => id.slice(0, 8)).join(', ')}`);
    if (isSelf) {
      const animSummary = Object.entries(allData).map(([id, d]: [string, any]) =>
        `${id.slice(0, 8)}(${d.joints?.length ?? 0}j,${Number(d.duration).toFixed(1)}s,pri=${d.priority ?? '?'})`
      ).join(', ');
      console.log(`[SelfAvatar] Animation batch: ${Object.keys(allData).length} animations — ${animSummary}`);
    }
    this.send({
      type: 'animations_batch',
      localId,
      uuid,
      animations: allData,
    });
  }

  /** Clean up state for a deleted object localId */
  cleanupLocalId(localId: number): void {
    this.animRootPending.delete(localId);
    this.animRootLastSet.delete(localId);
    for (const [uuid, lid] of this.animeshObjects) {
      if (lid === localId) { this.animeshObjects.delete(uuid); break; }
    }
  }

  /** Clean up state for a departed avatar */
  cleanupAvatar(id: string): void {
    this.avatarAnimState.delete(id);
    const avLocalId = this.avatarLocalIds.get(id);
    if (avLocalId !== undefined) {
      this.animRootPending.delete(avLocalId);
      this.animRootLastSet.delete(avLocalId);
    }
  }

  cleanup(): void {
    this.animRootPending.clear();
    this.animRootLastSet.clear();
    this.animeshAnimState.clear();
    this.animeshObjects.clear();
    this.avatarAnimState.clear();
    if (this.animationFetchQueue) {
      this.animationFetchQueue.destroy();
      this.animationFetchQueue = null;
    }
  }
}
