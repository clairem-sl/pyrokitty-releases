/**
 * texture-decode-worker.ts — Runs in a worker thread.
 * Uses WASM OpenJPEG decoder (cross-platform, no native binary needed).
 * Outputs WebP via sharp for compact disk cache, or raw RGBA for GPU compression.
 */
import { parentPort, workerData } from 'worker_threads';
import sharp from 'sharp';

// ─── WASM decoder ────────────────────────────────────────────────────

let wasmModule: any = null;

async function loadWasmDecoder() {
  if (wasmModule) return;
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
    if (!width || !height || !componentCount) {
      throw new Error(`J2C decode returned invalid frameInfo: ${width}x${height} ch=${componentCount} (input=${j2cBuffer.length} bytes, hdr=${j2cBuffer.slice(0,12).toString('hex')})`);
    }
    const decodedView = decoder.getDecodedBuffer(); // view into WASM memory
    let pixels = Buffer.from(decodedView);           // copy OUT of WASM heap

    // SL bake textures have 5 components (RGBA + bump). Sharp only handles 1-4.
    // Strip extra components down to RGBA.
    let channels = componentCount;
    if (componentCount > 4) {
      const pixelCount = width * height;
      const rgba = Buffer.allocUnsafe(pixelCount * 4);
      for (let i = 0; i < pixelCount; i++) {
        rgba[i * 4]     = pixels[i * componentCount];
        rgba[i * 4 + 1] = pixels[i * componentCount + 1];
        rgba[i * 4 + 2] = pixels[i * componentCount + 2];
        rgba[i * 4 + 3] = pixels[i * componentCount + 3];
      }
      pixels = rgba;
      channels = 4;
    }

    return await sharp(pixels, {
      raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
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
    if (!width || !height || !componentCount) {
      throw new Error(`J2C decode returned invalid frameInfo: ${width}x${height} ch=${componentCount} (input=${j2cBuffer.length} bytes, hdr=${j2cBuffer.slice(0,12).toString('hex')})`);
    }
    const decodedView = decoder.getDecodedBuffer();
    const pixels = Buffer.from(decodedView);

    // Fast path: pad RGB→RGBA or pass through RGBA without sharp overhead
    let rgbaPixels: Buffer;
    if (componentCount >= 4) {
      // 4 channels = RGBA. 5+ channels (SL bakes have 5 = RGBA+bump): take first 4.
      if (componentCount === 4) {
        rgbaPixels = pixels;
      } else {
        const pixelCount = width * height;
        rgbaPixels = Buffer.allocUnsafe(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          rgbaPixels[i * 4]     = pixels[i * componentCount];
          rgbaPixels[i * 4 + 1] = pixels[i * componentCount + 1];
          rgbaPixels[i * 4 + 2] = pixels[i * componentCount + 2];
          rgbaPixels[i * 4 + 3] = pixels[i * componentCount + 3];
        }
      }
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
      // Grayscale (1-2 channels) — fall back to sharp
      rgbaPixels = await sharp(pixels, {
        raw: { width, height, channels: componentCount as 1 | 2 },
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
        [rgbaPixels.buffer as ArrayBuffer],
      );
    } else {
      // Default: WebP output for disk cache / Godot fallback
      const webpBuf = await decodeWasm(buf);
      parentPort!.postMessage({ id: msg.id, webpBuf }, [webpBuf.buffer as ArrayBuffer]);
    }
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: (err as Error).message || String(err) });
  }
});
