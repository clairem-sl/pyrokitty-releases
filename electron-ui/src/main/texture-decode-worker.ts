/**
 * texture-decode-worker.ts — Runs in a worker thread.
 * On Windows: native opj_decompress (no 50MB WASM heap per worker).
 * Elsewhere: WASM OpenJPEG decoder (no native binary needed).
 * Both paths output WebP via sharp for compact disk cache.
 */
import { parentPort, workerData } from 'worker_threads';
import { execFileSync } from 'child_process';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const workerId = workerData?.workerId ?? process.pid;
let jobCounter = 0;

function tmpPath(ext: string): string {
  return path.join(os.tmpdir(), `pktex_${workerId}_${++jobCounter}${ext}`);
}

// ─── Native path (Windows) ──────────────────────────────────────────

function findOpjDecompress(): string | null {
  if (process.platform !== 'win32') return null;
  const candidates = [
    // Packaged: extraResources puts bin/ at resources/bin/
    ...((process as any).resourcesPath ? [path.join((process as any).resourcesPath, 'bin', 'opj_decompress.exe')] : []),
    // Dev: __dirname = dist/main/, bin is at ../../bin (electron-ui/bin/)
    path.resolve(__dirname, '..', '..', 'bin', 'opj_decompress.exe'),
    path.resolve(__dirname, '..', 'bin', 'opj_decompress.exe'),
    path.join(__dirname, 'opj_decompress.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const opjPath = findOpjDecompress();

async function decodeNative(j2cBuffer: Buffer): Promise<Buffer> {
  const j2kFile = tmpPath('.j2k');
  const pngFile = tmpPath('.png');
  try {
    fs.writeFileSync(j2kFile, j2cBuffer);
    execFileSync(opjPath!, ['-i', j2kFile, '-o', pngFile], {
      timeout: 15000,
      stdio: 'pipe',
    });
    return await sharp(pngFile).webp({ quality: 80 }).toBuffer();
  } finally {
    try { fs.unlinkSync(j2kFile); } catch {}
    try { fs.unlinkSync(pngFile); } catch {}
  }
}

// ─── WASM path (other platforms) ────────────────────────────────────

let j2kDecode: ((ab: ArrayBuffer) => Promise<any>) | null = null;

async function loadWasmDecoder() {
  if (j2kDecode) return;
  // @ts-ignore — CJS default export
  const decoderModule = (await import('@abasb75/jpeg2000-decoder')).default;
  j2kDecode = decoderModule.decode;
}

async function decodeWasm(j2cBuffer: Buffer): Promise<Buffer> {
  await loadWasmDecoder();
  const ab = j2cBuffer.buffer.slice(j2cBuffer.byteOffset, j2cBuffer.byteOffset + j2cBuffer.byteLength);
  const result = await j2kDecode!(ab);
  const { width, height, componentCount } = result.frameInfo;
  const pixels = new Uint8Array(result.decodedBuffer);
  return await sharp(Buffer.from(pixels.buffer), {
    raw: { width, height, channels: componentCount as 1 | 2 | 3 | 4 },
  }).webp({ quality: 80 }).toBuffer();
}

// ─── Message handler ────────────────────────────────────────────────

parentPort!.on('message', async (msg: { id: number; j2cBuffer: Buffer }) => {
  try {
    const buf = Buffer.from(msg.j2cBuffer);
    const webpBuf = opjPath ? await decodeNative(buf) : await decodeWasm(buf);
    parentPort!.postMessage({ id: msg.id, webpBuf }, [webpBuf.buffer]);
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: (err as Error).message || String(err) });
  }
});
