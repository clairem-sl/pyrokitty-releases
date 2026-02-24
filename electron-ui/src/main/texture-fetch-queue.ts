/**
 * texture-fetch-queue.ts — Concurrent texture download queue with dedup and caching.
 * Downloads J2C from SL CDN, decodes to WebP via worker thread pool, writes to disk cache.
 */

import { AssetType } from '../../node-metaverse/dist/lib';
import type { Bot } from '../../node-metaverse/dist/lib';
import { DecodePool } from './decode-pool';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const MAX_CONCURRENT_DOWNLOADS = 8;

// Zero UUID — skip these
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export type TextureReadyCallback = (textureUuid: string, cachePath: string) => void;

function getCacheDir(): string {
  const appRoot = app.getAppPath();
  return path.join(appRoot, '..', 'godot-viewer', 'cache', 'textures');
}

export function textureCachePath(textureUuid: string): string {
  return path.join(getCacheDir(), `${textureUuid}.webp`);
}

/** Legacy PNG path — used to detect old cache entries */
function legacyPngPath(textureUuid: string): string {
  return path.join(getCacheDir(), `${textureUuid}.png`);
}

export function isTextureCached(textureUuid: string): boolean {
  return fs.existsSync(textureCachePath(textureUuid)) || fs.existsSync(legacyPngPath(textureUuid));
}

/** Return the actual cached path (WebP preferred, PNG fallback) */
function resolvedCachePath(textureUuid: string): string {
  const webp = textureCachePath(textureUuid);
  if (fs.existsSync(webp)) return webp;
  return legacyPngPath(textureUuid);
}

export class TextureFetchQueue {
  private bot: Bot;
  private onReady: TextureReadyCallback;
  private pending = new Map<string, Set<number>>(); // textureUuid → localIds waiting
  private active = 0;
  private queue: string[] = [];
  private failed = new Set<string>();
  private notified = new Set<string>(); // UUIDs already sent to Godot
  private destroyed = false;
  readonly decodePool: DecodePool;

  constructor(bot: Bot, onReady: TextureReadyCallback) {
    this.bot = bot;
    this.onReady = onReady;
    this.decodePool = new DecodePool();
  }

  request(textureUuid: string, localId: number): void {
    if (this.destroyed || this.failed.has(textureUuid)) return;
    if (!textureUuid || textureUuid === ZERO_UUID) return;

    // Already cached and Godot notified — nothing to do
    if (this.notified.has(textureUuid)) return;

    // On disk but Godot doesn't know yet — notify once
    if (isTextureCached(textureUuid)) {
      this.notified.add(textureUuid);
      this.onReady(textureUuid, resolvedCachePath(textureUuid));
      return;
    }

    // Already queued or in-flight — just track the localId
    if (this.pending.has(textureUuid)) {
      this.pending.get(textureUuid)!.add(localId);
      return;
    }

    this.pending.set(textureUuid, new Set([localId]));
    this.queue.push(textureUuid);
    this.drain();
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENT_DOWNLOADS && this.queue.length > 0 && !this.destroyed) {
      const textureUuid = this.queue.shift()!;
      this.active++;
      this.fetchAndDecode(textureUuid).finally(() => {
        this.active--;
        this.pending.delete(textureUuid);
        this.drain();
      });
    }
  }

  private async fetchAndDecode(textureUuid: string): Promise<void> {
    try {
      // Download on main thread (network-bound)
      const j2cBuf = await this.bot.clientCommands.asset.downloadAsset(
        AssetType.Texture, textureUuid
      );
      if (!j2cBuf || j2cBuf.length < 12) {
        console.warn(`[TextureFetchQueue] Skipping ${textureUuid}: empty or too small (${j2cBuf?.length ?? 0} bytes)`);
        this.failed.add(textureUuid);
        return;
      }

      // Decode in worker thread (CPU-bound, separate WASM heap per worker)
      const webpBuf = await this.decodePool.decode(j2cBuf);

      const cachePath = textureCachePath(textureUuid);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, webpBuf);
      if (!this.destroyed) {
        this.notified.add(textureUuid);
        this.onReady(textureUuid, cachePath);
      }
    } catch (err) {
      console.error(`[TextureFetchQueue] Failed ${textureUuid}:`, (err as Error).message || err);
      this.failed.add(textureUuid);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.queue = [];
    this.pending.clear();
    this.decodePool.destroy().catch(() => {});
  }
}
