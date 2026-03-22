import { describe, it, expect } from 'vitest';
import {
  resolveLegacyFace,
  resolvePbrFace,
  type FaceInput,
  type LegacyCachedMaterial,
  type PbrMaterialInput,
} from '../materials/resolve-face';

// ── Helpers ──────────────────────────────────────────────────────────

function makeFace(overrides?: Partial<FaceInput>): FaceInput {
  return {
    textureID: 'aaaa-bbbb-cccc-dddd',
    color: [1, 1, 1, 1],
    materialFlags: 0,
    glow: 0,
    repeatU: 1,
    repeatV: 1,
    offsetU: 0,
    offsetV: 0,
    rotation: 0,
    ...overrides,
  };
}

function makeLegacyCached(overrides?: Partial<LegacyCachedMaterial>): LegacyCachedMaterial {
  return {
    alphaMode: 0,
    alphaCutoff: 0.5,
    ...overrides,
  };
}

function makePbrMaterial(overrides?: Partial<PbrMaterialInput>): PbrMaterialInput {
  return { ...overrides };
}

// ── resolveLegacyFace ────────────────────────────────────────────────

describe('resolveLegacyFace', () => {
  it('maps basic face properties', () => {
    const face = makeFace({
      textureID: 'tex-uuid',
      color: [0.5, 0.6, 0.7, 0.8],
      repeatU: 2,
      repeatV: 3,
      offsetU: 0.1,
      offsetV: 0.2,
      rotation: 1.5,
    });

    const result = resolveLegacyFace(face);

    expect(result.baseColorTexture).toBe('tex-uuid');
    expect(result.baseColorFactor).toEqual([0.5, 0.6, 0.7, 0.8]);
    expect(result.repeatU).toBe(2);
    expect(result.repeatV).toBe(3);
    expect(result.offsetU).toBe(0.1);
    expect(result.offsetV).toBe(0.2);
    expect(result.rotation).toBe(1.5);
  });

  it('defaults to unresolved (-1) with no legacy material', () => {
    const result = resolveLegacyFace(makeFace());

    expect(result.alphaMode).toBe(-1);
    expect(result.alphaCutoff).toBe(0.5);
    expect(result.metallicFactor).toBe(0);
    expect(result.roughnessFactor).toBe(1);
    expect(result.doubleSided).toBe(false);
    expect(result.unshaded).toBe(false);
    expect(result.emissiveFactor).toEqual([0, 0, 0]);
  });

  it('detects fullBright from material bitmask', () => {
    const face = makeFace({ materialFlags: 0x20 });
    expect(resolveLegacyFace(face).unshaded).toBe(true);
  });

  it('does not set fullBright when other bits are set', () => {
    const face = makeFace({ materialFlags: 0x1F }); // bump bits only
    expect(resolveLegacyFace(face).unshaded).toBe(false);
  });

  it('fullBright with other bits combined', () => {
    const face = makeFace({ materialFlags: 0x20 | 0xC0 }); // fullbright + shiny
    expect(resolveLegacyFace(face).unshaded).toBe(true);
  });

  it('maps glow to emissiveFactor', () => {
    const face = makeFace({ glow: 0.4 });
    expect(resolveLegacyFace(face).emissiveFactor).toEqual([0.4, 0.4, 0.4]);
  });

  it('zero glow produces zero emissive', () => {
    const face = makeFace({ glow: 0 });
    expect(resolveLegacyFace(face).emissiveFactor).toEqual([0, 0, 0]);
  });

  it('maps legacy material alphaMode', () => {
    const cached = makeLegacyCached({ alphaMode: 1, alphaCutoff: 0.3 });
    const result = resolveLegacyFace(makeFace(), cached);

    expect(result.alphaMode).toBe(1);
    expect(result.alphaCutoff).toBe(0.3);
  });

  it('passes through alphaMode -1 as unresolved', () => {
    const cached = makeLegacyCached({ alphaMode: -1 });
    expect(resolveLegacyFace(makeFace(), cached).alphaMode).toBe(-1);
  });

  it('alpha mask mode (2) with cutoff', () => {
    const cached = makeLegacyCached({ alphaMode: 2, alphaCutoff: 100 / 255 });
    const result = resolveLegacyFace(makeFace(), cached);

    expect(result.alphaMode).toBe(2);
    expect(result.alphaCutoff).toBeCloseTo(100 / 255);
  });

  it('maps specExp to roughnessFactor', () => {
    const cached = makeLegacyCached({ specExp: 128 });
    const result = resolveLegacyFace(makeFace(), cached);

    expect(result.roughnessFactor).toBeCloseTo(1.0 - 128 / 255);
  });

  it('maps envIntensity to metallicFactor', () => {
    const cached = makeLegacyCached({ envIntensity: 64 });
    const result = resolveLegacyFace(makeFace(), cached);

    expect(result.metallicFactor).toBeCloseTo(64 / 255);
  });

  it('max specExp → near zero roughness', () => {
    const cached = makeLegacyCached({ specExp: 255 });
    expect(resolveLegacyFace(makeFace(), cached).roughnessFactor).toBeCloseTo(0);
  });

  it('zero specExp does not change roughness from default', () => {
    const cached = makeLegacyCached({ specExp: 0 });
    expect(resolveLegacyFace(makeFace(), cached).roughnessFactor).toBe(1);
  });

  it('maps normMap to normalTexture', () => {
    const cached = makeLegacyCached({ normMap: 'norm-uuid' });
    expect(resolveLegacyFace(makeFace(), cached).normalTexture).toBe('norm-uuid');
  });

  it('omits normalTexture when no normMap', () => {
    const cached = makeLegacyCached({});
    expect(resolveLegacyFace(makeFace(), cached).normalTexture).toBeUndefined();
  });

  it('includes mappingType when set', () => {
    const face = makeFace({ mappingType: 2 });
    expect(resolveLegacyFace(face).mappingType).toBe(2);
  });

  it('omits mappingType when 0 (default)', () => {
    const face = makeFace({ mappingType: 0 });
    expect(resolveLegacyFace(face).mappingType).toBeUndefined();
  });

  it('null legacyCached treated same as absent', () => {
    const a = resolveLegacyFace(makeFace());
    const b = resolveLegacyFace(makeFace(), null);
    expect(a).toEqual(b);
  });

  it('transparent face color passes through', () => {
    // Caller handles transparent texture detection and sets alpha to 0
    const face = makeFace({ color: [1, 0.5, 0.3, 0] });
    const result = resolveLegacyFace(face);
    expect(result.baseColorFactor).toEqual([1, 0.5, 0.3, 0]);
  });
});

