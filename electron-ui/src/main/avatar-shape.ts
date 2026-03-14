import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

// ── Types ────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];

interface BoneEntry {
  name: string;
  scale: Vec3;
  offset: Vec3;
}

interface DrivenEntry {
  id: number;
  // Trapezoidal activation: ramp up [min1→max1], hold [max1→max2], ramp down [max2→min2]
  // When not specified, defaults to full driver range (simple linear remap).
  min1?: number;
  max1?: number;
  max2?: number;
  min2?: number;
}

interface ParamDef {
  id: number;
  group: number;
  valueMin: number;
  valueMax: number;
  skeletonBones: BoneEntry[];    // non-empty for skeleton params
  drivenEntries: DrivenEntry[];  // non-empty for driver params
}

export interface BoneDelta {
  scale: Vec3;
  offset: Vec3;
}

// ── File lookup (same pattern as mesh-converter.ts) ──────────────────

function findCharacterFile(filename: string): string {
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, 'viewer', 'character', filename)] : []),
    path.join(__dirname, '..', '..', 'viewer', 'character', filename),
    path.join(__dirname, '..', '..', '..', 'viewer', 'character', filename),
    path.join(__dirname, '..', '..', '..', '..', 'indra', 'newview', 'character', filename),
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf8'); } catch { /* try next */ }
  }
  return '';
}

// ── XML parsing helpers ──────────────────────────────────────────────

