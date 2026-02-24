/**
 * decode-pool.ts — Worker thread pool for JPEG2000 decode via WASM OpenJPEG.
 */
import { Worker } from 'worker_threads';
import * as path from 'path';

const POOL_SIZE = 8;

interface PendingJob {
  id: number;
  resolve: (webpBuf: Buffer) => void;
  reject: (err: Error) => void;
}

export class DecodePool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { j2cBuffer: Buffer; resolve: (buf: Buffer) => void; reject: (err: Error) => void }[] = [];
  private pending = new Map<number, PendingJob>();
  private nextId = 0;
  private destroyed = false;

  constructor() {
    const workerPath = path.join(__dirname, 'texture-decode-worker.js');
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(workerPath, { workerData: { workerId: i } });
      w.on('message', (msg: { id: number; webpBuf?: Buffer; error?: string }) => {
        const job = this.pending.get(msg.id);
        if (!job) return;
        this.pending.delete(msg.id);

        if (msg.error) {
          job.reject(new Error(msg.error));
        } else {
          job.resolve(Buffer.from(msg.webpBuf!));
        }

        // Return worker to idle pool and drain queue
        this.idle.push(w);
        this.drain();
      });
      w.on('error', (err) => {
        console.error('[DecodePool] Worker error:', err);
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get queueDepth(): number { return this.queue.length; }
  get activeCount(): number { return this.pending.size; }

  decode(j2cBuffer: Buffer): Promise<Buffer> {
    if (this.destroyed) return Promise.reject(new Error('Pool destroyed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ j2cBuffer, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.idle.length > 0 && this.queue.length > 0 && !this.destroyed) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, { id, resolve: job.resolve, reject: job.reject });
      worker.postMessage({ id, j2cBuffer: job.j2cBuffer });
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
