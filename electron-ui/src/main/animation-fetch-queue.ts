/**
 * animation-fetch-queue.ts — Downloads SL animation assets, parses them,
 * and converts to JSON for Godot to build Animation resources.
 */

import { AssetType } from '../../node-metaverse/dist/lib';
import type { Bot } from '../../node-metaverse/dist/lib';
import { LLAnimation } from '../../node-metaverse/lib/classes/LLAnimation';

const MAX_CONCURRENT = 4;

/** Parsed animation data ready for Godot */
export interface AnimationData {
  uuid: string;
  duration: number;
  loop: boolean;
  priority: number;
  joints: AnimationJointData[];
}

export interface AnimationJointData {
  name: string;
  priority: number;
  rotationKeys: AnimationKeyframe[];
  positionKeys: AnimationKeyframe[];
}

export interface AnimationKeyframe {
  time: number;
  value: [number, number, number]; // rotation: quat xyz (w reconstructed), position: xyz meters
}

export type AnimationReadyCallback = (animUuid: string, data: AnimationData) => void;

export class AnimationFetchQueue {
  private bot: Bot;
  private onReady: AnimationReadyCallback;
  private pending = new Map<string, Set<number>>(); // animUuid → requesting localIds
  private active = 0;
  private queue: string[] = [];
  private failed = new Set<string>();
  private cache = new Map<string, AnimationData>(); // animUuid → parsed data
  private destroyed = false;

  constructor(bot: Bot, onReady: AnimationReadyCallback) {
    this.bot = bot;
    this.onReady = onReady;
  }

  get queueDepth(): number { return this.queue.length; }
  get activeCount(): number { return this.active; }
  get failedCount(): number { return this.failed.size; }
  get cachedCount(): number { return this.cache.size; }

  request(animUuid: string, localId: number): void {
    if (this.destroyed || this.failed.has(animUuid)) return;

    // Already parsed — notify immediately
    const cached = this.cache.get(animUuid);
    if (cached) {
      this.onReady(animUuid, cached);
      return;
    }

    // Already queued or in-flight
    if (this.pending.has(animUuid)) {
      this.pending.get(animUuid)!.add(localId);
      return;
    }

    this.pending.set(animUuid, new Set([localId]));
    this.queue.push(animUuid);
    this.drain();
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0 && !this.destroyed) {
      const animUuid = this.queue.shift()!;
      this.active++;
      this.fetchAndParse(animUuid).finally(() => {
        this.active--;
        this.pending.delete(animUuid);
        this.drain();
      });
    }
  }

  private async fetchAndParse(animUuid: string): Promise<void> {
    try {
      const buf = await this.bot.clientCommands.asset.downloadAsset(
        AssetType.Animation, animUuid
      );
      const anim = new LLAnimation(buf);
      const data = convertAnimation(animUuid, anim);
      if (!this.destroyed) {
        this.cache.set(animUuid, data);
        this.onReady(animUuid, data);
      }
    } catch (err) {
      console.error(`[AnimFetchQueue] Failed ${animUuid}:`, (err as Error).message || err);
      this.failed.add(animUuid);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.queue = [];
    this.pending.clear();
  }
}

/**
 * Convert parsed LLAnimation to our JSON format.
 *
 * SL rotation keyframes: x,y,z are quaternion components in [-1,1],
 * w = sqrt(1 - x² - y² - z²). Stored as UInt16 compressed.
 *
 * SL position keyframes: x,y,z in [-0.5, 0.5] range (node-metaverse
 * decompresses to [-1, 1] but the actual SL range is [-5, 5] for
 * LL_MAX_PELVIS_OFFSET — only mPelvis typically has position keys).
 */
function convertAnimation(uuid: string, anim: LLAnimation): AnimationData {
  const joints: AnimationJointData[] = [];

  for (const joint of anim.joints) {
    const rotationKeys: AnimationKeyframe[] = [];
    for (const kf of joint.rotationKeyframes) {
      rotationKeys.push({
        time: kf.time,
        value: [kf.transform.x, kf.transform.y, kf.transform.z],
      });
    }

    const positionKeys: AnimationKeyframe[] = [];
    for (const kf of joint.positionKeyframes) {
      // node-metaverse decompresses to [-1, 1] but SL actually uses [-5, 5]
      // Scale by 5 to get meters
      positionKeys.push({
        time: kf.time,
        value: [kf.transform.x * 5, kf.transform.y * 5, kf.transform.z * 5],
      });
    }

    joints.push({
      name: joint.name,
      priority: joint.priority,
      rotationKeys,
      positionKeys,
    });
  }

  return {
    uuid,
    duration: anim.length,
    loop: anim.loop !== 0,
    priority: anim.priority,
    joints,
  };
}
