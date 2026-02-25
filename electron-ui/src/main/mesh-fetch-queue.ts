/**
 * mesh-fetch-queue.ts — Concurrent mesh download queue with dedup and caching.
 * Max 4 concurrent downloads; shared meshes fetched once.
 */

import { AssetType, LLMesh } from '../../node-metaverse/dist/lib';
import type { Bot } from '../../node-metaverse/dist/lib';
import { isMeshCached, meshCachePath, ensureMeshCached } from './mesh-converter';

const MAX_CONCURRENT = 4;

export type MeshReadyCallback = (meshUuid: string, cachePath: string) => void;

export class MeshFetchQueue {
  private bot: Bot;
  private onReady: MeshReadyCallback;
  private pending = new Map<string, Set<number>>(); // meshUuid → localIds waiting
  private active = 0;
  private queue: string[] = [];
  private failed = new Set<string>();
  private notified = new Set<string>(); // UUIDs already sent to Godot
  private destroyed = false;

  constructor(bot: Bot, onReady: MeshReadyCallback) {
    this.bot = bot;
    this.onReady = onReady;
  }

  get queueDepth(): number { return this.queue.length; }
  get activeCount(): number { return this.active; }
  get failedCount(): number { return this.failed.size; }
  get notifiedCount(): number { return this.notified.size; }

  request(meshUuid: string, localId: number): void {
    if (this.destroyed || this.failed.has(meshUuid)) return;

    // Already cached and Godot notified — nothing to do
    if (this.notified.has(meshUuid)) return;

    // On disk but Godot doesn't know yet — notify once
    if (isMeshCached(meshUuid)) {
      this.notified.add(meshUuid);
      this.onReady(meshUuid, meshCachePath(meshUuid));
      return;
    }

    // Already queued or in-flight — just track the localId
    if (this.pending.has(meshUuid)) {
      this.pending.get(meshUuid)!.add(localId);
      return;
    }

    this.pending.set(meshUuid, new Set([localId]));
    this.queue.push(meshUuid);
    this.drain();
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0 && !this.destroyed) {
      const meshUuid = this.queue.shift()!;
      this.active++;
      this.fetchAndConvert(meshUuid).finally(() => {
        this.active--;
        this.pending.delete(meshUuid);
        this.drain();
      });
    }
  }

  private async fetchAndConvert(meshUuid: string): Promise<void> {
    try {
      const buf = await this.bot.clientCommands.asset.downloadAsset(
        AssetType.Mesh, meshUuid
      );
      const llmesh = await LLMesh.from(buf);
      const cachePath = await ensureMeshCached(meshUuid, llmesh);
      if (!this.destroyed) {
        this.notified.add(meshUuid);
        this.onReady(meshUuid, cachePath);
      }
    } catch (err) {
      console.error(`[MeshFetchQueue] Failed ${meshUuid}:`, (err as Error).message || err);
      this.failed.add(meshUuid);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.queue = [];
    this.pending.clear();
  }
}