function getAttr(tag: string, name: string): string | undefined {
  // Handles: name="value", name = "value", name='value'
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`);
  const m = tag.match(re);
  return m ? m[1] : undefined;
}

function parseVec3(s: string): Vec3 {
  const parts = s.trim().split(/\s+/).map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

// ── Parse avatar_lad.xml ────────────────────────────────────────────

// sharedParams: only groups 0+2 — these map 1:1 to the VisualParam byte array
// paramById: ALL params (including group 1 hidden/driven) — used for driver lookups
let sharedParams: ParamDef[] | null = null;
let paramById: Map<number, ParamDef> | null = null;

function ensureParsed(): void {
  if (sharedParams) return;

  const xml = findCharacterFile('avatar_lad.xml');
  if (!xml) throw new Error('avatar_lad.xml not found');

  const params: ParamDef[] = [];

  // Parse with a proper XML parser (fast-xml-parser). The avatar_lad.xml has
  // multiline tags that break naive line-by-line or regex parsers.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name: string) => ['param', 'bone', 'driven'].includes(name),
  });
  const doc = parser.parse(xml);

  // Collect all <param> elements from anywhere in the document tree
  function collectParams(obj: any): any[] {
    const result: any[] = [];
    if (!obj || typeof obj !== 'object') return result;
    if (Array.isArray(obj)) {
      for (const item of obj) result.push(...collectParams(item));
      return result;
    }
    if (obj.param) {
      const arr = Array.isArray(obj.param) ? obj.param : [obj.param];
      result.push(...arr);
    }
    for (const key of Object.keys(obj)) {
      if (key !== 'param' && typeof obj[key] === 'object') {
        result.push(...collectParams(obj[key]));
      }
    }
    return result;
  }

  const allParamNodes = collectParams(doc);

  for (const node of allParamNodes) {
    const idStr = node['@_id'];
    if (idStr === undefined) continue;

    const param: ParamDef = {
      id: parseInt(idStr, 10),
      group: parseInt(node['@_group'] || '0', 10),
      valueMin: parseFloat(node['@_value_min'] || '0'),
      valueMax: parseFloat(node['@_value_max'] || '1'),
      skeletonBones: [],
      drivenEntries: [],
    };

    // Parse <bone> entries inside <param_skeleton>
    const skel = node.param_skeleton;
    if (skel && skel.bone) {
      const bones = Array.isArray(skel.bone) ? skel.bone : [skel.bone];
      for (const b of bones) {
        const name = b['@_name'];
        if (name) {
          param.skeletonBones.push({
            name,
            scale: b['@_scale'] ? parseVec3(b['@_scale']) : [0, 0, 0],
            offset: b['@_offset'] ? parseVec3(b['@_offset']) : [0, 0, 0],
          });
        }
      }
    }

    // Parse <driven> entries inside <param_driver>
    const driver = node.param_driver;
    if (driver && driver.driven) {
      const drivens = Array.isArray(driver.driven) ? driver.driven : [driver.driven];
      for (const d of drivens) {
        const drivenId = d['@_id'];
        if (drivenId !== undefined) {
          const entry: DrivenEntry = { id: parseInt(drivenId, 10) };
          if (d['@_min1'] !== undefined) entry.min1 = parseFloat(d['@_min1']);
          if (d['@_max1'] !== undefined) entry.max1 = parseFloat(d['@_max1']);
          if (d['@_max2'] !== undefined) entry.max2 = parseFloat(d['@_max2']);
          if (d['@_min2'] !== undefined) entry.min2 = parseFloat(d['@_min2']);
          param.drivenEntries.push(entry);
        }
      }
    }

    params.push(param);
  }

  // Sort by numeric ID (SL sends VisualParam bytes in ID-sorted order)
  params.sort((a, b) => a.id - b.id);

  // Deduplicate by ID (SL viewer uses std::map<S32, LLVisualParam*> which keeps
  // last-inserted for duplicate IDs). avatar_lad.xml has duplicate id=664.
  const deduped = new Map<number, ParamDef>();
  for (const p of params) deduped.set(p.id, p);
  const uniqueParams = Array.from(deduped.values()).sort((a, b) => a.id - b.id);

  // The appearance message byte array contains groups 0 (TWEAKABLE) and 3
  // (TRANSMIT_NOT_TWEAKABLE). Group 1 (ANIMATABLE) and group 2 (TWEAKABLE_NO_TRANSMIT)
  // are NOT in the byte array. Group 2 params only receive values via driver params.
  // See llvoavatar.cpp: expected = group(TWEAKABLE) + group(TRANSMIT_NOT_TWEAKABLE).
  sharedParams = uniqueParams.filter(p => p.group === 0 || p.group === 3);
  // paramById includes ALL params so drivers can look up their driven targets
  paramById = deduped;
}

// ── SL driver weight mapping ─────────────────────────────────────────

/**
 * Compute driven param weight using SL's trapezoidal activation profile.
 * Matches LLDriverParam::getDrivenWeight() from the SL viewer source.
 */
function getDrivenWeight(
  inputWeight: number,
  driver: ParamDef,
  driven: ParamDef,
  entry: DrivenEntry,
): number {
  // Default activation range: full driver range → simple linear remap
  const min1 = entry.min1 ?? driver.valueMin;
  const max1 = entry.max1 ?? driver.valueMax;
  const max2 = entry.max2 ?? driver.valueMax;
  const min2 = entry.min2 ?? driver.valueMax;

  const drivenMin = driven.valueMin;
  const drivenMax = driven.valueMax;

  if (min1 === max1 && max1 === max2 && max2 === min2) {
    // Degenerate: step function at min1
    return inputWeight <= min1 ? drivenMax : drivenMin;
  }

  if (inputWeight <= min1) {
    // Below activation: inactive
    return drivenMin;
  } else if (inputWeight < max1) {
    // Ramp up: min1 → max1 maps to drivenMin → drivenMax
    const t = (inputWeight - min1) / (max1 - min1);
    return drivenMin + t * (drivenMax - drivenMin);
  } else if (inputWeight <= max2) {
    // Fully active plateau
    return drivenMax;
  } else if (inputWeight < min2) {
    // Ramp down: max2 → min2 maps to drivenMax → drivenMin
    const t = (inputWeight - max2) / (min2 - max2);
    return drivenMax + t * (drivenMin - drivenMax);
  } else {
    // Above activation: inactive
    return drivenMin;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Given an array of VisualParam bytes (one per param, in ID-sorted order),
 * compute skeleton bone deltas (scale and offset) for each affected bone.
 *
 * Returns a map of bone name → { scale: [1+accX, 1+accY, 1+accZ], offset: [x,y,z] }
 */
export function computeSkeletonDeltas(visualParamBytes: number[]): Record<string, BoneDelta> {
  ensureParsed();
  const params = sharedParams!;  // only groups 0+2, maps 1:1 to byte array
  const byId = paramById!;       // all params, for driver lookups

  // DEBUG: log byte alignment around Crooked_Nose (id=656)
  const crookedIdx = params.findIndex(p => p.id === 656);
  if (crookedIdx >= 0) {
    const context: string[] = [];
    for (let j = Math.max(0, crookedIdx - 3); j <= Math.min(params.length - 1, crookedIdx + 3); j++) {
      const b = j < visualParamBytes.length ? visualParamBytes[j] : -1;
      context.push(`[${j}]id=${params[j].id}:byte=${b}`);
    }
    console.log(`[AvatarShape] DEBUG byte alignment: ${context.join(' ')} | server_bytes=${visualParamBytes.length} our_params=${params.length}`);
  }

  // Accumulators per bone: additive scale and offset
  const accScale: Record<string, Vec3> = {};
  const accOffset: Record<string, Vec3> = {};

  function accumulateBones(param: ParamDef, weight: number): void {
    for (const bone of param.skeletonBones) {
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

  for (let i = 0; i < visualParamBytes.length && i < params.length; i++) {
    const param = params[i];
    const byte = visualParamBytes[i];

    // Dequantize
    const weight = (byte / 255.0) * (param.valueMax - param.valueMin) + param.valueMin;

    // Skeleton params: accumulate directly
    if (param.skeletonBones.length > 0) {
      accumulateBones(param, weight);
    }

    // Driver params: use SL's trapezoidal activation mapping to compute driven weight.
    // Each driven entry can specify min1/max1/max2/min2 for piecewise activation:
    //   weight <= min1: driven = driven.min (inactive)
    //   min1 < weight < max1: ramp up driven.min → driven.max
    //   max1 <= weight <= max2: driven = driven.max (fully active)
    //   max2 < weight < min2: ramp down driven.max → driven.min
    //   weight >= min2: driven = driven.min (inactive)
    // When not specified, defaults to simple linear remap across full driver range.
    if (param.drivenEntries.length > 0) {
      for (const entry of param.drivenEntries) {
        const driven = byId.get(entry.id);
        if (driven && driven.skeletonBones.length > 0) {
          const drivenWeight = getDrivenWeight(weight, param, driven, entry);
          accumulateBones(driven, drivenWeight);
        }
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
 * Returns the sorted list of parsed param definitions (for debugging/inspection).
 */
export function getVisualParams(): ReadonlyArray<ParamDef> {
  ensureParsed();
  return sharedParams!;
}
