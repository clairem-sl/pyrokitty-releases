/**
 * Test: Compare fixed WASM decoder vs native opj_decompress on a known-bad
 * 4-component SL texture (tree with alpha).
 */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the fixed WASM decoder
const { default: decoder } = await import('./packages/2.5.4-decoder/dist/index.mjs');

// Test texture: 4-component tree that was garbled with the old decoder
const j2kPath = 'C:/DeeDrive/dev/phoenix-firestorm/godot-viewer/cache/textures/diag/9b1c3cba-da24-e072-9d0b-5e4da9631e9a.j2k';
const j2kBuf = readFileSync(j2kPath);

console.log(`J2K file: ${j2kBuf.length} bytes`);

// --- WASM decode ---
const ab = j2kBuf.buffer.slice(j2kBuf.byteOffset, j2kBuf.byteOffset + j2kBuf.byteLength);
const result = await decoder.decode(ab);
const { width, height, componentCount, bitsPerSample } = result.frameInfo;
const wasmPixels = new Uint8Array(result.decodedBuffer);

console.log(`\nWASM decode: ${width}x${height}x${componentCount} (${bitsPerSample}bpp)`);
console.log(`  Buffer size: ${wasmPixels.length} (expected: ${width * height * componentCount})`);

// Sample center pixel
const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
const idx = (cy * width + cx) * componentCount;
console.log(`  Center pixel [${cx},${cy}]: R=${wasmPixels[idx]} G=${wasmPixels[idx+1]} B=${wasmPixels[idx+2]}` +
  (componentCount >= 4 ? ` A=${wasmPixels[idx+3]}` : ''));

// --- Native decode ---
const opjExe = 'C:/DeeDrive/dev/phoenix-firestorm/electron-ui/bin/opj_decompress.exe';
const tmpPng = join(tmpdir(), `test_fix_${Date.now()}.png`);

try {
  execFileSync(opjExe, ['-i', j2kPath, '-o', tmpPng], { timeout: 10000, stdio: 'pipe' });

  // Use sharp to read the native PNG
  const sharp = (await import('sharp')).default;
  const { data: nativePixels, info } = await sharp(tmpPng).raw().toBuffer({ resolveWithObject: true });

  console.log(`\nNative decode: ${info.width}x${info.height}x${info.channels}`);
  const nIdx = (cy * info.width + cx) * info.channels;
  console.log(`  Center pixel [${cx},${cy}]: R=${nativePixels[nIdx]} G=${nativePixels[nIdx+1]} B=${nativePixels[nIdx+2]}` +
    (info.channels >= 4 ? ` A=${nativePixels[nIdx+3]}` : ''));

  // --- Compare ---
  const minLen = Math.min(wasmPixels.length, nativePixels.length);
  let diffCount = 0, maxDiff = 0, totalDiff = 0;
  for (let i = 0; i < minLen; i++) {
    const d = Math.abs(wasmPixels[i] - nativePixels[i]);
    if (d > 1) diffCount++;
    if (d > maxDiff) maxDiff = d;
    totalDiff += d;
  }
  const diffPct = (100 * diffCount / minLen).toFixed(2);
  const avgDiff = (totalDiff / minLen).toFixed(2);

  console.log(`\n--- Comparison ---`);
  console.log(`  Pixels compared: ${minLen}`);
  console.log(`  Differing bytes (>1): ${diffCount} (${diffPct}%)`);
  console.log(`  Max diff: ${maxDiff}`);
  console.log(`  Avg diff: ${avgDiff}`);

  if (diffCount < minLen * 0.01) {
    console.log(`\n  ✓ WASM and native decoders MATCH!`);
  } else {
    console.log(`\n  ✗ WASM and native decoders DIFFER`);
  }
} catch (err) {
  console.error('Native decode failed:', err.message);
} finally {
  try { require('fs').unlinkSync(tmpPng); } catch {}
}

process.exit(0);
