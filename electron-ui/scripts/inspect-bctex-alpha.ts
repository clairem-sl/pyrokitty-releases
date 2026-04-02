/**
 * Inspect BC3 .bctex alpha channel — decode alpha blocks and report statistics.
 * Usage: npx tsx scripts/inspect-bctex-alpha.ts <path-to-bctex>
 */

import * as fs from 'fs';

const bctexPath = process.argv[2];
if (!bctexPath) {
  console.error('Usage: npx tsx scripts/inspect-bctex-alpha.ts <path-to-bctex>');
  process.exit(1);
}

const buf = fs.readFileSync(bctexPath);

// Parse header (32 bytes)
const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const width = buf.readUInt32LE(8);
const height = buf.readUInt32LE(12);
const fmt = buf.readUInt32LE(16); // 0=BC1, 1=BC3
const mipCount = buf.readUInt32LE(20);
const flags = buf.readUInt32LE(24);
const dataSize = buf.readUInt32LE(28);

console.log(`Dimensions: ${width}x${height}`);
console.log(`Format: ${fmt === 0 ? 'BC1 (no alpha)' : 'BC3 (full alpha)'}`);
console.log(`Mips: ${mipCount}, Flags: ${flags}, Data: ${dataSize} bytes`);

if (fmt !== 1) {
  console.log('Not BC3 — no alpha blocks to decode.');
  process.exit(0);
}

// Decode BC3 alpha blocks for the base mip level only
const blocksX = Math.ceil(width / 4);
const blocksY = Math.ceil(height / 4);
const blockSize = 16; // BC3 = 16 bytes per block
const headerSize = 32;

// Alpha value histogram (0-255)
const histogram = new Uint32Array(256);
let totalPixels = 0;

// Decode each block's alpha
for (let by = 0; by < blocksY; by++) {
  for (let bx = 0; bx < blocksX; bx++) {
    const blockOffset = headerSize + (by * blocksX + bx) * blockSize;

    // BC3 alpha block: 2 reference alphas + 48 bits of 3-bit indices
    const alpha0 = buf[blockOffset];
    const alpha1 = buf[blockOffset + 1];

    // Build alpha lookup table
    const alphaTable = new Uint8Array(8);
    alphaTable[0] = alpha0;
    alphaTable[1] = alpha1;

    if (alpha0 > alpha1) {
      // 8-value interpolation
      for (let i = 2; i < 8; i++) {
        alphaTable[i] = Math.round(((8 - i) * alpha0 + (i - 1) * alpha1) / 7);
      }
    } else {
      // 6-value interpolation + 0 and 255
      for (let i = 2; i < 6; i++) {
        alphaTable[i] = Math.round(((6 - i) * alpha0 + (i - 1) * alpha1) / 5);
      }
      alphaTable[6] = 0;
      alphaTable[7] = 255;
    }

    // Read 48 bits of indices (6 bytes, 16 pixels × 3 bits)
    const indexBytes = buf.slice(blockOffset + 2, blockOffset + 8);
    // Pack into a 48-bit value (little-endian, 3 bits per pixel)
    let bits = 0n;
    for (let i = 0; i < 6; i++) {
      bits |= BigInt(indexBytes[i]) << BigInt(i * 8);
    }

    for (let p = 0; p < 16; p++) {
      const px = bx * 4 + (p % 4);
      const py = by * 4 + Math.floor(p / 4);
      if (px < width && py < height) {
        const idx = Number((bits >> BigInt(p * 3)) & 0x7n);
        const alphaVal = alphaTable[idx];
        histogram[alphaVal]++;
        totalPixels++;
      }
    }
  }
}

// Report
console.log(`\nTotal pixels decoded: ${totalPixels} (${width}x${height} = ${width * height})`);

// Summary stats
let minAlpha = 255, maxAlpha = 0;
let zeroCount = 0, fullCount = 0, midCount = 0;
for (let a = 0; a < 256; a++) {
  if (histogram[a] > 0) {
    if (a < minAlpha) minAlpha = a;
    if (a > maxAlpha) maxAlpha = a;
    if (a === 0) zeroCount = histogram[a];
    else if (a === 255) fullCount = histogram[a];
    else midCount += histogram[a];
  }
}

console.log(`Alpha range: ${minAlpha} - ${maxAlpha}`);
console.log(`Fully transparent (0):   ${zeroCount} (${(zeroCount / totalPixels * 100).toFixed(1)}%)`);
console.log(`Fully opaque (255):      ${fullCount} (${(fullCount / totalPixels * 100).toFixed(1)}%)`);
console.log(`Semi-transparent (1-254): ${midCount} (${(midCount / totalPixels * 100).toFixed(1)}%)`);

// Show non-zero histogram buckets
console.log(`\nAlpha histogram (non-zero buckets):`);
for (let a = 0; a < 256; a++) {
  if (histogram[a] > 0) {
    const bar = '#'.repeat(Math.min(50, Math.ceil(histogram[a] / totalPixels * 500)));
    console.log(`  ${String(a).padStart(3)}: ${String(histogram[a]).padStart(8)} ${bar}`);
  }
}
