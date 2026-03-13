/**
 * texture-fetch-queue.ts — Concurrent texture download queue with dedup and caching.
 * Downloads J2C from SL CDN, decodes to RGBA/WebP via worker thread pool,
 * optionally GPU-compresses to .bctex, writes to disk cache.
 */

import { AssetType } from '../../node-metaverse/dist/lib';
import type { Bot } from '../../node-metaverse/dist/lib';
import { DecodePool } from './decode-pool';
import { GpuCompressQueue } from './gpu-compress-queue';
import { gpuCompressionAvailable } from './gpu-compress-window';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const MAX_CONCURRENT_DOWNLOADS = 16;

// Zero UUID — skip these
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Bake channel names used in appearance service URLs (index = channel)
const BAKE_CHANNEL_URL_NAMES = [
  'head', 'upper', 'lower', 'eyes', 'skirt', 'hair',
  'leftarm', 'leftleg', 'aux1', 'aux2', 'aux3',
];

export type TextureReadyCallback = (textureUuid: string, cachePath: string) => void;

function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'asset-cache', 'textures');
}

/** Primary cache path — .bctex if GPU available, else .webp */
export function textureCachePath(textureUuid: string): string {
  return path.join(getCacheDir(), `${textureUuid}.bctex`);
}

/** WebP fallback path */
function webpCachePath(textureUuid: string): string {
  return path.join(getCacheDir(), `${textureUuid}.webp`);
}

/** Legacy PNG path — used to detect old cache entries */
function legacyPngPath(textureUuid: string): string {
  return path.join(getCacheDir(), `${textureUuid}.png`);
}

export function isTextureCached(textureUuid: string): boolean {
  return fs.existsSync(textureCachePath(textureUuid))
    || fs.existsSync(webpCachePath(textureUuid))
    || fs.existsSync(legacyPngPath(textureUuid));
}

