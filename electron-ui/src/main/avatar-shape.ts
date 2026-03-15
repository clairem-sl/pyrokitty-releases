import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];

interface BoneEntry {
  name: string;
  scale: Vec3;
  offset: Vec3;
}

interface DrivenParam {
  id: number;
  valueMin: number;
  valueMax: number;
  bones: BoneEntry[];
  sex?: 'male' | 'female';
  // Trapezoidal activation: ramp up [min1→max1], hold [max1→max2], ramp down [max2→min2]
  // When not specified, defaults to full driver range (simple linear remap).
  min1?: number;
  max1?: number;
  max2?: number;
  min2?: number;
}

interface SkeletonParam {
  byteIndex: number;
  id: number;
  valueMin: number;
  valueMax: number;
  sex?: 'male' | 'female';
  bones?: BoneEntry[];
  drivenParams?: DrivenParam[];
}

export interface BoneDelta {
  scale: Vec3;
  offset: Vec3;
}

// ── Load pre-processed JSON from shared/ ─────────────────────────────

function findSharedFile(filename: string): string {
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, 'shared', filename)] : []),
    path.join(__dirname, '..', '..', '..', 'shared', filename),
    path.join(__dirname, '..', '..', '..', '..', 'shared', filename),
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf8'); } catch { /* try next */ }
  }
  return '';
}

let skeletonParams: SkeletonParam[] | null = null;

function ensureLoaded(): void {
  if (skeletonParams) return;

  const json = findSharedFile('avatar_lad_skeleton.json');
  if (!json) throw new Error('avatar_lad_skeleton.json not found');

  skeletonParams = JSON.parse(json) as SkeletonParam[];
}

// ── SL driver weight mapping ─────────────────────────────────────────

/**
 * Compute driven param weight using SL's trapezoidal activation profile.
 * Matches LLDriverParam::getDrivenWeight() from the SL viewer source.
 */
function getDrivenWeight(
  inputWeight: number,
  driver: SkeletonParam,
  driven: DrivenParam,
): number {
  // Default activation range: full driver range → simple linear remap
  const min1 = driven.min1 ?? driver.valueMin;
  const max1 = driven.max1 ?? driver.valueMax;
  const max2 = driven.max2 ?? driver.valueMax;
  const min2 = driven.min2 ?? driver.valueMax;

  const drivenMin = driven.valueMin;
  const drivenMax = driven.valueMax;

  if (min1 === max1 && max1 === max2 && max2 === min2) {
    // Degenerate: step function at min1
    return inputWeight <= min1 ? drivenMax : drivenMin;
  }

  if (inputWeight <= min1) {
    return drivenMin;
  } else if (inputWeight < max1) {
    const t = (inputWeight - min1) / (max1 - min1);
    return drivenMin + t * (drivenMax - drivenMin);
  } else if (inputWeight <= max2) {
    return drivenMax;
  } else if (inputWeight < min2) {
    const t = (inputWeight - max2) / (min2 - max2);
    return drivenMax + t * (drivenMin - drivenMax);
  } else {
    return drivenMin;
  }
}

// ── Sex determination ────────────────────────────────────────────────

// Param id=80 ("male") at byteIndex=31, valueMin=0, valueMax=1.
// Matches Firestorm: getVisualParamWeight("male") > 0.5f ? SEX_MALE : SEX_FEMALE
const SEX_PARAM_BYTE_INDEX = 31;

function determineAvatarSex(visualParamBytes: number[]): 'male' | 'female' {
  const byte = visualParamBytes[SEX_PARAM_BYTE_INDEX];
  if (byte === undefined) return 'female';
  const weight = byte / 255.0; // valueMin=0, valueMax=1 → weight = byte/255
  return weight > 0.5 ? 'male' : 'female';
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Given an array of VisualParam bytes (one per param, in ID-sorted order),
 * compute skeleton bone deltas (scale and offset) for each affected bone.
 *
 * Sex filtering: params with a sex attribute that doesn't match the avatar's
 * sex use weight 0 (Firestorm: getDefaultWeight() = 0 for skeleton params).
 * Avatar sex determined by param id=80 ("male") at byteIndex=31.
 *
 * Returns a map of bone name → { scale: [1+accX, 1+accY, 1+accZ], offset: [x,y,z] }
 */
export function computeSkeletonDeltas(visualParamBytes: number[]): Record<string, BoneDelta> {
  ensureLoaded();
  const params = skeletonParams!;
  const avatarSex = determineAvatarSex(visualParamBytes);

  // Accumulators per bone: additive scale and offset
  const accScale: Record<string, Vec3> = {};
  const accOffset: Record<string, Vec3> = {};

  function accumulateBones(bones: BoneEntry[], weight: number): void {
    for (const bone of bones) {
      if (!accScale[bone.name]) {
        accScale[bone.name] = [0, 0, 0];
        accOffset[bone.name] = [0, 0, 0];
      }
      accScale[bone.name][0] += weight * bone.scale[0];
      accScale[bone.name][1] += weight * bone.scale[1];
      accScale[bone.name][2] += weight * bone.scale[2];
      accOffset[bone.name][0] += weight * bone.offset[0];
      accOffset[bone.name][1] += weight * bone.offset[1];
      accOffset[bone.name][2] += weight * bone.offset[2];
    }
  }

  for (const param of params) {
    const byte = visualParamBytes[param.byteIndex];
    if (byte === undefined) continue;

    // Dequantize
    const rawWeight = (byte / 255.0) * (param.valueMax - param.valueMin) + param.valueMin;

    // Sex filtering on driver param: use weight 0 if sex doesn't match
    const weight = (param.sex && param.sex !== avatarSex) ? 0 : rawWeight;

    // Direct skeleton bones
    if (param.bones) {
      accumulateBones(param.bones, weight);
    }

    // Driven params with nested bone data
    if (param.drivenParams) {
      for (const driven of param.drivenParams) {
        let drivenWeight = getDrivenWeight(weight, param, driven);
        // Sex filtering on driven param: use weight 0 if sex doesn't match
        if (driven.sex && driven.sex !== avatarSex) {
          drivenWeight = 0;
        }
        accumulateBones(driven.bones, drivenWeight);
      }
    }
  }

  // Build result: final scale = 1 + accumulated
  const result: Record<string, BoneDelta> = {};
  const allBones = Object.keys({ ...accScale, ...accOffset });
  for (const name of allBones) {
    const s = accScale[name] || [0, 0, 0];
    const o = accOffset[name] || [0, 0, 0];
    result[name] = {
      scale: [1 + s[0], 1 + s[1], 1 + s[2]],
      offset: [o[0], o[1], o[2]],
    };
  }

  return result;
}

/**
 * Returns the loaded skeleton params (for debugging/inspection).
 */
export function getVisualParams(): ReadonlyArray<SkeletonParam> {
  ensureLoaded();
  return skeletonParams!;
}
