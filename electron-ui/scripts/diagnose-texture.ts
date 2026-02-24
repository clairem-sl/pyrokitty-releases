/**
 * Diagnostic: Compare WASM decoder vs native opj_decompress for a texture.
 * Saves raw J2K, decodes with native tool, and compares pixel values.
 */
import { decode as j2kDecode } from '@abasb75/jpeg2000-decoder';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const cacheDir = path.join(__dirname, '..', '..', 'godot-viewer', 'cache', 'textures');
const diagDir = path.join(cacheDir, 'diag');
const opjDecompress = path.join(__dirname, '..', 'bin', 'opj_decompress.exe');

async function main() {
  const uuid = process.argv[2] || '9b1c3cba-da24-e072-9d0b-5e4da9631e9a';

  const accountsPath = path.join(__dirname, '..', 'data', 'accounts.json');
  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  const account = accounts[0];

  const nmLib = await import('../node-metaverse/dist/lib/index.js');
  const loginParams = new nmLib.LoginParameters();
  loginParams.firstName = account.firstName;
  loginParams.lastName = account.lastName;
  loginParams.password = account.password;

  const bot = new nmLib.Bot(loginParams);
  console.log(`Logging in...`);
  await bot.login();

  fs.mkdirSync(diagDir, { recursive: true });

  const j2cBuf = Buffer.from(await bot.clientCommands.asset.downloadAsset(
    nmLib.AssetType.Texture, uuid
  ));
  console.log(`Downloaded ${j2cBuf.length} bytes`);

  // Save raw J2K
  const j2kPath = path.join(diagDir, `${uuid}.j2k`);
  fs.writeFileSync(j2kPath, j2cBuf);

  // ─── WASM decode ───
  const input = j2cBuf.buffer.slice(j2cBuf.byteOffset, j2cBuf.byteOffset + j2cBuf.byteLength);
  const result = await j2kDecode(input as ArrayBuffer);
  const { width, height, componentCount } = result.frameInfo;
  const wasmRaw = new Uint8Array(result.decodedBuffer);

  const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
  const idx = (cy * width + cx) * componentCount;
  console.log(`\nWASM decode: ${width}x${height}x${componentCount}`);
  console.log(`  center pixel: (${wasmRaw[idx]},${wasmRaw[idx+1]},${wasmRaw[idx+2]},${componentCount>=4?wasmRaw[idx+3]:'N/A'})`);

  // Save WASM result
  const wasmWebp = await sharp(Buffer.from(wasmRaw.buffer), {
    raw: { width, height, channels: componentCount as any },
  }).webp({ quality: 95 }).toBuffer();
  fs.writeFileSync(path.join(diagDir, `${uuid}_wasm.webp`), wasmWebp);

  // ─── Native opj_decompress ───
  const pngPath = path.join(diagDir, `${uuid}_native.png`);
  try {
    execFileSync(opjDecompress, ['-i', j2kPath, '-o', pngPath], { timeout: 10000 });
    console.log(`\nNative opj_decompress: OK`);

    // Read native PNG and sample pixels
    const { data, info } = await sharp(pngPath).raw().toBuffer({ resolveWithObject: true });
    const nativeIdx = (cy * info.width + cx) * info.channels;
    console.log(`  ${info.width}x${info.height}x${info.channels}`);
    console.log(`  center pixel: (${data[nativeIdx]},${data[nativeIdx+1]},${data[nativeIdx+2]},${info.channels>=4?data[nativeIdx+3]:'N/A'})`);

    // Compare WASM vs native
    let diff = 0, maxDiff = 0;
    const minLen = Math.min(wasmRaw.length, data.length);
    for (let i = 0; i < minLen; i++) {
      const d = Math.abs(wasmRaw[i] - data[i]);
      if (d > 1) diff++;
      if (d > maxDiff) maxDiff = d;
    }
    console.log(`\nComparison: ${diff} differing bytes (${(100*diff/minLen).toFixed(1)}%), max diff=${maxDiff}`);

    // If they differ, the WASM decoder has a bug. Show what native produces.
    if (diff > minLen * 0.01) {
      console.log(`\n⚠️  WASM and native decoders produce DIFFERENT output!`);
      console.log(`  Native output saved to: ${pngPath}`);
      console.log(`  WASM output saved to: ${path.join(diagDir, uuid + '_wasm.webp')}`);
    } else {
      console.log(`\n✓ WASM and native decoders match.`);
    }
  } catch (err) {
    console.error(`Native decode failed:`, (err as Error).message?.slice(0, 200));
  }

  try { await bot.close(); } catch {}
  process.exit(0);
}

main().catch(console.error);