// ── resolvePbrFace ───────────────────────────────────────────────────

describe('resolvePbrFace', () => {
  it('maps basic PBR material properties', () => {
    const mat = makePbrMaterial({
      baseColorTextureId: 'pbr-tex',
      normalTextureId: 'pbr-norm',
      ormTextureId: 'pbr-orm',
      emissiveTextureId: 'pbr-emissive',
      baseColor: [0.9, 0.8, 0.7, 1.0],
      metallicFactor: 0.5,
      roughnessFactor: 0.3,
      emissiveFactor: [0.1, 0.2, 0.3],
      alphaMode: 1,
      alphaCutoff: 0.4,
      doubleSided: true,
    });

    const result = resolvePbrFace(mat);

    expect(result.baseColorTexture).toBe('pbr-tex');
    expect(result.normalTexture).toBe('pbr-norm');
    expect(result.ormTexture).toBe('pbr-orm');
    expect(result.emissiveTexture).toBe('pbr-emissive');
    expect(result.baseColorFactor).toEqual([0.9, 0.8, 0.7, 1.0]);
    expect(result.metallicFactor).toBe(0.5);
    expect(result.roughnessFactor).toBe(0.3);
    expect(result.emissiveFactor).toEqual([0.1, 0.2, 0.3]);
    expect(result.alphaMode).toBe(1);
    expect(result.alphaCutoff).toBe(0.4);
    expect(result.doubleSided).toBe(true);
  });

  it('defaults missing PBR fields', () => {
    const result = resolvePbrFace(makePbrMaterial());

    expect(result.baseColorTexture).toBe('');
    expect(result.baseColorFactor).toEqual([1, 1, 1, 1]);
    expect(result.metallicFactor).toBe(0);
    expect(result.roughnessFactor).toBe(1);
    expect(result.emissiveFactor).toEqual([0, 0, 0]);
    expect(result.alphaMode).toBe(0);
    expect(result.alphaCutoff).toBe(0.5);
    expect(result.doubleSided).toBe(false);
    expect(result.unshaded).toBe(false);
  });

  // ── Inline override merging ──

  it('inline override overrides material asset values', () => {
    const mat = makePbrMaterial({
      baseColorTextureId: 'mat-tex',
      metallicFactor: 0.2,
      roughnessFactor: 0.8,
      alphaMode: 0,
    });
    const override = makePbrMaterial({
      baseColorTextureId: 'override-tex',
      metallicFactor: 0.9,
      alphaMode: 2,
    });

    const result = resolvePbrFace(mat, override);

    expect(result.baseColorTexture).toBe('override-tex');
    expect(result.metallicFactor).toBe(0.9);
    expect(result.roughnessFactor).toBe(0.8); // not overridden
    expect(result.alphaMode).toBe(2);
  });

  it('inline override can set metallicFactor to 0', () => {
    const mat = makePbrMaterial({ metallicFactor: 0.8 });
    const override = makePbrMaterial({ metallicFactor: 0 });

    // metallicFactor: 0 should be applied (not treated as "unset")
    expect(resolvePbrFace(mat, override).metallicFactor).toBe(0);
  });

  it('inline override can set roughnessFactor to 0', () => {
    const mat = makePbrMaterial({ roughnessFactor: 0.8 });
    const override = makePbrMaterial({ roughnessFactor: 0 });

    expect(resolvePbrFace(mat, override).roughnessFactor).toBe(0);
  });

  it('inline override can set alphaMode to 0', () => {
    const mat = makePbrMaterial({ alphaMode: 1 });
    const override = makePbrMaterial({ alphaMode: 0 });

    expect(resolvePbrFace(mat, override).alphaMode).toBe(0);
  });

  it('null inline override treated same as absent', () => {
    const mat = makePbrMaterial({ metallicFactor: 0.5 });
    const a = resolvePbrFace(mat);
    const b = resolvePbrFace(mat, null);
    expect(a).toEqual(b);
  });

  it('inline override with doubleSided false overrides true', () => {
    const mat = makePbrMaterial({ doubleSided: true });
    const override = makePbrMaterial({ doubleSided: false });

    expect(resolvePbrFace(mat, override).doubleSided).toBe(false);
  });

  // ── UV transform priority ──

  it('uses PBR baseColorTransform for UV', () => {
    const mat = makePbrMaterial({
      baseColorTransform: {
        scale: [2, 3],
        offset: [0.1, 0.2],
        rotation: 0.5,
      },
    });

    const result = resolvePbrFace(mat);

    expect(result.repeatU).toBe(2);
    expect(result.repeatV).toBe(3);
    expect(result.offsetU).toBe(0.1);
    expect(result.offsetV).toBe(0.2);
    expect(result.rotation).toBe(0.5);
  });

  it('falls back to legacy face UV when no PBR transform', () => {
    const face = makeFace({
      repeatU: 4,
      repeatV: 5,
      offsetU: 0.3,
      offsetV: 0.4,
      rotation: 1.0,
    });

    const result = resolvePbrFace(makePbrMaterial(), null, face);

    expect(result.repeatU).toBe(4);
    expect(result.repeatV).toBe(5);
    expect(result.offsetU).toBe(0.3);
    expect(result.offsetV).toBe(0.4);
    expect(result.rotation).toBe(1.0);
  });

  it('PBR transform wins over legacy face UV', () => {
    const mat = makePbrMaterial({
      baseColorTransform: { scale: [2, 3], offset: [0.1, 0.2], rotation: 0.5 },
    });
    const face = makeFace({ repeatU: 99, repeatV: 99 });

    const result = resolvePbrFace(mat, null, face);

    expect(result.repeatU).toBe(2);
    expect(result.repeatV).toBe(3);
  });

  it('inline override transform wins over material transform', () => {
    const mat = makePbrMaterial({
      baseColorTransform: { scale: [2, 3] },
    });
    const override = makePbrMaterial({
      baseColorTransform: { scale: [10, 20] },
    });

    const result = resolvePbrFace(mat, override);

    expect(result.repeatU).toBe(10);
    expect(result.repeatV).toBe(20);
  });

  it('defaults to 1,1 repeat and 0,0 offset when no UV source', () => {
    const result = resolvePbrFace(makePbrMaterial());

    expect(result.repeatU).toBe(1);
    expect(result.repeatV).toBe(1);
    expect(result.offsetU).toBe(0);
    expect(result.offsetV).toBe(0);
    expect(result.rotation).toBe(0);
  });

  // ── Legacy face integration ──

  it('uses legacy face color as baseColorFactor fallback', () => {
    const face = makeFace({ color: [0.2, 0.3, 0.4, 0.5] });
    const result = resolvePbrFace(makePbrMaterial(), null, face);

    expect(result.baseColorFactor).toEqual([0.2, 0.3, 0.4, 0.5]);
  });

  it('PBR baseColor wins over legacy color', () => {
    const mat = makePbrMaterial({ baseColor: [0.9, 0.8, 0.7, 1.0] });
    const face = makeFace({ color: [0.1, 0.1, 0.1, 1.0] });

    expect(resolvePbrFace(mat, null, face).baseColorFactor).toEqual([0.9, 0.8, 0.7, 1.0]);
  });

  it('uses legacy face textureID as fallback for baseColorTexture', () => {
    const face = makeFace({ textureID: 'legacy-tex' });
    const result = resolvePbrFace(makePbrMaterial(), null, face);

    expect(result.baseColorTexture).toBe('legacy-tex');
  });

  it('PBR baseColorTexture wins over legacy textureID', () => {
    const mat = makePbrMaterial({ baseColorTextureId: 'pbr-tex' });
    const face = makeFace({ textureID: 'legacy-tex' });

    expect(resolvePbrFace(mat, null, face).baseColorTexture).toBe('pbr-tex');
  });

  it('inherits fullBright from legacy face', () => {
    const face = makeFace({ materialFlags: 0x20 });
    expect(resolvePbrFace(makePbrMaterial(), null, face).unshaded).toBe(true);
  });

  it('no fullBright without legacy face', () => {
    expect(resolvePbrFace(makePbrMaterial()).unshaded).toBe(false);
  });

  it('inherits mappingType from legacy face', () => {
    const face = makeFace({ mappingType: 2 });
    expect(resolvePbrFace(makePbrMaterial(), null, face).mappingType).toBe(2);
  });

  // ── Glow / emissive interaction ──

  it('PBR emissiveFactor wins over legacy glow', () => {
    const mat = makePbrMaterial({ emissiveFactor: [1, 0, 0] });
    const face = makeFace({ glow: 0.5 });

    expect(resolvePbrFace(mat, null, face).emissiveFactor).toEqual([1, 0, 0]);
  });

  it('legacy glow used when PBR has no emissiveFactor', () => {
    const face = makeFace({ glow: 0.7 });
    expect(resolvePbrFace(makePbrMaterial(), null, face).emissiveFactor).toEqual([0.7, 0.7, 0.7]);
  });

  it('zero glow, no PBR emissive → zero emissive', () => {
    const face = makeFace({ glow: 0 });
    expect(resolvePbrFace(makePbrMaterial(), null, face).emissiveFactor).toEqual([0, 0, 0]);
  });

  // ── Optional texture fields ──

  it('omits normalTexture when not set', () => {
    expect(resolvePbrFace(makePbrMaterial()).normalTexture).toBeUndefined();
  });

  it('omits ormTexture when not set', () => {
    expect(resolvePbrFace(makePbrMaterial()).ormTexture).toBeUndefined();
  });

  it('omits emissiveTexture when not set', () => {
    expect(resolvePbrFace(makePbrMaterial()).emissiveTexture).toBeUndefined();
  });

  // ── Edge cases ──

  it('empty material + empty override + no legacy = safe defaults', () => {
    const result = resolvePbrFace({}, {}, null);

    expect(result.baseColorTexture).toBe('');
    expect(result.baseColorFactor).toEqual([1, 1, 1, 1]);
    expect(result.metallicFactor).toBe(0);
    expect(result.roughnessFactor).toBe(1);
    expect(result.alphaMode).toBe(0);
    expect(result.alphaCutoff).toBe(0.5);
    expect(result.doubleSided).toBe(false);
    expect(result.unshaded).toBe(false);
  });

  it('all three sources contribute to final result', () => {
    const mat = makePbrMaterial({
      normalTextureId: 'norm',
      metallicFactor: 0.3,
    });
    const override = makePbrMaterial({
      baseColorTextureId: 'override-tex',
      roughnessFactor: 0.2,
    });
    const face = makeFace({
      color: [0.5, 0.5, 0.5, 1],
      materialFlags: 0x20,
      glow: 0.6,
      repeatU: 3,
    });

    const result = resolvePbrFace(mat, override, face);

    expect(result.baseColorTexture).toBe('override-tex'); // from override
    expect(result.normalTexture).toBe('norm');            // from material
    expect(result.metallicFactor).toBe(0.3);              // from material
    expect(result.roughnessFactor).toBe(0.2);             // from override
    expect(result.baseColorFactor).toEqual([0.5, 0.5, 0.5, 1]); // from legacy
    expect(result.unshaded).toBe(true);                   // from legacy
    expect(result.emissiveFactor).toEqual([0.6, 0.6, 0.6]); // glow, no PBR emissive
    expect(result.repeatU).toBe(3);                       // from legacy (no PBR transform)
  });

  it('partial baseColorTransform — missing offset uses legacy fallback', () => {
    const mat = makePbrMaterial({
      baseColorTransform: { scale: [2, 3] }, // offset and rotation not set
    });
    const face = makeFace({ offsetU: 0.5, offsetV: 0.6, rotation: 1.0 });

    const result = resolvePbrFace(mat, null, face);

    expect(result.repeatU).toBe(2);
    expect(result.repeatV).toBe(3);
    expect(result.offsetU).toBe(0.5);  // from legacy
    expect(result.offsetV).toBe(0.6);  // from legacy
    expect(result.rotation).toBe(1.0); // from legacy
  });
});
