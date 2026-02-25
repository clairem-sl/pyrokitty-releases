/**
 * gpu-compress-queue.ts — Orchestrates GPU BC1/BC3 compression.
 * Pipeline: RGBA buffer → CPU alpha detect → GPU (mipmap gen + BC compress) → .bctex → disk
 * Single IPC round trip per texture, single GPU submit (no sync stalls).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  BctexFormat,
  computeMipChain,
  encodeBctex,
  type BctexHeader,
} from '../gpu-compress/bctex-format';
import { gpuCompressFull, gpuCompressionAvailable } from './gpu-compress-window';

const MAX_CONCURRENT = 4; // max concurrent GPU dispatches

export interface CompressResult {
  cachePath: string;
  format: BctexFormat;
  mipCount: number;
  timeMs: number;
}

interface QueueItem {
  rgba: Buffer;
  width: number;
  height: number;
  cachePath: string;
  resolve: (result: CompressResult) => void;
  reject: (err: Error) => void;
}

export class GpuCompressQueue {
  private queue: QueueItem[] = [];
  private active = 0;
  private destroyed = false;

  get queueDepth(): number { return this.queue.length; }
  get activeCount(): number { return this.active; }

  /**
   * Compress RGBA data to .bctex on disk.
   * Alpha detection on CPU, mipmap generation and BC compression on GPU.
   */
  compress(rgba: Buffer, width: number, height: number, cachePath: string): Promise<CompressResult> {
    if (this.destroyed) return Promise.reject(new Error('Queue destroyed'));
    if (!gpuCompressionAvailable()) return Promise.reject(new Error('GPU not available'));

    return new Promise((resolve, reject) => {
      this.queue.push({ rgba, width, height, cachePath, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0 && !this.destroyed) {
      const item = this.queue.shift()!;
      this.active++;
      this.processItem(item).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }

  private async processItem(item: QueueItem): Promise<void> {
    const startMs = performance.now();
    try {
      const { rgba, width, height, cachePath } = item;

      // CPU alpha detection (~0.1ms, samples ~1000 pixels)
      const hasAlpha = detectAlpha(rgba);
      const format: BctexFormat = hasAlpha ? BctexFormat.BC3 : BctexFormat.BC1;
      const formatFlag: 0 | 1 = hasAlpha ? 1 : 0;

      // Single GPU call: mipmap gen + BC compress (one submit, no sync stalls)
      const { compressedData, mipCount } = await gpuCompressFull(rgba, width, height, formatFlag);

      const header: BctexHeader = {
        width,
        height,
        format,
        mipCount,
        hasAlpha,
        dataSize: compressedData.length,
      };
      const bctexBuf = encodeBctex(header, compressedData);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, bctexBuf);

      const timeMs = performance.now() - startMs;
      item.resolve({ cachePath, format, mipCount, timeMs });
    } catch (err: any) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.queue = [];
  }
}

/** Check if any pixel has alpha < 250 (sampled every ~1000 pixels for speed). */
function detectAlpha(rgba: Buffer): boolean {
  const pixelCount = rgba.length / 4;
  const step = Math.max(1, Math.floor(pixelCount / 1000));
  for (let i = 3; i < rgba.length; i += step * 4) {
    if (rgba[i] < 250) return true;
  }
  return false;
}
