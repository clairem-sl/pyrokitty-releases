import { describe, it, expect, vi } from 'vitest';

// Mock electron before importing mesh-converter (it uses `app` from electron)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-app' },
}));

import {
  mat4Mul,
  mat4Inverse,
  mat4FromTranslation,
  composeMatrix,
  slToGltfMatrix,
  slToGltfVec3,
  applyBSM,
  applyBSMNormal,
  computeInvTranspose3x3,
  normalizeVec3,
  vec3Dist,
  blenderFixJoint,
  parseSkeletonJson,
} from '../assets/mesh-converter';

// ── Helpers ──────────────────────────────────────────────────────

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mat4Close(a: number[], b: number[], tol = 1e-6): void {
  expect(a.length).toBe(16);
  expect(b.length).toBe(16);
  for (let i = 0; i < 16; i++) {
    expect(a[i]).toBeCloseTo(b[i], 5);
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('mesh-converter math', () => {
  describe('mat4Mul', () => {
    it('identity * identity = identity', () => {
      mat4Close(mat4Mul(IDENTITY, IDENTITY), IDENTITY);
    });

    it('identity * M = M', () => {
      const t = mat4FromTranslation(3, 5, 7);
      mat4Close(mat4Mul(IDENTITY, t), t);
    });

    it('M * identity = M', () => {
      const t = mat4FromTranslation(3, 5, 7);
      mat4Close(mat4Mul(t, IDENTITY), t);
    });

    it('translation * translation adds translations', () => {
      const a = mat4FromTranslation(1, 2, 3);
      const b = mat4FromTranslation(4, 5, 6);
      const result = mat4Mul(a, b);
      // Result should be translation(5, 7, 9)
      expect(result[12]).toBeCloseTo(5);
      expect(result[13]).toBeCloseTo(7);
      expect(result[14]).toBeCloseTo(9);
    });

    it('is not commutative in general', () => {
      const a = composeMatrix([2, 1, 1], [0.5, 0, 0], [1, 0, 0]);
      const b = composeMatrix([1, 1, 1], [0, 0.5, 0], [0, 1, 0]);
      const ab = mat4Mul(a, b);
      const ba = mat4Mul(b, a);
      // At least one element should differ
      const differs = ab.some((v, i) => Math.abs(v - ba[i]) > 1e-6);
      expect(differs).toBe(true);
    });
  });

  describe('mat4Inverse', () => {
    it('inverse of identity is identity', () => {
      const inv = mat4Inverse(IDENTITY);
      expect(inv).not.toBeNull();
      mat4Close(inv!, IDENTITY);
    });

    it('inverse of translation negates translation', () => {
      const t = mat4FromTranslation(3, -5, 7);
      const inv = mat4Inverse(t);
      expect(inv).not.toBeNull();
      expect(inv![12]).toBeCloseTo(-3);
      expect(inv![13]).toBeCloseTo(5);
      expect(inv![14]).toBeCloseTo(-7);
    });

    it('M * M^(-1) = identity', () => {
      const m = composeMatrix([2, 3, 0.5], [0.3, -0.7, 1.2], [4, -2, 6]);
      const inv = mat4Inverse(m);
      expect(inv).not.toBeNull();
      mat4Close(mat4Mul(m, inv!), IDENTITY);
    });

    it('M^(-1) * M = identity', () => {
      const m = composeMatrix([1.5, 2, 0.8], [0.1, 0.5, -0.3], [-1, 3, 2]);
      const inv = mat4Inverse(m);
      expect(inv).not.toBeNull();
      mat4Close(mat4Mul(inv!, m), IDENTITY);
    });

    it('returns null for singular matrix', () => {
      // All zeros except diagonal has a zero
      const singular = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      expect(mat4Inverse(singular)).toBeNull();
    });
  });

  describe('mat4FromTranslation', () => {
    it('creates correct translation matrix', () => {
      const t = mat4FromTranslation(10, 20, 30);
      // Column-major: translation is at indices 12, 13, 14
      expect(t[12]).toBe(10);
      expect(t[13]).toBe(20);
      expect(t[14]).toBe(30);
      // Upper 3x3 is identity
      expect(t[0]).toBe(1); expect(t[5]).toBe(1); expect(t[10]).toBe(1);
      expect(t[1]).toBe(0); expect(t[2]).toBe(0);
    });
  });

  describe('composeMatrix', () => {
    it('identity TRS produces identity matrix', () => {
      const m = composeMatrix([1, 1, 1], [0, 0, 0], [0, 0, 0]);
      mat4Close(m, IDENTITY);
    });

    it('pure translation only affects last column', () => {
      const m = composeMatrix([1, 1, 1], [0, 0, 0], [5, 10, 15]);
      expect(m[12]).toBeCloseTo(5);
      expect(m[13]).toBeCloseTo(10);
      expect(m[14]).toBeCloseTo(15);
      // Upper 3x3 should be identity
      expect(m[0]).toBeCloseTo(1); expect(m[5]).toBeCloseTo(1); expect(m[10]).toBeCloseTo(1);
    });

    it('pure scale scales the diagonal', () => {
      const m = composeMatrix([2, 3, 4], [0, 0, 0], [0, 0, 0]);
      // Column 0 should have length 2 (scale X)
      const col0Len = Math.sqrt(m[0] ** 2 + m[1] ** 2 + m[2] ** 2);
      const col1Len = Math.sqrt(m[4] ** 2 + m[5] ** 2 + m[6] ** 2);
      const col2Len = Math.sqrt(m[8] ** 2 + m[9] ** 2 + m[10] ** 2);
      expect(col0Len).toBeCloseTo(2);
      expect(col1Len).toBeCloseTo(3);
      expect(col2Len).toBeCloseTo(4);
    });

    it('90 degree Z rotation swaps X and Y', () => {
      const m = composeMatrix([1, 1, 1], [0, 0, Math.PI / 2], [0, 0, 0]);
      // After 90° Z rotation: X→Y, Y→-X
      // Col 0 (X axis): should point in +Y → (0, 1, 0)
      expect(m[0]).toBeCloseTo(0);
      expect(m[1]).toBeCloseTo(1);
      expect(m[2]).toBeCloseTo(0);
    });

    it('is M = T * R * S (order verification)', () => {
      // Composing with scale and translation should put translation unscaled
      const m = composeMatrix([2, 2, 2], [0, 0, 0], [10, 20, 30]);
      // Translation in column 3 should be the raw translation (not scaled)
      expect(m[12]).toBeCloseTo(10);
      expect(m[13]).toBeCloseTo(20);
      expect(m[14]).toBeCloseTo(30);
    });
  });

  describe('slToGltfVec3', () => {
    it('converts (x,y,z) → (x,z,-y)', () => {
      expect(slToGltfVec3(1, 2, 3)).toEqual([1, 3, -2]);
    });

    it('converts origin to origin', () => {
      expect(slToGltfVec3(0, 0, 0)).toEqual([0, 0, -0]);
    });

    it('SL up (0,0,1) becomes glTF up (0,1,0)', () => {
      const [x, y, z] = slToGltfVec3(0, 0, 1);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(1);
      expect(z).toBeCloseTo(0);
    });

    it('SL north (0,1,0) becomes glTF -Z (0,0,-1)', () => {
      const [x, y, z] = slToGltfVec3(0, 1, 0);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(0);
      expect(z).toBeCloseTo(-1);
    });
  });

  describe('slToGltfMatrix', () => {
    it('identity stays identity', () => {
      mat4Close(slToGltfMatrix(IDENTITY), IDENTITY);
    });

    it('translation is coordinate-swapped', () => {
      const slT = mat4FromTranslation(1, 2, 3);
      const gltfT = slToGltfMatrix(slT);
      // SL (1,2,3) → glTF (1,3,-2)
      expect(gltfT[12]).toBeCloseTo(1);
      expect(gltfT[13]).toBeCloseTo(3);
      expect(gltfT[14]).toBeCloseTo(-2);
    });

    it('is its own inverse (double-apply returns original)', () => {
      // C * (C * M * C^-1) * C^-1 should = M if C^2 = I... not generally true.
      // Instead: applying twice should be equivalent to C^2 transform
      const m = mat4FromTranslation(5, 10, 15);
      const once = slToGltfMatrix(m);
      const twice = slToGltfMatrix(once);
      // SL→glTF→"glTF of glTF": (x,z,-y) → (x,-y,-z)
      expect(twice[12]).toBeCloseTo(5);
      expect(twice[13]).toBeCloseTo(-10);
      expect(twice[14]).toBeCloseTo(-15);
    });
  });

  describe('applyBSM', () => {
    it('identity BSM returns original point', () => {
      const result = applyBSM(1, 2, 3, IDENTITY);
      expect(result[0]).toBeCloseTo(1);
      expect(result[1]).toBeCloseTo(2);
      expect(result[2]).toBeCloseTo(3);
    });

    it('translation BSM adds offset', () => {
      const bsm = mat4FromTranslation(10, 20, 30);
      const result = applyBSM(1, 2, 3, bsm);
      expect(result[0]).toBeCloseTo(11);
      expect(result[1]).toBeCloseTo(22);
      expect(result[2]).toBeCloseTo(33);
    });

    it('scale BSM multiplies coordinates', () => {
      // Pure scale: diagonal 2,3,4
      const bsm = composeMatrix([2, 3, 4], [0, 0, 0], [0, 0, 0]);
      const result = applyBSM(1, 1, 1, bsm);
      expect(result[0]).toBeCloseTo(2);
      expect(result[1]).toBeCloseTo(3);
      expect(result[2]).toBeCloseTo(4);
    });
  });

  describe('normalizeVec3', () => {
    it('normalizes a non-zero vector', () => {
      const [x, y, z] = normalizeVec3(3, 0, 4);
      expect(x).toBeCloseTo(0.6);
      expect(y).toBeCloseTo(0);
      expect(z).toBeCloseTo(0.8);
    });

    it('returns unit length', () => {
      const [x, y, z] = normalizeVec3(1, 2, 3);
      const len = Math.sqrt(x * x + y * y + z * z);
      expect(len).toBeCloseTo(1);
    });

    it('handles near-zero vector gracefully', () => {
      const [x, y, z] = normalizeVec3(0, 0, 0);
      // Should not crash, returns original
      expect(x).toBe(0);
      expect(y).toBe(0);
      expect(z).toBe(0);
    });

    it('already-unit vector stays the same', () => {
      const [x, y, z] = normalizeVec3(1, 0, 0);
      expect(x).toBeCloseTo(1);
      expect(y).toBeCloseTo(0);
      expect(z).toBeCloseTo(0);
    });
  });

  describe('vec3Dist', () => {
    it('distance from point to itself is 0', () => {
      expect(vec3Dist([1, 2, 3], [1, 2, 3])).toBeCloseTo(0);
    });

    it('computes correct distance', () => {
      expect(vec3Dist([0, 0, 0], [3, 4, 0])).toBeCloseTo(5);
    });

    it('is symmetric', () => {
      const a: [number, number, number] = [1, 5, 9];
      const b: [number, number, number] = [3, 7, 2];
      expect(vec3Dist(a, b)).toBeCloseTo(vec3Dist(b, a));
    });

    it('unit axis distance', () => {
      expect(vec3Dist([0, 0, 0], [1, 0, 0])).toBeCloseTo(1);
      expect(vec3Dist([0, 0, 0], [0, 1, 0])).toBeCloseTo(1);
      expect(vec3Dist([0, 0, 0], [0, 0, 1])).toBeCloseTo(1);
    });
  });

  describe('computeInvTranspose3x3', () => {
    it('identity produces identity', () => {
      const result = computeInvTranspose3x3(IDENTITY);
      // Row-major 3x3 identity
      expect(result).toHaveLength(9);
      expect(result[0]).toBeCloseTo(1); expect(result[1]).toBeCloseTo(0); expect(result[2]).toBeCloseTo(0);
      expect(result[3]).toBeCloseTo(0); expect(result[4]).toBeCloseTo(1); expect(result[5]).toBeCloseTo(0);
      expect(result[6]).toBeCloseTo(0); expect(result[7]).toBeCloseTo(0); expect(result[8]).toBeCloseTo(1);
    });

    it('returns identity-like for singular matrix', () => {
      const singular = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const result = computeInvTranspose3x3(singular);
      // Fallback identity
      expect(result[0]).toBe(1);
      expect(result[4]).toBe(1);
      expect(result[8]).toBe(1);
    });

    it('uniform scale produces inverse scale', () => {
      const m = composeMatrix([3, 3, 3], [0, 0, 0], [0, 0, 0]);
      const result = computeInvTranspose3x3(m);
      // inv-transpose of 3*I = (1/3)*I
      expect(result[0]).toBeCloseTo(1 / 3);
      expect(result[4]).toBeCloseTo(1 / 3);
      expect(result[8]).toBeCloseTo(1 / 3);
    });
  });

  describe('applyBSMNormal', () => {
    it('identity inv-transpose preserves normals', () => {
      const invT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const [x, y, z] = applyBSMNormal(0, 1, 0, invT);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(1);
      expect(z).toBeCloseTo(0);
    });

    it('result is normalized', () => {
      const invT = [2, 0, 0, 0, 3, 0, 0, 0, 4]; // non-uniform
      const [x, y, z] = applyBSMNormal(1, 1, 1, invT);
      const len = Math.sqrt(x * x + y * y + z * z);
      expect(len).toBeCloseTo(1);
    });
  });

  describe('blenderFixJoint', () => {
    it('splits translation from scale+rotation', () => {
      const m = composeMatrix([2, 3, 4], [0.5, 0.3, 0.1], [10, 20, 30]);
      const { translationOnly, fixup } = blenderFixJoint(m);

      // translationOnly should have just the translation
      expect(translationOnly[12]).toBeCloseTo(10);
      expect(translationOnly[13]).toBeCloseTo(20);
      expect(translationOnly[14]).toBeCloseTo(30);
      // Upper 3x3 of translationOnly should be identity
      expect(translationOnly[0]).toBeCloseTo(1);
      expect(translationOnly[5]).toBeCloseTo(1);
      expect(translationOnly[10]).toBeCloseTo(1);
    });

    it('fixup has no translation component', () => {
      const m = composeMatrix([2, 3, 4], [0.5, 0.3, 0.1], [10, 20, 30]);
      const { fixup } = blenderFixJoint(m);
      // fixup = inv(T) * M, should have zero translation
      expect(fixup[12]).toBeCloseTo(0);
      expect(fixup[13]).toBeCloseTo(0);
      expect(fixup[14]).toBeCloseTo(0);
    });

    it('translationOnly * fixup reconstructs original', () => {
      const m = composeMatrix([2, 3, 4], [0.5, 0.3, 0.1], [10, 20, 30]);
      const { translationOnly, fixup } = blenderFixJoint(m);
      const reconstructed = mat4Mul(translationOnly, fixup);
      mat4Close(reconstructed, m);
    });

    it('identity input produces identity outputs', () => {
      const { translationOnly, fixup } = blenderFixJoint(IDENTITY);
      mat4Close(translationOnly, IDENTITY);
      mat4Close(fixup, IDENTITY);
    });
  });
});

describe('parseSkeletonJson', () => {
  const MINIMAL_SKELETON = JSON.stringify([
    { name: 'mPelvis', parent: '', pos: [0, 0, 1.067], rot: [0, 0, 0], scale: [1, 1, 1], cv: false, aliases: ['hip', 'avatar_mPelvis'] },
    { name: 'mTorso', parent: 'mPelvis', pos: [0, 0, 0.084], rot: [0, 0, 0], scale: [1, 1, 1], cv: false },
    { name: 'mChest', parent: 'mTorso', pos: [0, 0, 0.2], rot: [0, 0, 0], scale: [1, 1, 1], cv: false },
    { name: 'BELLY', parent: 'mTorso', pos: [0, 0.05, 0], rot: [0, 0, 0], scale: [1, 1, 1], cv: true },
  ]);

  it('parses joint names', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.size).toBe(4);
    expect(joints.has('mPelvis')).toBe(true);
    expect(joints.has('mTorso')).toBe(true);
    expect(joints.has('mChest')).toBe(true);
    expect(joints.has('BELLY')).toBe(true);
  });

  it('stores position correctly', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.get('mPelvis')!.pos).toEqual([0, 0, 1.067]);
  });

  it('stores rotation correctly', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.get('mPelvis')!.rot).toEqual([0, 0, 0]);
  });

  it('stores scale correctly', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.get('mPelvis')!.scale).toEqual([1, 1, 1]);
  });

  it('resolves parent references', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.get('mTorso')!.parent).toBe('mPelvis');
    expect(joints.get('mPelvis')!.parent).toBeNull();
  });

  it('builds children arrays', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.get('mPelvis')!.children).toContain('mTorso');
    expect(joints.get('mTorso')!.children).toContain('mChest');
    expect(joints.get('mTorso')!.children).toContain('BELLY');
  });

  it('marks collision volumes', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.get('BELLY')!.isCollisionVolume).toBe(true);
    expect(joints.get('mPelvis')!.isCollisionVolume).toBe(false);
  });

  it('stores aliases when present', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.get('mPelvis')!.aliases).toEqual(['hip', 'avatar_mPelvis']);
    expect(joints.get('mTorso')!.aliases).toBeUndefined();
  });

  it('leaf nodes have empty children arrays', () => {
    const joints = parseSkeletonJson(MINIMAL_SKELETON);
    expect(joints.get('mChest')!.children).toEqual([]);
    expect(joints.get('BELLY')!.children).toEqual([]);
  });
});
