import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];

interface BoneEntry {
  name: string;
  scale: Vec3;
  offset: Vec3;
}

interface VolumeMorphEntry {
  name: string;
  scale?: Vec3;
  pos?: Vec3;
}

interface DrivenParam {
  id: number;
  valueMin: number;
  valueMax: number;
  bones?: BoneEntry[];
  volumeMorphs?: VolumeMorphEntry[];
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
  volumeMorphs?: VolumeMorphEntry[];
  drivenParams?: DrivenParam[];
}

export interface BoneDelta {
  scale: Vec3;
  offset: Vec3;
}

export interface VolumeDelta {
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

export interface ShapeResult {
  bones: Record<string, BoneDelta>;
  volumeMorphs: Record<string, VolumeDelta>;
}

/**
 * Compute skeleton bone deltas AND collision volume morph deltas from VisualParam bytes.
 * Single pass over all params — bones and volume morphs are accumulated together.
 *
 * Sex filtering: params with a sex attribute that doesn't match the avatar's
 * sex use weight 0 (Firestorm: getDefaultWeight() = 0 for skeleton params).
 * Avatar sex determined by param id=80 ("male") at byteIndex=31.
 */
export function computeShapeDeltas(visualParamBytes: number[]): ShapeResult {
  ensureLoaded();
  const params = skeletonParams!;
  const avatarSex = determineAvatarSex(visualParamBytes);

  const accScale: Record<string, Vec3> = {};
  const accOffset: Record<string, Vec3> = {};
  const vmScale: Record<string, Vec3> = {};
  const vmOffset: Record<string, Vec3> = {};

  function accBones(bones: BoneEntry[] | undefined, weight: number): void {
    if (!bones) return;
    for (const bone of bones) {
      if (!accScale[bone.name]) { accScale[bone.name] = [0, 0, 0]; accOffset[bone.name] = [0, 0, 0]; }
      accScale[bone.name][0] += weight * bone.scale[0];
      accScale[bone.name][1] += weight * bone.scale[1];
      accScale[bone.name][2] += weight * bone.scale[2];
      accOffset[bone.name][0] += weight * bone.offset[0];
      accOffset[bone.name][1] += weight * bone.offset[1];
      accOffset[bone.name][2] += weight * bone.offset[2];
    }
  }

  function accVM(morphs: VolumeMorphEntry[] | undefined, weight: number): void {
    if (!morphs) return;
    for (const vm of morphs) {
      if (!vmScale[vm.name]) { vmScale[vm.name] = [0, 0, 0]; vmOffset[vm.name] = [0, 0, 0]; }
      if (vm.scale) {
        vmScale[vm.name][0] += weight * vm.scale[0];
        vmScale[vm.name][1] += weight * vm.scale[1];
        vmScale[vm.name][2] += weight * vm.scale[2];
      }
      if (vm.pos) {
        vmOffset[vm.name][0] += weight * vm.pos[0];
        vmOffset[vm.name][1] += weight * vm.pos[1];
        vmOffset[vm.name][2] += weight * vm.pos[2];
      }
    }
  }

  for (const param of params) {
    const byte = visualParamBytes[param.byteIndex];
    if (byte === undefined) continue;
    const rawWeight = (byte / 255.0) * (param.valueMax - param.valueMin) + param.valueMin;
    const weight = (param.sex && param.sex !== avatarSex) ? 0 : rawWeight;

    accBones(param.bones, weight);
    accVM(param.volumeMorphs, weight);

    if (param.drivenParams) {
      for (const driven of param.drivenParams) {
        let drivenWeight = getDrivenWeight(weight, param, driven);
        if (driven.sex && driven.sex !== avatarSex) drivenWeight = 0;
        accBones(driven.bones, drivenWeight);
        accVM(driven.volumeMorphs, drivenWeight);
      }
    }
  }

  const bones: Record<string, BoneDelta> = {};
  for (const name of Object.keys({ ...accScale, ...accOffset })) {
    const s = accScale[name] || [0, 0, 0];
    const o = accOffset[name] || [0, 0, 0];
    bones[name] = { scale: [1 + s[0], 1 + s[1], 1 + s[2]], offset: [o[0], o[1], o[2]] };
  }

  const volumeMorphs: Record<string, VolumeDelta> = {};
  for (const name of Object.keys({ ...vmScale, ...vmOffset })) {
    volumeMorphs[name] = { scale: vmScale[name] || [0, 0, 0], offset: vmOffset[name] || [0, 0, 0] };
  }

  return { bones, volumeMorphs };
}

/**
 * Returns the loaded skeleton params (for debugging/inspection).
 */
export function getVisualParams(): ReadonlyArray<SkeletonParam> {
  ensureLoaded();
  return skeletonParams!;
}
