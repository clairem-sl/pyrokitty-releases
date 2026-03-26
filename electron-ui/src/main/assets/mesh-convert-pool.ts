/**
 * mesh-convert-pool.ts — Fixed-size worker pool for LLMesh → GLB conversion.
 * Modeled on DecodePool but simpler: no auto-scaling (conversion is lightweight
 * compared to WASM texture decode).
 */
import { Worker } from 'worker_threads';
import * as path from 'path';

const POOL_SIZE = 2;

export interface MeshConvertResult {
  cachePath: string;
  isRigged: boolean;
  jointNames?: string[];
  jointOverrides?: string[];
}

interface PendingJob {
  id: number;
  resolve: (result: MeshConvertResult) => void;
  reject: (err: Error) => void;
}

interface QueueEntry {
  meshUuid: string;
  rawBuffer: Buffer;
  resolve: (result: MeshConvertResult) => void;
  reject: (err: Error) => void;
}

export class MeshConvertPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: QueueEntry[] = [];
  private pending = new Map<number, PendingJob>();
  private nextId = 0;
  private destroyed = false;

  constructor(private cacheDir: string) {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    const workerPath = path.join(__dirname, 'mesh-convert-worker.js');
    const w = new Worker(workerPath, { workerData: { cacheDir: this.cacheDir } });

    w.on('message', (msg: { id: number; cachePath?: string; isRigged?: boolean; jointNames?: string[]; jointOverrides?: string[]; error?: string }) => {
      const job = this.pending.get(msg.id);
      if (!job) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        job.reject(new Error(msg.error));
      } else {
        job.resolve({
          cachePath: msg.cachePath!,
          isRigged: !!msg.isRigged,
          jointNames: msg.jointNames,
          jointOverrides: msg.jointOverrides,
        });
      }
      this.idle.push(w);
      this.drain();
    });

    w.on('error', (err) => {
      console.error('[MeshConvertPool] Worker error:', err);
    });

    w.on('exit', (code) => {
      if (code !== 0 && !this.destroyed) {
        console.error(`[MeshConvertPool] Worker exited with code ${code}, replacing.`);
        const idx = this.workers.indexOf(w);
        if (idx >= 0) this.workers.splice(idx, 1);
        const idleIdx = this.idle.indexOf(w);
        if (idleIdx >= 0) this.idle.splice(idleIdx, 1);
        this.spawnWorker();
      }
    });

    this.workers.push(w);
    this.idle.push(w);
  }

  get queueDepth(): number { return this.queue.length; }
  get activeCount(): number { return this.pending.size; }

  convert(meshUuid: string, rawBuffer: Buffer): Promise<MeshConvertResult> {
    if (this.destroyed) return Promise.reject(new Error('Pool destroyed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ meshUuid, rawBuffer, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.idle.length > 0 && this.queue.length > 0 && !this.destroyed) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, { id, resolve: job.resolve, reject: job.reject });
      w.postMessage({ id, meshUuid: job.meshUuid, rawBuffer: job.rawBuffer });
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.queue = [];
    for (const job of this.pending.values()) {
      job.reject(new Error('Pool destroyed'));
    }
    this.pending.clear();
    await Promise.all(this.workers.map(w => w.terminate()));
    this.workers = [];
    this.idle = [];
  }
}
