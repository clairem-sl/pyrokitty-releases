import { describe, it, expect } from 'vitest';
import {
  BCTEX_MAGIC,
  BCTEX_VERSION,
  BCTEX_HEADER_SIZE,
  mipLevelSize,
  computeMipChain,
  encodeBctex,
  decodeBctexHeader,
  type BctexHeader,
} from '../bctex-format';

// BctexFormat is a const enum, so use numeric values directly
const BC1 = 0;
const BC3 = 1;

describe('bctex-format', () => {
  describe('mipLevelSize', () => {
    it('computes BC1 size for 4x4 (minimum block)', () => {
      // 1 block x 1 block x 8 bytes/block = 8
      expect(mipLevelSize(4, 4, BC1)).toBe(8);
    });

    it('computes BC3 size for 4x4 (minimum block)', () => {
      // 1 block x 1 block x 16 bytes/block = 16
      expect(mipLevelSize(4, 4, BC3)).toBe(16);
    });

    it('computes BC1 size for 256x256', () => {
      // 64 blocks x 64 blocks x 8 = 32768
      expect(mipLevelSize(256, 256, BC1)).toBe(32768);
    });

    it('computes BC3 size for 256x256', () => {
      // 64 blocks x 64 blocks x 16 = 65536
      expect(mipLevelSize(256, 256, BC3)).toBe(65536);
    });

    it('computes BC1 size for 1024x1024', () => {
      // 256 * 256 * 8 = 524288
      expect(mipLevelSize(1024, 1024, BC1)).toBe(524288);
    });

    it('rounds up non-multiple-of-4 dimensions', () => {
      // 5x5: ceil(5/4)=2, ceil(5/4)=2 → 2*2*8 = 32
      expect(mipLevelSize(5, 5, BC1)).toBe(32);
      // 1x1: ceil(1/4)=1, ceil(1/4)=1 → 1*1*8 = 8
      expect(mipLevelSize(1, 1, BC1)).toBe(8);
    });

    it('handles non-square textures', () => {
      // 256x64: 64 blocks x 16 blocks x 8 = 8192
      expect(mipLevelSize(256, 64, BC1)).toBe(8192);
    });

    it('handles 1x1 texture (minimum size is one block)', () => {
      expect(mipLevelSize(1, 1, BC1)).toBe(8);
      expect(mipLevelSize(1, 1, BC3)).toBe(16);
    });

    it('handles 2x2 texture', () => {
      // ceil(2/4)=1 block each side
      expect(mipLevelSize(2, 2, BC1)).toBe(8);
      expect(mipLevelSize(2, 2, BC3)).toBe(16);
    });
  });

  describe('computeMipChain', () => {
    it('computes full chain for 256x256 BC1', () => {
      const chain = computeMipChain(256, 256, BC1);
      // 256, 128, 64, 32, 16, 8, 4, 2, 1 = 9 levels
      expect(chain.widths).toEqual([256, 128, 64, 32, 16, 8, 4, 2, 1]);
      expect(chain.heights).toEqual([256, 128, 64, 32, 16, 8, 4, 2, 1]);
      expect(chain.sizes.length).toBe(9);
      expect(chain.sizes[0]).toBe(mipLevelSize(256, 256, BC1));
      expect(chain.sizes[8]).toBe(mipLevelSize(1, 1, BC1));
      expect(chain.totalSize).toBe(chain.sizes.reduce((a, b) => a + b, 0));
    });

    it('computes chain for 1x1 (single level)', () => {
      const chain = computeMipChain(1, 1, BC1);
      expect(chain.widths).toEqual([1]);
      expect(chain.heights).toEqual([1]);
      expect(chain.sizes).toEqual([8]);
      expect(chain.totalSize).toBe(8);
    });

    it('computes chain for non-square texture', () => {
      const chain = computeMipChain(256, 64, BC3);
      // 256x64, 128x32, 64x16, 32x8, 16x4, 8x2, 4x1, 2x1, 1x1
      expect(chain.widths[0]).toBe(256);
      expect(chain.heights[0]).toBe(64);
      // Last level should be 1x1
      expect(chain.widths[chain.widths.length - 1]).toBe(1);
      expect(chain.heights[chain.heights.length - 1]).toBe(1);
    });

    it('total size is sum of individual level sizes', () => {
      const chain = computeMipChain(512, 512, BC3);
      const sum = chain.sizes.reduce((a, b) => a + b, 0);
      expect(chain.totalSize).toBe(sum);
    });

    it('each level is half the previous (clamped to 1)', () => {
      const chain = computeMipChain(64, 64, BC1);
      for (let i = 1; i < chain.widths.length; i++) {
        expect(chain.widths[i]).toBe(Math.max(1, chain.widths[i - 1] >> 1));
        expect(chain.heights[i]).toBe(Math.max(1, chain.heights[i - 1] >> 1));
      }
    });

    it('BC3 sizes are exactly 2x BC1 sizes', () => {
      const bc1 = computeMipChain(128, 128, BC1);
      const bc3 = computeMipChain(128, 128, BC3);
      expect(bc1.sizes.length).toBe(bc3.sizes.length);
      for (let i = 0; i < bc1.sizes.length; i++) {
        expect(bc3.sizes[i]).toBe(bc1.sizes[i] * 2);
      }
    });
  });

  describe('encodeBctex / decodeBctexHeader', () => {
    const makeHeader = (overrides?: Partial<BctexHeader>): BctexHeader => ({
      width: 256,
      height: 256,
      format: BC1,
      mipCount: 9,
      hasAlpha: false,
      dataSize: 1000,
      ...overrides,
    });

    it('round-trips a BC1 header', () => {
      const header = makeHeader();
      const data = Buffer.alloc(header.dataSize);
      const encoded = encodeBctex(header, data);
      const decoded = decodeBctexHeader(encoded);
      expect(decoded).toEqual(header);
    });

    it('round-trips a BC3 header with alpha', () => {
      const header = makeHeader({ format: BC3, hasAlpha: true, width: 1024, height: 512, mipCount: 11 });
      const data = Buffer.alloc(header.dataSize);
      const encoded = encodeBctex(header, data);
      const decoded = decodeBctexHeader(encoded);
      expect(decoded).toEqual(header);
    });

    it('writes correct magic bytes', () => {
      const encoded = encodeBctex(makeHeader(), Buffer.alloc(1000));
      expect(encoded.readUInt32LE(0)).toBe(BCTEX_MAGIC);
    });

    it('writes correct version', () => {
      const encoded = encodeBctex(makeHeader(), Buffer.alloc(1000));
      expect(encoded.readUInt32LE(4)).toBe(BCTEX_VERSION);
    });

    it('total buffer size is header + data', () => {
      const dataSize = 500;
      const data = Buffer.alloc(dataSize);
      const encoded = encodeBctex(makeHeader({ dataSize }), data);
      expect(encoded.length).toBe(BCTEX_HEADER_SIZE + dataSize);
    });

    it('preserves compressed data after header', () => {
      const data = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE]);
      const encoded = encodeBctex(makeHeader({ dataSize: data.length }), data);
      const payload = encoded.subarray(BCTEX_HEADER_SIZE);
      expect(Buffer.compare(payload, data)).toBe(0);
    });

    it('returns null for buffer too short', () => {
      expect(decodeBctexHeader(Buffer.alloc(16))).toBeNull();
    });

    it('returns null for wrong magic', () => {
      const encoded = encodeBctex(makeHeader(), Buffer.alloc(1000));
      encoded.writeUInt32LE(0xDEADBEEF, 0); // corrupt magic
      expect(decodeBctexHeader(encoded)).toBeNull();
    });

    it('returns null for wrong version', () => {
      const encoded = encodeBctex(makeHeader(), Buffer.alloc(1000));
      encoded.writeUInt32LE(99, 4); // corrupt version
      expect(decodeBctexHeader(encoded)).toBeNull();
    });

    it('hasAlpha flag encodes as bit 0', () => {
      const withAlpha = encodeBctex(makeHeader({ hasAlpha: true }), Buffer.alloc(1000));
      const withoutAlpha = encodeBctex(makeHeader({ hasAlpha: false }), Buffer.alloc(1000));
      expect(withAlpha.readUInt32LE(24)).toBe(1);
      expect(withoutAlpha.readUInt32LE(24)).toBe(0);
    });
  });

  describe('constants', () => {
    it('magic spells BCTX in ASCII', () => {
      // 0x42435458 stored as LE bytes: 0x58='X', 0x54='T', 0x43='C', 0x42='B'
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(BCTEX_MAGIC);
      expect(buf.toString('ascii')).toBe('XTCB');
      expect(BCTEX_MAGIC).toBe(0x42435458);
    });

    it('header size is 32 bytes', () => {
      expect(BCTEX_HEADER_SIZE).toBe(32);
    });

    it('version is 1', () => {
      expect(BCTEX_VERSION).toBe(1);
    });
  });
});
