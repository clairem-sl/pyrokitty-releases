/**
 * Test whether sharp can decode JPEG2000 / J2K / J2C buffers.
 *
 * Usage:  cd electron-ui && npx tsx scripts/test-sharp-j2k.ts
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  // ---- 1. Check sharp's supported formats ----
  console.log('=== sharp version ===');
  console.log('sharp version:', (sharp as any).versions?.sharp ?? 'unknown');
  console.log('libvips version:', (sharp as any).versions?.vips ?? 'unknown');
  console.log();

  const fmt = (sharp as any).format as Record<string, { input?: { file: boolean; buffer: boolean; stream: boolean }; output?: { file: boolean; buffer: boolean; stream: boolean } }>;
  console.log('=== All supported formats ===');
  for (const [name, info] of Object.entries(fmt)) {
    const canInput = info.input && (info.input.file || info.input.buffer || info.input.stream);
    const canOutput = info.output && (info.output.file || info.output.buffer || info.output.stream);
    console.log(`  ${name.padEnd(14)} input=${canInput ? 'YES' : 'no '}  output=${canOutput ? 'YES' : 'no '}`);
  }
  console.log();

  // Look specifically for jp2k-related names
  const jp2kNames = ['jp2', 'j2k', 'j2c', 'jpeg2000', 'jp2k', 'openjpeg'];
  console.log('=== JPEG2000-related format keys ===');
  for (const name of jp2kNames) {
    if (fmt[name]) {
      console.log(`  FOUND: ${name}`, JSON.stringify(fmt[name]));
    }
  }
  // Also check partial matches
  for (const key of Object.keys(fmt)) {
    if (key.toLowerCase().includes('jp2') || key.toLowerCase().includes('j2') || key.toLowerCase().includes('jpeg2')) {
      console.log(`  MATCH: ${key}`, JSON.stringify(fmt[key]));
    }
  }
  console.log();

  // ---- 2. Test reading a cached .webp to confirm sharp works ----
  const cacheDir = 'C:/Users/callcolor/AppData/Roaming/pyrokitty-ui/cache/textures';
  const webpFiles = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(f => f.endsWith('.webp')) : [];
  if (webpFiles.length > 0) {
    const webpPath = path.join(cacheDir, webpFiles[0]);
    try {
      const meta = await sharp(webpPath).metadata();
      console.log(`=== WebP decode OK ===`);
      console.log(`  File: ${webpFiles[0]}`);
      console.log(`  Size: ${meta.width}x${meta.height}, channels=${meta.channels}, format=${meta.format}`);
    } catch (err: any) {
      console.log(`=== WebP decode FAILED ===`);
      console.log(`  ${err.message}`);
    }
  } else {
    console.log('No .webp files found in texture cache.');
  }
  console.log();

  // ---- 3. Test reading a J2K file from /tmp ----
  const tmpDir = os.tmpdir();
  const j2kFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.j2k') || f.endsWith('.j2c'));
  if (j2kFiles.length > 0) {
    const j2kPath = path.join(tmpDir, j2kFiles[0]);
    const j2kBuf = fs.readFileSync(j2kPath);
    console.log(`=== J2K decode test ===`);
    console.log(`  File: ${j2kFiles[0]} (${j2kBuf.length} bytes)`);
    console.log(`  First 16 bytes: ${Array.from(j2kBuf.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    // Try sharp directly on the J2K buffer
    try {
      const result = await sharp(j2kBuf).webp({ quality: 80 }).toBuffer();
      console.log(`  sharp(j2kBuffer).webp() => SUCCESS! Output ${result.length} bytes`);
      const meta = await sharp(j2kBuf).metadata();
      console.log(`  Metadata: ${meta.width}x${meta.height}, format=${meta.format}`);
    } catch (err: any) {
      console.log(`  sharp(j2kBuffer).webp() => FAILED: ${err.message}`);
    }

    // Also try with explicit raw j2k hint (if supported)
    try {
      const result = await sharp(j2kBuf, { failOn: 'none' }).webp({ quality: 80 }).toBuffer();
      console.log(`  sharp(j2kBuffer, {failOn:'none'}).webp() => SUCCESS! Output ${result.length} bytes`);
    } catch (err: any) {
      console.log(`  sharp(j2kBuffer, {failOn:'none'}).webp() => FAILED: ${err.message}`);
    }

    // Try metadata to see if it can at least identify the format
    try {
      const meta = await sharp(j2kBuf, { failOn: 'none' }).metadata();
      console.log(`  metadata() => format=${meta.format}, size=${meta.width}x${meta.height}`);
    } catch (err: any) {
      console.log(`  metadata() => FAILED: ${err.message}`);
    }
  } else {
    console.log('No .j2k/.j2c files found in temp directory.');
  }

  console.log();
  console.log('=== Conclusion ===');
  const hasJp2 = Object.keys(fmt).some(k =>
    k.toLowerCase().includes('jp2') || k.toLowerCase().includes('j2') || k.toLowerCase().includes('jpeg2')
  );
  if (hasJp2) {
    console.log('sharp HAS some form of JPEG2000 support in its format list.');
  } else {
    console.log('sharp does NOT list any JPEG2000/JP2/J2K format support.');
    console.log('To decode J2C/J2K, you will need a separate library (e.g., openjpeg wasm, or the existing node-metaverse decoder).');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