/** Return the actual cached path (.bctex preferred, then .webp, then .png) */
function resolvedCachePath(textureUuid: string): string {
  const bctex = textureCachePath(textureUuid);
  if (fs.existsSync(bctex)) return bctex;
  const webp = webpCachePath(textureUuid);
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
  private gpuQueue: GpuCompressQueue;
  private _gpuCompressCount = 0;
  private _webpFallbackCount = 0;
  // Bake texture metadata: textureUuid → { avatarUuid, channel }
  private bakeInfo = new Map<string, { avatarUuid: string; channel: number }>();

  constructor(bot: Bot, onReady: TextureReadyCallback) {
    this.bot = bot;
    this.onReady = onReady;
    this.decodePool = new DecodePool();
    this.gpuQueue = new GpuCompressQueue();
  }

  get queueDepth(): number { return this.queue.length; }
  get activeCount(): number { return this.active; }
  get failedCount(): number { return this.failed.size; }
  get notifiedCount(): number { return this.notified.size; }
  get gpuCompressCount(): number { return this._gpuCompressCount; }
  get webpFallbackCount(): number { return this._webpFallbackCount; }
  get gpuQueueDepth(): number { return this.gpuQueue.queueDepth; }
  get gpuQueueActive(): number { return this.gpuQueue.activeCount; }

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

  /** Request a baked texture — uses appearance service URL instead of ViewerAsset */
  requestBake(textureUuid: string, localId: number, avatarUuid: string, channel: number): void {
    if (this.destroyed || this.failed.has(textureUuid)) return;
    if (!textureUuid || textureUuid === ZERO_UUID) return;
    if (this.notified.has(textureUuid)) return;

    if (isTextureCached(textureUuid)) {
      this.notified.add(textureUuid);
      this.onReady(textureUuid, resolvedCachePath(textureUuid));
      return;
    }

    // Store bake metadata for the download path
    if (!this.bakeInfo.has(textureUuid)) {
      this.bakeInfo.set(textureUuid, { avatarUuid, channel });
    }

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
      let j2cBuf: Buffer;

      // Check if this is a baked texture — use appearance service URL
      const bake = this.bakeInfo.get(textureUuid);
      if (bake) {
        j2cBuf = await this.downloadBakeTexture(textureUuid, bake.avatarUuid, bake.channel);
        this.bakeInfo.delete(textureUuid);
        console.log(`[BoM] Downloaded bake ${textureUuid.slice(0,8)}: ${j2cBuf.length} bytes`);
      } else {
        // Regular texture: download via ViewerAsset
        j2cBuf = await this.bot.clientCommands.asset.downloadAsset(
          AssetType.Texture, textureUuid
        );
      }

      if (!j2cBuf || j2cBuf.length < 12) {
        console.warn(`[TextureFetchQueue] Skipping ${textureUuid}: empty or too small (${j2cBuf?.length ?? 0} bytes)`);
        this.failed.add(textureUuid);
        return;
      }

      // Try GPU compression path first
      if (gpuCompressionAvailable()) {
        try {
          const raw = await this.decodePool.decodeRaw(j2cBuf);
          const cachePath = textureCachePath(textureUuid); // .bctex
          await this.gpuQueue.compress(raw.rgbaPixels, raw.width, raw.height, cachePath);
          this._gpuCompressCount++;

          if (!this.destroyed) {
            this.notified.add(textureUuid);
            this.onReady(textureUuid, cachePath);
          }
          return;
        } catch (gpuErr: any) {
          // GPU compression failed — fall through to WebP path
          console.warn(`[TextureFetchQueue] GPU compress failed for ${textureUuid}, falling back to WebP: ${gpuErr.message}`);
        }
      }

      // Fallback: WebP path (original behavior)
      const webpBuf = await this.decodePool.decode(j2cBuf);
      const cachePath = webpCachePath(textureUuid);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, webpBuf);
      this._webpFallbackCount++;

      if (!this.destroyed) {
        this.notified.add(textureUuid);
        this.onReady(textureUuid, cachePath);
      }
    } catch (err: any) {
      const msg = err?.message || err?.code || String(err);
      console.error(`[TextureFetchQueue] Failed ${textureUuid}: ${msg}`);
      this.failed.add(textureUuid);
    }
  }

  /** Download a baked texture from the appearance service */
  private async downloadBakeTexture(textureUuid: string, avatarUuid: string, channel: number): Promise<Buffer> {
    const serviceUrl = this.bot.agent?.agentAppearanceService;
    if (!serviceUrl) {
      throw new Error('No agentAppearanceService URL available');
    }

    const channelName = BAKE_CHANNEL_URL_NAMES[channel];
    if (!channelName) {
      throw new Error(`Invalid bake channel index: ${channel}`);
    }

    // URL format: {appearance_service_url}texture/{avatarUUID}/{channelName}/{textureUUID}
    const url = `${serviceUrl}texture/${avatarUuid}/${channelName}/${textureUuid}`;
    console.log(`[BoM] Fetching bake: ${url}`);

    const { net } = require('electron');
    return new Promise<Buffer>((resolve, reject) => {
      const request = net.request({ url, method: 'GET' });
      request.setHeader('Accept', 'image/x-j2c');

      const chunks: Buffer[] = [];
      request.on('response', (response: any) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Bake fetch ${response.statusCode} for ${url}`));
          return;
        }
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', (err: Error) => reject(err));
      });
      request.on('error', (err: Error) => reject(err));
      request.end();
    });
  }

  /** Drop pending queue and failed set for region change. In-flight downloads may still 403 — harmless. */
  clearPending(): void {
    this.queue = [];
    this.pending.clear();
    this.failed.clear();
  }

  destroy(): void {
    this.destroyed = true;
    this.queue = [];
    this.pending.clear();
    this.gpuQueue.destroy();
    this.decodePool.destroy().catch(() => {});
  }
}
