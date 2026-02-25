/**
 * test-gpu-compress.ts — Standalone test for GPU BC1/BC3 texture compression.
 * Reads a cached .webp texture, decodes to RGBA, sends to GPU compression, saves as .bctex.
 *
 * Usage: npx tsx scripts/test-gpu-compress.ts [path-to-webp]
 *
 * If no path provided, finds first .webp in the texture cache dir.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import {
  BctexFormat,
  computeMipChain,
  encodeBctex,
  decodeBctexHeader,
  BCTEX_HEADER_SIZE,
  type BctexHeader,
} from '../src/gpu-compress/bctex-format';

// Electron needs to be initialized for BrowserWindow
app.whenReady().then(async () => {
  const inputPath = process.argv[2] || findFirstWebp();
  if (!inputPath) {
    console.error('No .webp file found. Usage: npx tsx scripts/test-gpu-compress.ts [path-to-webp]');
    process.exit(1);
  }

  console.log(`[Test] Input: ${inputPath}`);
  const startTotal = performance.now();

  // Decode to RGBA
  const t0 = performance.now();
  const img = sharp(inputPath);
  const meta = await img.metadata();
  const width = meta.width!;
  const height = meta.height!;
  const rgba = await img.ensureAlpha().raw().toBuffer();
  const decodeMs = performance.now() - t0;
  console.log(`[Test] Decoded ${width}x${height} (${rgba.length} bytes RGBA) in ${decodeMs.toFixed(1)}ms`);

  // Detect alpha
  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 256) {
    if (rgba[i] < 250) { hasAlpha = true; break; }
  }
  const format: BctexFormat = hasAlpha ? BctexFormat.BC3 : BctexFormat.BC1;
  console.log(`[Test] Alpha: ${hasAlpha}, Format: ${format === BctexFormat.BC1 ? 'BC1' : 'BC3'}`);

  // Create hidden window for WebGPU
  const gpuWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const htmlPath = path.join(__dirname, '../src/gpu-compress/index.html');

  // We need the compiled JS — build it first if missing
  const distDir = path.join(__dirname, '../dist/gpu-compress');
  const distJs = path.join(distDir, 'compress.js');
  const distHtml = path.join(distDir, 'index.html');
  const distWgsl = path.join(distDir, 'bc-compress.wgsl');

  if (!fs.existsSync(distJs)) {
    console.log('[Test] Building gpu-compress renderer...');
    const { execSync } = await import('child_process');
    const electronUiDir = path.join(__dirname, '..');
    execSync(
      'npx esbuild src/gpu-compress/compress.ts --bundle --outfile=dist/gpu-compress/compress.js --platform=browser --target=chrome120',
      { cwd: electronUiDir, stdio: 'inherit' },
    );
    fs.mkdirSync(distDir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../src/gpu-compress/index.html'), distHtml);
    fs.copyFileSync(path.join(__dirname, '../src/gpu-compress/bc-compress.wgsl'), distWgsl);
  }

  gpuWindow.loadFile(distHtml);

  // Wait for WebGPU ready
  const available = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);
    ipcMain.once('gpu-compress-ready', (_event, msg: { available: boolean }) => {
      clearTimeout(timeout);
      resolve(msg.available);
    });
  });

  if (!available) {
    console.error('[Test] WebGPU not available — cannot test GPU compression');
    gpuWindow.destroy();
    process.exit(1);
  }

  console.log('[Test] WebGPU ready, starting compression...');

  // Generate mip chain
  const chain = computeMipChain(width, height, format);
  console.log(`[Test] Mip chain: ${chain.widths.length} levels, total ${chain.totalSize} bytes`);

  // Generate mip RGBA buffers
  const t1 = performance.now();
  const mipBuffers: Buffer[] = [rgba];
  for (let i = 1; i < chain.widths.length; i++) {
    const mipBuf = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .resize(chain.widths[i], chain.heights[i], { fit: 'fill', kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer();
    mipBuffers.push(mipBuf);
  }
  const mipGenMs = performance.now() - t1;
  console.log(`[Test] Mipmap generation: ${mipGenMs.toFixed(1)}ms`);

  // Compress each mip level
  const t2 = performance.now();
  const compressedMips: Buffer[] = [];
  let reqId = 0;

  for (let i = 0; i < chain.widths.length; i++) {
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      const id = reqId++;
      const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);

      const handler = (_event: any, msg: { id: number; data?: Uint8Array; error?: string }) => {
        if (msg.id !== id) return;
        ipcMain.removeListener('gpu-compress-response', handler);
        clearTimeout(timeout);
        if (msg.error) reject(new Error(msg.error));
        else resolve(Buffer.from(msg.data!));
      };
      ipcMain.on('gpu-compress-response', handler);

      const mipBuf = mipBuffers[i];
      gpuWindow.webContents.send('gpu-compress-request', {
        id,
        rgba: new Uint8Array(mipBuf.buffer, mipBuf.byteOffset, mipBuf.byteLength),
        width: chain.widths[i],
        height: chain.heights[i],
        format: format === BctexFormat.BC1 ? 0 : 1,
      });
    });
    compressedMips.push(compressed);
  }
  const compressMs = performance.now() - t2;
  console.log(`[Test] GPU compression: ${compressMs.toFixed(1)}ms (${chain.widths.length} mip levels)`);

  // Assemble .bctex
  const totalDataSize = compressedMips.reduce((sum, b) => sum + b.length, 0);
  const dataBlob = Buffer.concat(compressedMips, totalDataSize);

  const header: BctexHeader = {
    width,
    height,
    format,
    mipCount: chain.widths.length,
    hasAlpha,
    dataSize: totalDataSize,
  };
  const bctexBuf = encodeBctex(header, dataBlob);

  // Write output
  const outputPath = inputPath.replace(/\.[^.]+$/, '.bctex');
  fs.writeFileSync(outputPath, bctexBuf);

  const totalMs = performance.now() - startTotal;
  console.log(`\n[Test] Results:`);
  console.log(`  Input:  ${path.basename(inputPath)} (${fs.statSync(inputPath).size} bytes)`);
  console.log(`  Output: ${path.basename(outputPath)} (${bctexBuf.length} bytes)`);
  console.log(`  Format: ${format === BctexFormat.BC1 ? 'BC1/DXT1' : 'BC3/DXT5'}`);
  console.log(`  Mips:   ${chain.widths.length}`);
  console.log(`  Decode: ${decodeMs.toFixed(1)}ms`);
  console.log(`  Mipmaps:${mipGenMs.toFixed(1)}ms`);
  console.log(`  GPU:    ${compressMs.toFixed(1)}ms`);
  console.log(`  Total:  ${totalMs.toFixed(1)}ms`);

  // Verify header
  const verifyBuf = fs.readFileSync(outputPath);
  const verifyHeader = decodeBctexHeader(verifyBuf);
  if (verifyHeader) {
    console.log(`\n[Test] Verification: header OK (${verifyHeader.width}x${verifyHeader.height}, ` +
      `${verifyHeader.format === BctexFormat.BC1 ? 'BC1' : 'BC3'}, ${verifyHeader.mipCount} mips, ` +
      `${verifyHeader.dataSize} data bytes)`);
  } else {
    console.error('[Test] Verification: FAILED to read header');
  }

  gpuWindow.destroy();
  process.exit(0);
});

function findFirstWebp(): string | null {
  const cacheDir = path.join(
    process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming'),
    'pyrokitty-ui', 'asset-cache', 'textures',
  );
  if (!fs.existsSync(cacheDir)) return null;
  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.webp'));
  return files.length > 0 ? path.join(cacheDir, files[0]) : null;
}
