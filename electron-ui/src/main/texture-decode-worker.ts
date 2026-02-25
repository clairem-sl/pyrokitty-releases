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

/** Set to true to always use WASM decoder (cross-platform, no process spawn overhead) */
const USE_WASM = true;

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

let wasmModule: any = null;

async function loadWasmDecoder() {
  if (wasmModule) return;
  // @ts-ignore — CJS default export
  const mod = (await import('@abasb75/jpeg2000-decoder')).default;
  wasmModule = await mod.OpenJPEGWASM();
}

async function decodeWasm(j2cBuffer: Buffer): Promise<Buffer> {
  await loadWasmDecoder();
  const decoder = new wasmModule.J2KDecoder();
  try {
    const encoded = j2cBuffer.buffer.slice(j2cBuffer.byteOffset, j2cBuffer.byteOffset + j2cBuffer.byteLength);
    const encodedBuffer = decoder.getEncodedBuffer(encoded.byteLength);
    encodedBuffer.set(new Uint8Array(encoded));

    decoder.decode();

    const frameInfo = decoder.getFrameInfo();
    const { width, height, componentCount } = frameInfo;
    const decodedView = decoder.getDecodedBuffer(); // view into WASM memory
    const pixels = Buffer.from(decodedView);         // copy OUT of WASM heap

    return await sharp(pixels, {
      raw: { width, height, channels: componentCount as 1 | 2 | 3 | 4 },
    }).webp({ quality: 80 }).toBuffer();
  } finally {
    decoder.delete(); // free WASM memory
  }
}

// ─── Raw RGBA decode (for GPU compression pipeline) ─────────────────

async function decodeWasmRaw(j2cBuffer: Buffer): Promise<{ rgbaPixels: Buffer; width: number; height: number }> {
  await loadWasmDecoder();
  const decoder = new wasmModule.J2KDecoder();
  try {
    const encoded = j2cBuffer.buffer.slice(j2cBuffer.byteOffset, j2cBuffer.byteOffset + j2cBuffer.byteLength);
    const encodedBuffer = decoder.getEncodedBuffer(encoded.byteLength);
    encodedBuffer.set(new Uint8Array(encoded));

    decoder.decode();

    const frameInfo = decoder.getFrameInfo();
    const { width, height, componentCount } = frameInfo;
    const decodedView = decoder.getDecodedBuffer();
    const pixels = Buffer.from(decodedView);

    // Fast path: pad RGB→RGBA or pass through RGBA without sharp overhead
    let rgbaPixels: Buffer;
    if (componentCount === 4) {
      rgbaPixels = pixels;
    } else if (componentCount === 3) {
      const pixelCount = width * height;
      rgbaPixels = Buffer.allocUnsafe(pixelCount * 4);
      for (let i = 0, j = 0; i < pixelCount; i++, j += 3) {
        rgbaPixels[i * 4]     = pixels[j];
        rgbaPixels[i * 4 + 1] = pixels[j + 1];
        rgbaPixels[i * 4 + 2] = pixels[j + 2];
        rgbaPixels[i * 4 + 3] = 255;
      }
    } else {
      // Grayscale or exotic channel counts — fall back to sharp
      rgbaPixels = await sharp(pixels, {
        raw: { width, height, channels: componentCount as 1 | 2 | 3 | 4 },
      }).ensureAlpha().raw().toBuffer();
    }

    return { rgbaPixels, width, height };
  } finally {
    decoder.delete();
  }
}

// ─── Message handler ────────────────────────────────────────────────

parentPort!.on('message', async (msg: { id: number; j2cBuffer: Buffer; mode?: 'webp' | 'raw' }) => {
  try {
    const buf = Buffer.from(msg.j2cBuffer);

    if (msg.mode === 'raw') {
      // Raw RGBA output for GPU compression pipeline
      const { rgbaPixels, width, height } = await decodeWasmRaw(buf);
      parentPort!.postMessage(
        { id: msg.id, rgbaPixels, width, height },
        [rgbaPixels.buffer],
      );
    } else {
      // Default: WebP output for disk cache / Godot fallback
      const webpBuf = (!USE_WASM && opjPath) ? await decodeNative(buf) : await decodeWasm(buf);
      parentPort!.postMessage({ id: msg.id, webpBuf }, [webpBuf.buffer]);
    }
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: (err as Error).message || String(err) });
  }
});
