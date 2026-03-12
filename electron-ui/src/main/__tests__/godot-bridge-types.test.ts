import { describe, it, expect } from 'vitest';
import {
  isHudAttachment,
  BAKE_MAGIC_UUIDS,
  BAKE_CHANNEL_TO_TE_FACE,
  BAKE_CHANNEL_NAMES,
  ZERO_UUID,
  WATER_EXCLUSION_TEXTURES,
} from '../godot-bridge-types';

describe('isHudAttachment', () => {
  it('returns true for HUD attachment points 31-38', () => {
    for (let ap = 31; ap <= 38; ap++) {
      expect(isHudAttachment({ attachmentPoint: ap })).toBe(true);
    }
  });

  it('returns false for non-HUD attachment points', () => {
    expect(isHudAttachment({ attachmentPoint: 0 })).toBe(false);
    expect(isHudAttachment({ attachmentPoint: 1 })).toBe(false);
    expect(isHudAttachment({ attachmentPoint: 30 })).toBe(false);
    expect(isHudAttachment({ attachmentPoint: 39 })).toBe(false);
    expect(isHudAttachment({ attachmentPoint: 255 })).toBe(false);
  });

  it('returns false when attachmentPoint is missing', () => {
    expect(isHudAttachment({})).toBe(false);
    expect(isHudAttachment({ other: 'prop' })).toBe(false);
  });
});

describe('BAKE_MAGIC_UUIDS', () => {
  it('has 11 bake channels (HEAD through AUX3)', () => {
    expect(BAKE_MAGIC_UUIDS.size).toBe(11);
  });

  it('maps HEAD bake UUID to channel 0', () => {
    expect(BAKE_MAGIC_UUIDS.get('5a9f4a74-30f2-821c-b88d-70499d3e7183')).toBe(0);
  });

  it('channel indices are 0-10', () => {
    const channels = [...BAKE_MAGIC_UUIDS.values()].sort((a, b) => a - b);
    expect(channels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('BAKE_CHANNEL_TO_TE_FACE', () => {
  it('has 11 entries matching channel count', () => {
    expect(BAKE_CHANNEL_TO_TE_FACE.length).toBe(11);
    expect(BAKE_CHANNEL_NAMES.length).toBe(11);
  });

  it('HEAD (0) maps to TEX_HEAD_BAKED (8)', () => {
    expect(BAKE_CHANNEL_TO_TE_FACE[0]).toBe(8);
  });
});

describe('constants', () => {
  it('ZERO_UUID is 36 chars', () => {
    expect(ZERO_UUID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('WATER_EXCLUSION_TEXTURES has 2 entries', () => {
    expect(WATER_EXCLUSION_TEXTURES.size).toBe(2);
  });
});
