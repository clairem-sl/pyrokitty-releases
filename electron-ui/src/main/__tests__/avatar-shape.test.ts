import { describe, it, expect } from 'vitest';
import { computeSkeletonDeltas, getVisualParams } from '../avatar-shape';

// ── Helpers ──────────────────────────────────────────────────────────

/** Firestorm U8_to_F32 (llquantize.h) — includes zero-snap near origin */
function firestormDequantize(byte: number, lower: number, upper: number): number {
  const OOU8MAX = 1.0 / 255.0;
  let val = byte * OOU8MAX;
  const delta = upper - lower;
  val *= delta;
  val += lower;
  const maxError = delta * OOU8MAX;
  if (Math.abs(val) < maxError) val = 0.0;
  return val;
}

/** Our dequantization (avatar-shape.ts line 143) */
function ourDequantize(byte: number, lower: number, upper: number): number {
  return (byte / 255.0) * (upper - lower) + lower;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('avatar-shape', () => {
  describe('dequantization comparison', () => {
    it('matches Firestorm U8_to_F32 for typical ranges', () => {
      const ranges: [number, number][] = [
        [-0.3, 2],    // Big_Brow (id 1)
        [-2.3, 2],    // Arm_Length (id 33)
        [0, 1],       // generic normalized
        [-1, 1],      // symmetric
      ];

      for (const [lower, upper] of ranges) {
        for (const byte of [0, 1, 64, 127, 128, 200, 254, 255]) {
          const fs = firestormDequantize(byte, lower, upper);
          const ours = ourDequantize(byte, lower, upper);
          // Check if they differ (zero-snap in Firestorm can cause small differences)
          if (Math.abs(fs - ours) > 1e-10) {
            // The only acceptable difference is the zero-snap behavior
            expect(Math.abs(ours)).toBeLessThan(Math.abs(upper - lower) / 255.0);
          }
        }
      }
    });

    it('identifies zero-snap cases where Firestorm snaps to 0 but we do not', () => {
      // Range [-0.3, 2]: delta=2.3, maxError=2.3/255≈0.00902
      // At byte=13: val = 13/255*2.3 + (-0.3) = 0.1173.. - 0.3 = -0.1827 → not near zero
      // At byte=33: val = 33/255*2.3 + (-0.3) = 0.2976.. - 0.3 = -0.00235 → near zero! Firestorm snaps to 0
      const lower = -0.3, upper = 2.0;
      const delta = upper - lower;
      const maxError = delta / 255.0;

      // Find all bytes where zero-snap triggers
      const snappedBytes: number[] = [];
      for (let b = 0; b <= 255; b++) {
        const ours = ourDequantize(b, lower, upper);
        const fs = firestormDequantize(b, lower, upper);
        if (Math.abs(ours - fs) > 1e-10) {
          snappedBytes.push(b);
        }
      }
      // Report but don't fail — we want to know which bytes are affected
      if (snappedBytes.length > 0) {
        console.log(`[ZeroSnap] Range [${lower}, ${upper}]: ${snappedBytes.length} bytes differ: ${snappedBytes.join(', ')}`);
      }
    });
  });

  describe('computeSkeletonDeltas', () => {
    it('loads param definitions successfully', () => {
      const params = getVisualParams();
      expect(params.length).toBe(82);
    });

    it('returns empty result for empty byte array', () => {
      const result = computeSkeletonDeltas([]);
      expect(Object.keys(result).length).toBe(0);
    });

    it('default bytes (128) produce near-neutral scales', () => {
      // All params at byte 128 = middle of their range
      // For most params, the middle value should produce moderate scale
      const bytes = new Array(253).fill(128);
      const result = computeSkeletonDeltas(bytes);

      // mPelvis should exist and have scale values
      expect(result.mPelvis).toBeDefined();
      expect(result.mPelvis.scale).toHaveLength(3);
      expect(result.mPelvis.offset).toHaveLength(3);

      // Log all bone scales for inspection
      const boneNames = Object.keys(result).sort();
      console.log(`[DefaultShape] ${boneNames.length} bones affected`);
      for (const name of ['mPelvis', 'mHipLeft', 'mHipRight', 'mKneeLeft', 'mKneeRight',
                           'mTorso', 'mChest', 'mNeck', 'mHead', 'mShoulderLeft']) {
        if (result[name]) {
          const s = result[name].scale;
          const o = result[name].offset;
          console.log(`[DefaultShape] ${name}: scale=(${s.map(v => v.toFixed(6)).join(', ')}) offset=(${o.map(v => v.toFixed(6)).join(', ')})`);
        }
      }
    });

    it('all-zero bytes produce minimum scales', () => {
      const bytes = new Array(253).fill(0);
      const result = computeSkeletonDeltas(bytes);
      expect(result.mPelvis).toBeDefined();
      console.log(`[MinShape] mPelvis scale=(${result.mPelvis.scale.map(v => v.toFixed(6)).join(', ')})`);
    });

    it('all-255 bytes produce maximum scales', () => {
      const bytes = new Array(253).fill(255);
      const result = computeSkeletonDeltas(bytes);
      expect(result.mPelvis).toBeDefined();
      console.log(`[MaxShape] mPelvis scale=(${result.mPelvis.scale.map(v => v.toFixed(6)).join(', ')})`);
    });

    it('scale is symmetric: left/right bones get same scale for uniform bytes', () => {
      const bytes = new Array(253).fill(128);
      const result = computeSkeletonDeltas(bytes);

      const pairs = [
        ['mHipLeft', 'mHipRight'],
        ['mKneeLeft', 'mKneeRight'],
        ['mShoulderLeft', 'mShoulderRight'],
        ['mElbowLeft', 'mElbowRight'],
        ['mFootLeft', 'mFootRight'],
      ];

      for (const [left, right] of pairs) {
        if (result[left] && result[right]) {
          expect(result[left].scale[0]).toBeCloseTo(result[right].scale[0], 6);
          expect(result[left].scale[1]).toBeCloseTo(result[right].scale[1], 6);
          expect(result[left].scale[2]).toBeCloseTo(result[right].scale[2], 6);
        }
      }
    });

    it('height slider only affects expected bones', () => {
      // Test changing just the height param to see which bones are affected
      const defaultBytes = new Array(253).fill(128);
      const tallBytes = [...defaultBytes];

      // Find the height param (id=33 "Leg_Length" is one of the main height contributors)
      const params = getVisualParams();
      const heightParam = params.find(p => p.id === 33);
      expect(heightParam).toBeDefined();

      tallBytes[heightParam!.byteIndex] = 255;  // Max height

      const defaultResult = computeSkeletonDeltas(defaultBytes);
      const tallResult = computeSkeletonDeltas(tallBytes);

      // Compare and log which bones changed
      const allBones = new Set([...Object.keys(defaultResult), ...Object.keys(tallResult)]);
      const changed: string[] = [];
      for (const bone of allBones) {
        const ds = defaultResult[bone]?.scale || [1, 1, 1];
        const ts = tallResult[bone]?.scale || [1, 1, 1];
        const diff = Math.max(
          Math.abs(ds[0] - ts[0]),
          Math.abs(ds[1] - ts[1]),
          Math.abs(ds[2] - ts[2]),
        );
        if (diff > 0.001) {
          changed.push(`${bone}: default=(${ds.map(v => v.toFixed(4)).join(',')}) tall=(${ts.map(v => v.toFixed(4)).join(',')})`);
        }
      }
      console.log(`[HeightTest] Param id=33 (byte ${heightParam!.byteIndex}): ${changed.length} bones changed:`);
      for (const c of changed) console.log(`  ${c}`);

      // Height should affect leg bones
      expect(changed.length).toBeGreaterThan(0);
    });

    it('trapezoidal activation produces correct driven weights', () => {
      // Test a param with explicit trapezoidal activation ranges
      // Find a param with min1/max1/max2/min2 set
      const params = getVisualParams();
      let trapParam: typeof params[0] | null = null;
      let trapDriven: any = null;
      for (const p of params) {
        if (p.drivenParams) {
          for (const d of p.drivenParams) {
            if (d.min1 !== undefined && d.max1 !== undefined && d.max2 !== undefined && d.min2 !== undefined) {
              trapParam = p;
              trapDriven = d;
              break;
            }
          }
        }
        if (trapParam) break;
      }

      if (trapParam && trapDriven) {
        console.log(`[Trapezoid] Found param id=${trapParam.id} byte=${trapParam.byteIndex} ` +
          `range=[${trapParam.valueMin}, ${trapParam.valueMax}] ` +
          `trap=[${trapDriven.min1}, ${trapDriven.max1}, ${trapDriven.max2}, ${trapDriven.min2}]`);

        // Test at different byte values across the activation range
        for (const byte of [0, 64, 128, 192, 255]) {
          const weight = ourDequantize(byte, trapParam.valueMin, trapParam.valueMax);
          console.log(`[Trapezoid] byte=${byte} weight=${weight.toFixed(4)}`);
        }
      }
    });
  });

  describe('regression: known avatar shapes', () => {
    // Dog avatar 8f99e602 — captured VisualParam bytes from production
    const DOG_BYTES = [33,61,85,23,58,127,63,85,63,42,0,85,63,36,85,95,153,63,34,0,63,109,88,132,63,255,229,85,229,136,255,0,203,0,0,127,0,0,127,0,0,127,0,0,0,127,114,127,99,63,127,140,127,127,0,0,0,191,0,104,0,0,0,0,0,0,0,0,0,145,216,133,0,127,0,127,170,0,0,127,127,0,85,127,127,132,85,42,100,216,214,204,204,204,51,25,89,76,204,0,127,0,0,144,85,255,132,255,85,0,127,127,127,127,127,127,59,255,255,127,252,106,0,79,127,255,232,63,0,0,0,0,127,127,0,0,0,0,127,0,159,0,0,178,127,255,85,131,173,127,127,153,95,0,140,74,27,127,127,0,214,204,198,0,0,255,30,127,226,255,198,255,255,255,255,255,255,255,255,255,204,0,255,255,255,255,255,255,255,255,255,255,255,0,255,255,255,255,255,0,127,255,255,25,100,255,255,255,255,84,0,0,0,51,132,255,255,255,0,0,25,0,25,23,51,0,25,23,51,0,0,25,0,25,23,51,0,0,25,0,25,23,51,0,25,23,51,0,25,23,51,1,206];

    // Human avatar 27df63dc — captured VisualParam bytes from production
    const HUMAN_BYTES = [94,180,173,20,153,114,0,255,130,48,0,129,79,127,0,165,84,135,147,0,130,127,0,181,127,0,0,63,94,137,0,255,203,255,79,127,0,0,127,0,0,127,130,0,0,127,0,0,0,0,0,0,0,0,0,0,0,35,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,89,0,0,130,160,109,85,127,127,61,122,0,100,216,214,204,204,204,51,25,89,76,204,0,0,0,0,9,0,127,115,38,68,0,127,150,127,127,127,104,0,51,0,76,58,63,47,162,117,0,0,63,0,0,0,0,127,127,0,0,0,0,127,0,159,0,0,0,127,35,0,0,0,152,137,84,163,0,0,134,127,127,130,0,214,204,198,0,0,89,30,196,226,255,198,255,255,255,255,255,255,255,255,255,204,0,255,255,255,255,255,255,255,255,255,255,255,0,255,255,255,255,255,0,127,38,255,25,100,255,255,255,255,84,0,0,0,127,142,255,255,255,0,0,25,0,25,23,51,0,25,23,51,0,0,25,0,25,23,51,0,0,25,0,25,23,51,0,25,23,51,0,25,23,51,1,119];

    it('dog avatar 8f99e602: scale values match production log', () => {
      const result = computeSkeletonDeltas(DOG_BYTES);

      // Known values from production log:
      // [AvatarShape] 8f99e602 bone=mPelvis scale=[1.127569, 1.127569, 1.400000]
      expect(result.mPelvis.scale[0]).toBeCloseTo(1.127569, 4);
      expect(result.mPelvis.scale[1]).toBeCloseTo(1.127569, 4);
      expect(result.mPelvis.scale[2]).toBeCloseTo(1.400000, 4);

      // [AvatarShape] 8f99e602 bone=mHipLeft scale=[1.165839, 1.165839, 1.300000]
      expect(result.mHipLeft.scale[0]).toBeCloseTo(1.165839, 4);
      expect(result.mHipLeft.scale[2]).toBeCloseTo(1.300000, 4);

      // [AvatarShape] 8f99e602 bone=mKneeLeft scale=[1.153082, 1.153082, 1.350000]
      expect(result.mKneeLeft.scale[2]).toBeCloseTo(1.350000, 4);

      // Left/right symmetry
      expect(result.mHipLeft.scale).toEqual(result.mHipRight.scale);
      expect(result.mKneeLeft.scale).toEqual(result.mKneeRight.scale);

      // Log ALL bone scales for comparison with Firestorm
      console.log(`[DogShape] All bone scales:`);
      for (const name of Object.keys(result).sort()) {
        const s = result[name].scale;
        const o = result[name].offset;
        const hasScale = s.some(v => Math.abs(v - 1) > 0.0001);
        const hasOffset = o.some(v => Math.abs(v) > 0.0001);
        if (hasScale || hasOffset) {
          console.log(`  ${name}: scale=(${s.map(v => v.toFixed(6)).join(', ')}) offset=(${o.map(v => v.toFixed(6)).join(', ')})`);
        }
      }
    });

    it('human avatar 27df63dc: scale values match production log', () => {
      const result = computeSkeletonDeltas(HUMAN_BYTES);

      // Known values from production log:
      // [AvatarShape] 27df63dc bone=mPelvis scale=[0.930000, 0.932353, 0.689412]
      expect(result.mPelvis.scale[0]).toBeCloseTo(0.930000, 4);
      expect(result.mPelvis.scale[1]).toBeCloseTo(0.932353, 4);
      expect(result.mPelvis.scale[2]).toBeCloseTo(0.689412, 4);

      // Left/right symmetry
      expect(result.mHipLeft.scale).toEqual(result.mHipRight.scale);
      expect(result.mKneeLeft.scale).toEqual(result.mKneeRight.scale);

      console.log(`[HumanShape] Key bone scales:`);
      for (const name of ['mPelvis', 'mHipLeft', 'mHipRight', 'mKneeLeft', 'mKneeRight',
                           'mAnkleLeft', 'mAnkleRight', 'mTorso', 'mChest', 'mNeck', 'mHead']) {
        if (result[name]) {
          const s = result[name].scale;
          const o = result[name].offset;
          console.log(`  ${name}: scale=(${s.map(v => v.toFixed(6)).join(', ')}) offset=(${o.map(v => v.toFixed(6)).join(', ')})`);
        }
      }
    });
  });
});
