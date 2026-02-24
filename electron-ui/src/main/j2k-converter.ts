import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { app } from 'electron';
import sharp from 'sharp';

// ─── Native opj_decompress path ────────────────────────────────────
// These functions use the native opj_decompress/opj_compress binaries.
// Texture decode for the Godot viewer uses the WASM decoder instead
// (see texture-decode-worker.ts + decode-pool.ts).

/** Convert a J2C/J2K buffer to WebP via native opj_decompress + sharp */
export async function j2cToWebp(j2cBuffer: Buffer): Promise<Buffer> {
  const pngBuf = await j2cToPng(j2cBuffer);
  return await sharp(pngBuf).webp({ quality: 80 }).toBuffer();
}

/** Convert a J2C/J2K buffer to PNG via native opj_decompress */
export async function j2cToPng(j2cBuffer: Buffer): Promise<Buffer> {
  const inFile = tmpFile('.j2k');
  const outFile = tmpFile('.png');
  try {
    fs.writeFileSync(inFile, j2cBuffer);
    await run(getDecompressPath(), ['-i', inFile, '-o', outFile]);
    return fs.readFileSync(outFile);
  } finally {
    cleanup(inFile, outFile);
  }
}

// ─── OpenJPEG binary helpers ───

let binDir: string | null = null;

function findBinDir(): string {
  if (binDir) return binDir;

  const appBin = path.join(app.getAppPath(), 'bin');
  if (fs.existsSync(path.join(appBin, 'opj_decompress.exe')) ||
      fs.existsSync(path.join(appBin, 'opj_decompress'))) {
    binDir = appBin;
    return binDir;
  }

  throw new Error(
    'OpenJPEG binaries not found. Place opj_decompress and opj_compress in electron-ui/bin/'
  );
}

function getDecompressPath(): string {
  const dir = findBinDir();
  const name = process.platform === 'win32' ? 'opj_decompress.exe' : 'opj_decompress';
  return path.join(dir, name);
}

function getCompressPath(): string {
  const dir = findBinDir();
  const name = process.platform === 'win32' ? 'opj_compress.exe' : 'opj_compress';
  return path.join(dir, name);
}

function tmpFile(ext: string): string {
  const id = `pksync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return path.join(os.tmpdir(), `${id}${ext}`);
}

function cleanup(...files: string[]): void {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

function run(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${exe} failed: ${error.message}\nstderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Convert a PNG buffer to J2C/J2K (still needs opj_compress binary) */
export async function pngToJ2c(pngBuffer: Buffer): Promise<Buffer> {
  const inFile = tmpFile('.png');
  const outFile = tmpFile('.j2c');

  try {
    fs.writeFileSync(inFile, pngBuffer);
    await run(getCompressPath(), ['-i', inFile, '-o', outFile, '-r', '1']);
    return fs.readFileSync(outFile);
  } finally {
    cleanup(inFile, outFile);
  }
}

/** Check if OpenJPEG binaries are available (needed for pngToJ2c) */
export function isAvailable(): boolean {
  try {
    findBinDir();
    return true;
  } catch {
    return false;
  }
}
