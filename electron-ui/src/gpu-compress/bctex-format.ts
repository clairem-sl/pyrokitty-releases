/**
 * bctex-format.ts — Binary cache format for pre-compressed BC1/BC3 textures with mipmaps.
 *
 * Header (32 bytes):
 *   magic:     u32 = 0x42435458 ('BCTX')
 *   version:   u32 = 1
 *   width:     u32
 *   height:    u32
 *   format:    u32 (0=BC1/DXT1, 1=BC3/DXT5)
 *   mipCount:  u32
 *   flags:     u32 (bit 0 = has_alpha)
 *   dataSize:  u32 (total compressed data after header)
 *
 * Body: Mip levels concatenated largest-to-smallest
 *   BC1: ceil(w/4) * ceil(h/4) * 8  bytes per mip
 *   BC3: ceil(w/4) * ceil(h/4) * 16 bytes per mip
 */

export const BCTEX_MAGIC = 0x42435458; // 'BCTX'
export const BCTEX_VERSION = 1;
export const BCTEX_HEADER_SIZE = 32;

export const enum BctexFormat {
  BC1 = 0, // DXT1 — no alpha (or 1-bit punchthrough)
  BC3 = 1, // DXT5 — full alpha
}

export interface BctexHeader {
  width: number;
  height: number;
  format: BctexFormat;
  mipCount: number;
  hasAlpha: boolean;
  dataSize: number;
}

/** Bytes required for one mip level of BC-compressed data. */
export function mipLevelSize(width: number, height: number, format: BctexFormat): number {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const bytesPerBlock = format === BctexFormat.BC1 ? 8 : 16;
  return blocksX * blocksY * bytesPerBlock;
}

/** Compute full mip chain sizes from base dimensions. */
export function computeMipChain(
  baseWidth: number,
  baseHeight: number,
  format: BctexFormat,
): { widths: number[]; heights: number[]; sizes: number[]; totalSize: number } {
  const widths: number[] = [];
  const heights: number[] = [];
  const sizes: number[] = [];
  let w = baseWidth;
  let h = baseHeight;
  let totalSize = 0;

  while (w >= 1 && h >= 1) {
    widths.push(w);
    heights.push(h);
    const s = mipLevelSize(w, h, format);
    sizes.push(s);
    totalSize += s;
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }

  return { widths, heights, sizes, totalSize };
}

/** Encode a .bctex file from header + compressed data blob. */
export function encodeBctex(header: BctexHeader, compressedData: Buffer): Buffer {
  const buf = Buffer.alloc(BCTEX_HEADER_SIZE + compressedData.length);
  buf.writeUInt32LE(BCTEX_MAGIC, 0);
  buf.writeUInt32LE(BCTEX_VERSION, 4);
  buf.writeUInt32LE(header.width, 8);
  buf.writeUInt32LE(header.height, 12);
  buf.writeUInt32LE(header.format, 16);
  buf.writeUInt32LE(header.mipCount, 20);
  buf.writeUInt32LE(header.hasAlpha ? 1 : 0, 24);
  buf.writeUInt32LE(header.dataSize, 28);
  compressedData.copy(buf, BCTEX_HEADER_SIZE);
  return buf;
}

/** Decode a .bctex file header. Returns null if magic/version mismatch. */
export function decodeBctexHeader(buf: Buffer): BctexHeader | null {
  if (buf.length < BCTEX_HEADER_SIZE) return null;
  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  if (magic !== BCTEX_MAGIC || version !== BCTEX_VERSION) return null;

  return {
    width: buf.readUInt32LE(8),
    height: buf.readUInt32LE(12),
    format: buf.readUInt32LE(16) as BctexFormat,
    mipCount: buf.readUInt32LE(20),
    hasAlpha: (buf.readUInt32LE(24) & 1) !== 0,
    dataSize: buf.readUInt32LE(28),
  };
}
