/**
 * mesh-converter.ts — Converts LLMesh to GLB (binary glTF 2.0).
 * Hand-rolled GLB encoder, no npm dependencies.
 * Supports rigged meshes: emits JOINTS_0/WEIGHTS_0 + skin + skeleton nodes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { LLMesh } from '../../node-metaverse/dist/lib/classes/public/LLMesh';
import type { LLSubMesh } from '../../node-metaverse/dist/lib/classes/public/interfaces/LLSubMesh';
import type { LLSkin } from '../../node-metaverse/dist/lib/classes/public/interfaces/LLSkin';

const LOD_PREFERENCE = ['high_lod', 'medium_lod', 'low_lod', 'lowest_lod'];

// --- Avatar skeleton hierarchy (parsed from avatar_skeleton.xml) ---

interface SkeletonJoint {
  name: string;
  parent: string | null;
  pos: [number, number, number];  // local position in SL coords
  rot: [number, number, number];  // local rotation in SL coords (Euler degrees)
  children: string[];
  isCollisionVolume: boolean;
}

let skeletonCache: Map<string, SkeletonJoint> | null = null;
// Attachment point name → parent joint name (from avatar_lad.xml)
let attachmentPointCache: Map<string, string> | null = null;

function findCharacterFile(filename: string): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'viewer', 'character', filename),
    path.join(__dirname, '..', '..', '..', 'viewer', 'character', filename),
    path.join(__dirname, '..', '..', '..', '..', 'indra', 'newview', 'character', filename),
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf8'); } catch { /* try next */ }
  }
  return '';
}

export function getSkeletonHierarchy(): Map<string, SkeletonJoint> {
  if (skeletonCache) return skeletonCache;

  const xml = findCharacterFile('avatar_skeleton.xml');
  if (!xml) {
    console.warn('[mesh-converter] avatar_skeleton.xml not found, skeleton hierarchy unavailable');
    skeletonCache = new Map();
    return skeletonCache;
  }

  skeletonCache = parseSkeletonXml(xml);
  console.log(`[mesh-converter] Loaded skeleton hierarchy: ${skeletonCache.size} joints`);
  return skeletonCache;
}

/** Get attachment point name → parent joint name mapping from avatar_lad.xml */
export function getAttachmentPoints(): Map<string, string> {
  if (attachmentPointCache) return attachmentPointCache;

  const xml = findCharacterFile('avatar_lad.xml');
  if (!xml) {
    console.warn('[mesh-converter] avatar_lad.xml not found, attachment points unavailable');
    attachmentPointCache = new Map();
    return attachmentPointCache;
  }

  attachmentPointCache = parseAttachmentPoints(xml);
  console.log(`[mesh-converter] Loaded attachment points: ${attachmentPointCache.size} points`);
  return attachmentPointCache;
}

/** Parse avatar_lad.xml for attachment_point tags: name → joint (parent bone) */
function parseAttachmentPoints(xml: string): Map<string, string> {
  const points = new Map<string, string>();
  // attachment_point tags span multiple lines, so collect each tag's full content
  const tagRegex = /<attachment_point\b([\s\S]*?)\/>/g;
  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/);
    const jointMatch = attrs.match(/\bjoint="([^"]+)"/);
    if (nameMatch && jointMatch) {
      points.set(nameMatch[1], jointMatch[1]);
    }
  }
  return points;
}

function parseSkeletonXml(xml: string): Map<string, SkeletonJoint> {
  const joints = new Map<string, SkeletonJoint>();
  // Stack-based parser: track parent bone names via nesting depth
  const parentStack: string[] = [];

  // Match <bone ...> and <collision_volume ...> (opening, may be self-closing) and </bone> (closing)
  // collision_volume tags are always self-closing children of bone tags.
  const tagRegex = /<(\/?)(bone|collision_volume)\b([^>]*?)(\/?)>/g;
  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    const isClosing = match[1] === '/';
    const tagName = match[2];
    const attrs = match[3];
    const isSelfClosing = match[4] === '/';

    if (isClosing) {
      // Only bone tags have closing tags; collision_volume is always self-closing
      parentStack.pop();
      continue;
    }

    const nameMatch = attrs.match(/\bname="([^"]+)"/);
    const posMatch = attrs.match(/\bpos="([^"]+)"/);
    const rotMatch = attrs.match(/\brot="([^"]+)"/);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const pos: [number, number, number] = [0, 0, 0];
    if (posMatch) {
      const parts = posMatch[1].trim().split(/\s+/).map(Number);
      if (parts.length >= 3) {
        pos[0] = parts[0]; pos[1] = parts[1]; pos[2] = parts[2];
      }
    }
    const rot: [number, number, number] = [0, 0, 0];
    if (rotMatch) {
      const parts = rotMatch[1].trim().split(/\s+/).map(Number);
      if (parts.length >= 3) {
        rot[0] = parts[0]; rot[1] = parts[1]; rot[2] = parts[2];
      }
    }

    const parentName = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;
    joints.set(name, { name, parent: parentName, pos, rot, children: [], isCollisionVolume: tagName === 'collision_volume' });
    if (parentName && joints.has(parentName)) {
      joints.get(parentName)!.children.push(name);
    }

    // Only bone tags push onto the parent stack (collision_volume is always self-closing)
    if (!isSelfClosing && tagName === 'bone') {
      parentStack.push(name);
    }
  }
  return joints;
}

// --- 4×4 matrix helpers (column-major) ---

/**
 * Strip scale from the upper-3×3 of a column-major 4×4 matrix, preserving rotation and translation.
 * Matches Firestorm's skeleton approach: bone hierarchy uses pure rotation + translation (no scale).
 * IBMs in the skin accessor are unchanged — they handle scale via vertex skinning math.
 */
function mat4NormalizeRotation(m: number[]): number[] {
  const r = [...m];
  // Normalize each column of the 3×3 rotation submatrix
  for (let col = 0; col < 3; col++) {
    const base = col * 4;
    const len = Math.sqrt(r[base]*r[base] + r[base+1]*r[base+1] + r[base+2]*r[base+2]);
    if (len > 1e-9) { r[base] /= len; r[base+1] /= len; r[base+2] /= len; }
  }
  return r;
}

/** Multiply two column-major 4×4 matrices: result = A * B. */
function mat4Mul(a: number[], b: number[]): number[] {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = sum;
    }
  }
  return r;
}

/** Invert a column-major 4×4 matrix (general, not just rigid-body). */
function mat4Inverse(m: number[]): number[] | null {
  const inv = new Array(16);
  inv[0]  =  m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
  inv[4]  = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
  inv[8]  =  m[4]*m[9]*m[15]  - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14]  + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
  inv[1]  = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
  inv[5]  =  m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
  inv[9]  = -m[0]*m[9]*m[15]  + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
  inv[13] =  m[0]*m[9]*m[14]  - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
  inv[2]  =  m[1]*m[6]*m[15]  - m[1]*m[7]*m[14]  - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7]  - m[13]*m[3]*m[6];
  inv[6]  = -m[0]*m[6]*m[15]  + m[0]*m[7]*m[14]  + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7]  + m[12]*m[3]*m[6];
  inv[10] =  m[0]*m[5]*m[15]  - m[0]*m[7]*m[13]  - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7]  - m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14]  + m[0]*m[6]*m[13]  + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6]  + m[12]*m[2]*m[5];
  inv[3]  = -m[1]*m[6]*m[11]  + m[1]*m[7]*m[10]  + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7]   + m[9]*m[3]*m[6];
  inv[7]  =  m[0]*m[6]*m[11]  - m[0]*m[7]*m[10]  - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7]   - m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11]  + m[0]*m[7]*m[9]   + m[4]*m[1]*m[11] - m[4]*m[3]*m[9]  - m[8]*m[1]*m[7]   + m[8]*m[3]*m[5];
  inv[15] =  m[0]*m[5]*m[10]  - m[0]*m[6]*m[9]   - m[4]*m[1]*m[10] + m[4]*m[2]*m[9]  + m[8]*m[1]*m[6]   - m[8]*m[2]*m[5];
  const det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1.0 / det;
  for (let i = 0; i < 16; i++) inv[i] *= invDet;
  return inv;
}

// --- SL↔Godot coordinate transform for 4×4 inverse bind matrices ---

function transformInverseBindMatrix(slRowMajor: number[]): number[] {
  // Input: 16 floats from SL row-major IBM: m[row*4+col] = M[row][col]
  //   (.all() returns raw LLSD bytes which are SL row-major)
  //
  // Output: column-major for glTF, representing R * M^T * R^T
  //   M^T: SL uses row-vector convention (v * M), glTF uses column-vector (M * v),
  //         so the IBM must be transposed.
  //   R:   SL→Godot coordinate transform (x,y,z)→(x,z,-y)
  //        R = [[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]]
  //
  // Derivation: v_joint_godot = R * IBM_sl^T * R^T * v_bind_godot
  //   so IBM_gltf = R * M^T * R^T
  //
  // Row-major result of R * M^T * R^T (where M^T[i][j] = M[j][i] = m[j*4+i]):
  //   Row 0: m[0],  m[8],  -m[4],  m[12]
  //   Row 1: m[2],  m[10], -m[6],  m[14]
  //   Row 2: -m[1], -m[9],  m[5],  -m[13]
  //   Row 3: m[3],  m[11], -m[7],  m[15]

  const m = slRowMajor;
  // Column-major output (read columns top-to-bottom from the row-major result)
  return [
    m[0],   m[2],  -m[1],   m[3],   // col 0
    m[8],   m[10], -m[9],   m[11],  // col 1
   -m[4],  -m[6],   m[5],  -m[7],   // col 2
    m[12],  m[14], -m[13],  m[15],  // col 3
  ];
}

function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'asset-cache', 'meshes');
}

export function meshCachePath(meshUuid: string): string {
  return path.join(getCacheDir(), `${meshUuid}.glb`);
}

export function staticMeshCachePath(meshUuid: string): string {
  return path.join(getCacheDir(), `${meshUuid}.static.glb`);
}

export function isMeshCached(meshUuid: string): boolean {
  return fs.existsSync(meshCachePath(meshUuid));
}

function metaPath(meshUuid: string): string {
  return path.join(getCacheDir(), `${meshUuid}.meta`);
}

/** Read persisted rigged/jointNames info for a cached mesh.
 *  Falls back to scanning the GLB JSON chunk for "skins" if no .meta file exists. */
export function readMeshMeta(meshUuid: string): { isRigged: boolean; jointNames?: string[]; staticCachePath?: string } | undefined {
  // Check for static GLB (rigged mesh without BSM, for non-animesh display)
  const staticPath = staticMeshCachePath(meshUuid);
  const hasStatic = fs.existsSync(staticPath);

  // Fast path: .meta sidecar exists
  try {
    const data = JSON.parse(fs.readFileSync(metaPath(meshUuid), 'utf8'));
    return { isRigged: !!data.isRigged, jointNames: data.jointNames, staticCachePath: hasStatic ? staticPath : undefined };
  } catch { /* no meta file — fall through to GLB scan */ }

  // Fallback: scan GLB JSON chunk for "skins" (handles meshes cached before meta was added)
  try {
    const glbPath = meshCachePath(meshUuid);
    const fd = fs.openSync(glbPath, 'r');
    try {
      // GLB header: 12 bytes (magic + version + length)
      // Chunk 0 header: 4 bytes length + 4 bytes type
      const header = Buffer.alloc(20);
      fs.readSync(fd, header, 0, 20, 0);
      const jsonLen = header.readUInt32LE(12);
      // Read just enough of the JSON chunk to detect "skins"
      const readLen = Math.min(jsonLen, 8192);
      const jsonBuf = Buffer.alloc(readLen);
      fs.readSync(fd, jsonBuf, 0, readLen, 20);
      const jsonStr = jsonBuf.toString('utf8');
      const isRigged = jsonStr.includes('"skins"');
      // Persist for next time
      if (isRigged) {
        try { fs.writeFileSync(metaPath(meshUuid), JSON.stringify({ isRigged })); } catch { /* ignore */ }
      }
      return { isRigged };
    } finally {
      fs.closeSync(fd);
    }
  } catch { return undefined; }
}

export interface MeshConvertResult {
  cachePath: string;
  staticCachePath?: string; // GLB without BSM (for non-animesh static display)
  isRigged: boolean;
  jointNames?: string[];
}

export async function ensureMeshCached(meshUuid: string, mesh: LLMesh): Promise<MeshConvertResult> {
  const cachePath = meshCachePath(meshUuid);
  const isRigged = !!(mesh.skin && mesh.skin.jointNames.length > 0);
  const hasBsm = isRigged && !!mesh.skin?.bindShapeMatrix && !isBsmIdentity(mesh.skin.bindShapeMatrix.all());
  const staticPath = hasBsm ? staticMeshCachePath(meshUuid) : undefined;

  if (fs.existsSync(cachePath)) {
    // Generate static GLB if missing (rigged mesh with non-identity BSM)
    if (staticPath && !fs.existsSync(staticPath)) {
      const staticGlb = llMeshToGlb(mesh, { skipBsm: true });
      if (staticGlb) fs.writeFileSync(staticPath, staticGlb);
    }
    // Persist meta if missing
    if (!fs.existsSync(metaPath(meshUuid)) && isRigged) {
      try { fs.writeFileSync(metaPath(meshUuid), JSON.stringify({ isRigged, jointNames: mesh.skin?.jointNames })); } catch { /* ignore */ }
    }
    return { cachePath, staticCachePath: staticPath, isRigged, jointNames: mesh.skin?.jointNames };
  }

  // Generate full BSM GLB (for animesh)
  const glb = llMeshToGlb(mesh);
  if (!glb) throw new Error(`Failed to convert mesh ${meshUuid} to GLB`);

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, glb);

  // Generate static GLB without BSM (for non-animesh display)
  if (staticPath) {
    const staticGlb = llMeshToGlb(mesh, { skipBsm: true });
    if (staticGlb) fs.writeFileSync(staticPath, staticGlb);
  }

  if (isRigged) {
    try { fs.writeFileSync(metaPath(meshUuid), JSON.stringify({ isRigged, jointNames: mesh.skin?.jointNames })); } catch { /* ignore */ }
  }
  return { cachePath, staticCachePath: staticPath, isRigged, jointNames: mesh.skin?.jointNames };
}

function isBsmIdentity(raw: number[]): boolean {
  return raw[0] === 1 && raw[5] === 1 && raw[10] === 1 && raw[15] === 1 &&
    raw[1] === 0 && raw[2] === 0 && raw[3] === 0 && raw[4] === 0 &&
    raw[6] === 0 && raw[7] === 0 && raw[8] === 0 && raw[9] === 0 &&
    raw[11] === 0 && raw[12] === 0 && raw[13] === 0 && raw[14] === 0;
}

export function llMeshToGlb(mesh: LLMesh, opts?: { skipBsm?: boolean }): Buffer | null {
  // Pick best available LOD
  let submeshes: LLSubMesh[] | undefined;
  for (const lod of LOD_PREFERENCE) {
    const level = mesh.lodLevels[lod];
    if (level && level.length > 0) {
      submeshes = level;
      break;
    }
  }
  if (!submeshes || submeshes.length === 0) return null;

  // Extract bind shape matrix for rigged meshes — bake into vertex positions
  // skipBsm: for non-animesh static display, SL uses raw mesh-space vertices (no BSM)
  let bsm: number[] | null = null;
  let bsmNormal: number[] | null = null; // inverse-transpose of BSM upper-3x3 (for normals)
  if (!opts?.skipBsm && mesh.skin?.bindShapeMatrix) {
    const raw = mesh.skin.bindShapeMatrix.all();
    const isId = raw[0] === 1 && raw[5] === 1 && raw[10] === 1 && raw[15] === 1 &&
      raw[1] === 0 && raw[2] === 0 && raw[3] === 0 && raw[4] === 0 &&
      raw[6] === 0 && raw[7] === 0 && raw[8] === 0 && raw[9] === 0 &&
      raw[11] === 0 && raw[12] === 0 && raw[13] === 0 && raw[14] === 0;
    if (!isId) {
      bsm = raw;
      // SL uses transpose(inverse(BSM)) for normals (llface.cpp:1601-1602).
      // Compute inverse-transpose of BSM's upper-3x3 (row-major).
      // BSM row-major: [r*4+c] = M[row][col]
      const a = raw[0], b = raw[1], c = raw[2];
      const d = raw[4], e = raw[5], f = raw[6];
      const g = raw[8], h = raw[9], k = raw[10];
      const det = a*(e*k - f*h) - b*(d*k - f*g) + c*(d*h - e*g);
      if (Math.abs(det) > 1e-12) {
        const id = 1 / det;
        // inverse of 3x3 (row-major), then transpose = inverse-transpose (row-major)
        // inv[i][j] = cofactor(j,i) / det, then transpose swaps i,j back
        // So invT[i][j] = cofactor(i,j) / det
        bsmNormal = [
          (e*k - f*h) * id, (d*k - f*g) * -id, (d*h - e*g) * id,  0,
          (b*k - c*h) * -id, (a*k - c*g) * id, (a*h - b*g) * -id,  0,
          (b*f - c*e) * id, (a*f - c*d) * -id, (a*e - b*d) * id,  0,
          0, 0, 0, 0,
        ];
      }
    }
  }

  // Collect binary data and glTF descriptors
  const bufferParts: Buffer[] = [];
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const primitives: any[] = [];
  let byteOffset = 0;

  for (const sub of submeshes) {
    if (sub.noGeometry || !sub.position || sub.position.length === 0
      || !sub.triangleList || sub.triangleList.length === 0) {
      continue;
    }

    const vertCount = sub.position.length;
    const idxCount = sub.triangleList.length;
    const hasNormals = sub.normal && sub.normal.length === vertCount;
    const hasUVs = sub.texCoord0 && sub.texCoord0.length === vertCount;
    const attributes: Record<string, number> = {};

    // --- Positions (vec3 float32) ---
    // Apply bind shape matrix (if rigged), then SL (x,y,z) → Godot (x,z,-y)
    const posBuf = Buffer.alloc(vertCount * 12);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertCount; i++) {
      const p = sub.position[i];
      let sx = p.x, sy = p.y, sz = p.z;
      if (bsm) {
        // Row-vector multiply: [x,y,z,1] * BSM
        sx = p.x * bsm[0] + p.y * bsm[4] + p.z * bsm[8]  + bsm[12];
        sy = p.x * bsm[1] + p.y * bsm[5] + p.z * bsm[9]  + bsm[13];
        sz = p.x * bsm[2] + p.y * bsm[6] + p.z * bsm[10] + bsm[14];
      }
      const gx = sx;
      const gy = sz;
      const gz = -sy;
      posBuf.writeFloatLE(gx, i * 12);
      posBuf.writeFloatLE(gy, i * 12 + 4);
      posBuf.writeFloatLE(gz, i * 12 + 8);
      if (gx < minX) minX = gx; if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy; if (gy > maxY) maxY = gy;
      if (gz < minZ) minZ = gz; if (gz > maxZ) maxZ = gz;
    }

    bufferViews.push({ buffer: 0, byteOffset, byteLength: posBuf.length });
    accessors.push({
      bufferView: bufferViews.length - 1, componentType: 5126 /* FLOAT */,
      count: vertCount, type: 'VEC3',
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
    });
    attributes['POSITION'] = accessors.length - 1;
    bufferParts.push(posBuf);
    byteOffset += posBuf.length;

    // --- Normals (vec3 float32) ---
    if (hasNormals) {
      const nrmBuf = Buffer.alloc(vertCount * 12);
      for (let i = 0; i < vertCount; i++) {
        const n = sub.normal![i];
        let nx = n.x, ny = n.y, nz = n.z;
        if (bsmNormal) {
          // SL uses transpose(inverse(BSM)) for normals (llface.cpp:1601).
          // Row-vector multiply: [nx,ny,nz] * invT_3x3
          nx = n.x * bsmNormal[0] + n.y * bsmNormal[4] + n.z * bsmNormal[8];
          ny = n.x * bsmNormal[1] + n.y * bsmNormal[5] + n.z * bsmNormal[9];
          nz = n.x * bsmNormal[2] + n.y * bsmNormal[6] + n.z * bsmNormal[10];
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (len > 0) { nx /= len; ny /= len; nz /= len; }
        } else if (bsm) {
          // Identity inverse-transpose (det was zero?) — use BSM directly as fallback
          nx = n.x * bsm[0] + n.y * bsm[4] + n.z * bsm[8];
          ny = n.x * bsm[1] + n.y * bsm[5] + n.z * bsm[9];
          nz = n.x * bsm[2] + n.y * bsm[6] + n.z * bsm[10];
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (len > 0) { nx /= len; ny /= len; nz /= len; }
        }
        nrmBuf.writeFloatLE(nx, i * 12);
        nrmBuf.writeFloatLE(nz, i * 12 + 4);
        nrmBuf.writeFloatLE(-ny, i * 12 + 8);
      }
      bufferViews.push({ buffer: 0, byteOffset, byteLength: nrmBuf.length });
      accessors.push({
        bufferView: bufferViews.length - 1, componentType: 5126,
        count: vertCount, type: 'VEC3',
      });
      attributes['NORMAL'] = accessors.length - 1;
      bufferParts.push(nrmBuf);
      byteOffset += nrmBuf.length;
    }

    // --- UVs (vec2 float32) ---
    if (hasUVs) {
      const uvBuf = Buffer.alloc(vertCount * 8);
      for (let i = 0; i < vertCount; i++) {
        const uv = sub.texCoord0![i];
        uvBuf.writeFloatLE(uv.x, i * 8);
        uvBuf.writeFloatLE(1.0 - uv.y, i * 8 + 4); // flip V for glTF
      }
      bufferViews.push({ buffer: 0, byteOffset, byteLength: uvBuf.length });
      accessors.push({
        bufferView: bufferViews.length - 1, componentType: 5126,
        count: vertCount, type: 'VEC2',
      });
      attributes['TEXCOORD_0'] = accessors.length - 1;
      bufferParts.push(uvBuf);
      byteOffset += uvBuf.length;
    }

    // --- Indices ---
    // SL→Godot is a det=+1 rotation (90° around X), so winding is preserved
    const useUint32 = vertCount > 65535;
    const idxByteSize = useUint32 ? 4 : 2;
    const idxBuf = Buffer.alloc(idxCount * idxByteSize);
    for (let i = 0; i < idxCount; i += 3) {
      const a = sub.triangleList[i];
      const b = sub.triangleList[i + 1];
      const c = sub.triangleList[i + 2];
      if (useUint32) {
        idxBuf.writeUInt32LE(a, i * 4);
        idxBuf.writeUInt32LE(b, (i + 1) * 4);
        idxBuf.writeUInt32LE(c, (i + 2) * 4);
      } else {
        idxBuf.writeUInt16LE(a, i * 2);
        idxBuf.writeUInt16LE(b, (i + 1) * 2);
        idxBuf.writeUInt16LE(c, (i + 2) * 2);
      }
    }

    // Pad to 4-byte alignment for next buffer view
    const idxPadding = (4 - (idxBuf.length % 4)) % 4;
    const idxAligned = idxPadding > 0
      ? Buffer.concat([idxBuf, Buffer.alloc(idxPadding)])
      : idxBuf;

    bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBuf.length });
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: useUint32 ? 5125 /* UNSIGNED_INT */ : 5123 /* UNSIGNED_SHORT */,
      count: idxCount, type: 'SCALAR',
    });

    primitives.push({ attributes, indices: accessors.length - 1 });
    bufferParts.push(idxAligned);
    byteOffset += idxAligned.length;
  }

  if (primitives.length === 0) return null;

  // --- Skin / skeleton data for rigged meshes ---
  // Skip skin/skeleton entirely for static GLB (no BSM = no skinning needed)
  const skin = opts?.skipBsm ? null : mesh.skin;
  const isRigged = skin && skin.jointNames.length > 0 &&
    submeshes!.some(s => s.weights && s.weights.length > 0);

  const nodes: any[] = [{ mesh: 0 }]; // node 0 = mesh node
  let skinObj: any = undefined;

  if (isRigged) {
    const skeleton = getSkeletonHierarchy();
    const jointNames = skin!.jointNames;

    // Resolve attachment point names to their parent bones
    const attachPoints = getAttachmentPoints();

    // Collect all joints used by this mesh + ancestors up to root
    const usedJoints = new Set<string>(jointNames);
    usedJoints.add('mPelvis'); // Ensure present as fallback
    for (const jn of jointNames) {
      let cur = jn;
      // If this is an attachment point, ensure its parent bone is included
      if (!skeleton.has(cur) && attachPoints.has(cur)) {
        cur = attachPoints.get(cur)!;
        usedJoints.add(cur);
      }
      while (cur && skeleton.has(cur)) {
        usedJoints.add(cur);
        const parent = skeleton.get(cur)!.parent;
        if (!parent) break;
        cur = parent;
      }
    }

    // Build ordered list: topological order (parents before children)
    // Process standard bones first, then orphaned (custom names not in XML),
    // so orphaned bones always come after their inferred parents.
    const orderedJoints: string[] = [];
    const visited = new Set<string>();
    function visit(name: string): void {
      if (visited.has(name) || !usedJoints.has(name)) return;
      const sj = skeleton.get(name);
      if (sj?.parent && usedJoints.has(sj.parent)) visit(sj.parent);
      visited.add(name);
      orderedJoints.push(name);
    }
    for (const jn of usedJoints) { if (skeleton.has(jn)) visit(jn); }
    for (const jn of usedJoints) { if (!skeleton.has(jn)) visit(jn); }

    // Map joint name → glTF node index (offset by 1 since node 0 is the mesh)
    const jointNodeOffset = 1; // joint nodes start at index 1
    const jointNameToNodeIdx = new Map<string, number>();
    for (let i = 0; i < orderedJoints.length; i++) {
      jointNameToNodeIdx.set(orderedJoints[i], jointNodeOffset + i);
    }

    // Map original skin jointNames → index in orderedJoints
    // (for remapping per-vertex joint indices)
    const skinJointToOrdered = new Map<number, number>();
    for (let i = 0; i < jointNames.length; i++) {
      const oi = orderedJoints.indexOf(jointNames[i]);
      skinJointToOrdered.set(i, oi >= 0 ? oi : 0);
    }

    // --- Compute joint world transforms (column-major 4×4 in Godot/glTF space) ---
    // For joints with IBMs: JW = inverse(IBM_gltf). Handles rotation AND scale.
    // For ancestor joints without IBMs: accumulate from avatar_skeleton.xml.
    const jointWorldTransforms = new Map<string, number[]>(); // col-major 4×4
    for (const jname of orderedJoints) {
      const skinIdx = jointNames.indexOf(jname);
      if (skinIdx >= 0 && skin!.inverseBindMatrix[skinIdx]) {
        const ibmGltf = transformInverseBindMatrix(skin!.inverseBindMatrix[skinIdx].all());
        const jw = mat4Inverse(ibmGltf);
        if (jw) {
          jointWorldTransforms.set(jname, jw);
        } else {
          // Singular IBM — fall back to identity
          jointWorldTransforms.set(jname, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        }
      } else {
        // Ancestor: accumulate position from skeleton hierarchy (identity rotation/scale)
        const sj = skeleton.get(jname);
        const parentJW = sj?.parent && jointWorldTransforms.has(sj.parent)
          ? jointWorldTransforms.get(sj.parent)! : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
        const lp = sj ? sj.pos : [0, 0, 0] as [number, number, number];
        // Local transform = translation only (identity rotation for XML ancestors), SL→Godot
        const localGodot = [1,0,0,0, 0,1,0,0, 0,0,1,0, lp[0],lp[2],-lp[1],1];
        jointWorldTransforms.set(jname, mat4Mul(parentJW, localGodot));
      }
    }

    // --- Resolve orphaned joints (not in avatar_skeleton.xml) ---
    // Attachment point names (from avatar_lad.xml) → parent to their skeleton joint.
    // SL resolves these via getJoint() tree walk — attachment points are children of
    // their parent bones. Their IBM-derived world transform is correct, so we compute
    // local = inv(parentJW) * childJW like any other child.
    // Truly unknown names → mPelvis fallback (SL's initJointNums).
    const orphanParent = new Map<string, string>();
    for (const jname of orderedJoints) {
      if (skeleton.has(jname)) continue;
      const attachParent = attachPoints.get(jname);
      if (attachParent && jointWorldTransforms.has(attachParent)) {
        orphanParent.set(jname, attachParent);
      } else {
        orphanParent.set(jname, 'mPelvis');
      }
    }

    // Create glTF nodes for each joint
    // Node local transforms derived from JW = inverse(IBM), stored as node.matrix
    // (not TRS) to preserve shear from non-uniform collision volume scale.
    // For child joints: Local = JW_parent^{-1} * JW_child. For roots: Local = JW.
    let skeletonRootIdx = -1;
    for (let i = 0; i < orderedJoints.length; i++) {
      const jname = orderedJoints[i];
      const sj = skeleton.get(jname);
      const node: any = { name: jname };

      const jw = jointWorldTransforms.get(jname)!;
      const parentName = sj?.parent && jointWorldTransforms.has(sj.parent)
        ? sj.parent : (orphanParent.get(jname) ?? null);

      // Compute local transform (in Godot/glTF space)
      let localMat: number[];
      if (orphanParent.has(jname) && !attachPoints.has(jname)) {
        // Truly unknown joint — identity under mPelvis (SL initJointNums fallback).
        localMat = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
      } else if (parentName) {
        // Local = JW_parent^{-1} * JW_child
        const parentJW = jointWorldTransforms.get(parentName)!;
        const parentInv = mat4Inverse(parentJW);
        localMat = parentInv ? mat4Mul(parentInv, jw) : jw;
      } else {
        localMat = jw;
      }

      // Write local transform as matrix (not TRS).
      // For standard skeleton bones: strip scale to match Firestorm's approach — SL bone
      // hierarchy is pure rotation + translation. Scale in IBMs belongs to vertex skinning
      // math only. Stripping scale fixes half t-pose from rest.basis scale in pose derivation.
      // For collision volume bones: keep IBM-derived scale intact. Their vertices have IBMs
      // that cancel exactly that scale; normalizing would catastrophically distort those vertices.
      const isCollVol = sj?.isCollisionVolume ?? false;
      node.matrix = isCollVol ? localMat : mat4NormalizeRotation(localMat);

      // Children in the glTF node (standard hierarchy + orphaned bones parented here)
      const childNodeIndices: number[] = [];
      if (sj) {
        for (const childName of sj.children) {
          if (jointNameToNodeIdx.has(childName)) {
            childNodeIndices.push(jointNameToNodeIdx.get(childName)!);
          }
        }
      }
      orphanParent.forEach((inferredParent, orphanName) => {
        if (inferredParent === jname && jointNameToNodeIdx.has(orphanName)) {
          childNodeIndices.push(jointNameToNodeIdx.get(orphanName)!);
        }
      });
      if (childNodeIndices.length > 0) {
        node.children = childNodeIndices;
      }

      nodes.push(node);

      // Track skeleton root (joint with no parent — neither XML nor inferred)
      if (!parentName) {
        if (skeletonRootIdx === -1) skeletonRootIdx = jointNodeOffset + i;
      }
    }

    // Mesh node is child of skeleton root
    if (skeletonRootIdx >= 0) {
      nodes[0].skin = 0;
    }

    // --- Inverse bind matrices accessor ---
    // Each matrix: 16 floats (MAT4), column-major, coordinate-transformed
    const ibmBuf = Buffer.alloc(orderedJoints.length * 64); // 16 floats * 4 bytes
    for (let i = 0; i < orderedJoints.length; i++) {
      const jname = orderedJoints[i];
      const skinIdx = jointNames.indexOf(jname);

      let colMajor: number[];
      if (skinIdx >= 0 && skin!.inverseBindMatrix[skinIdx]) {
        // node-metaverse stores SL LLSD values verbatim in its column-major Matrix4,
        // but SL LLSD is row-major → .all() gives us the SL row-major bytes
        const slRowMajor = skin!.inverseBindMatrix[skinIdx].all();
        colMajor = transformInverseBindMatrix(slRowMajor);
      } else {
        // Joint not in skin (ancestor added for hierarchy) — use identity
        colMajor = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
      }

      for (let j = 0; j < 16; j++) {
        ibmBuf.writeFloatLE(colMajor[j], (i * 16 + j) * 4);
      }
    }

    bufferViews.push({ buffer: 0, byteOffset, byteLength: ibmBuf.length });
    const ibmAccessorIdx = accessors.length;
    accessors.push({
      bufferView: bufferViews.length - 1, componentType: 5126 /* FLOAT */,
      count: orderedJoints.length, type: 'MAT4',
    });
    bufferParts.push(ibmBuf);
    byteOffset += ibmBuf.length;

    // --- Skin object ---
    const jointIndices = orderedJoints.map((_, i) => jointNodeOffset + i);
    skinObj = {
      inverseBindMatrices: ibmAccessorIdx,
      joints: jointIndices,
      skeleton: skeletonRootIdx >= 0 ? skeletonRootIdx : jointIndices[0],
    };

    // --- Per-submesh JOINTS_0 / WEIGHTS_0 ---
    // We need to retroactively add these attributes to the primitives we already built.
    // Iterate submeshes again in the same order.
    let primIdx = 0;
    for (const sub of submeshes!) {
      if (sub.noGeometry || !sub.position || sub.position.length === 0
        || !sub.triangleList || sub.triangleList.length === 0) {
        continue;
      }
      if (primIdx >= primitives.length) break;

      const vertCount = sub.position.length;
      const hasWeights = sub.weights && sub.weights.length === vertCount;

      if (hasWeights) {
        // JOINTS_0: VEC4 of UNSIGNED_BYTE (joint indices remapped to orderedJoints)
        const jointsBuf = Buffer.alloc(vertCount * 4);
        // WEIGHTS_0: VEC4 of FLOAT (normalized)
        const weightsBuf = Buffer.alloc(vertCount * 16);

        for (let v = 0; v < vertCount; v++) {
          const w = sub.weights![v];
          const entries = Object.entries(w);
          // Normalize weights to sum to 1.0
          // Raw values are UInt16 [0, 65535]
          let totalRaw = 0;
          for (const [, raw] of entries) totalRaw += raw;

          for (let slot = 0; slot < 4; slot++) {
            if (slot < entries.length) {
              const [jointIdxStr, raw] = entries[slot];
              const origJointIdx = parseInt(jointIdxStr, 10);
              // Remap to orderedJoints index
              const remapped = skinJointToOrdered.get(origJointIdx) ?? 0;
              jointsBuf.writeUInt8(Math.min(remapped, 255), v * 4 + slot);
              weightsBuf.writeFloatLE(totalRaw > 0 ? raw / totalRaw : 0, v * 16 + slot * 4);
            } else {
              jointsBuf.writeUInt8(0, v * 4 + slot);
              weightsBuf.writeFloatLE(0, v * 16 + slot * 4);
            }
          }
        }

        // JOINTS_0
        bufferViews.push({ buffer: 0, byteOffset, byteLength: jointsBuf.length });
        accessors.push({
          bufferView: bufferViews.length - 1,
          componentType: 5121 /* UNSIGNED_BYTE */,
          count: vertCount, type: 'VEC4',
        });
        primitives[primIdx].attributes['JOINTS_0'] = accessors.length - 1;
        bufferParts.push(jointsBuf);
        byteOffset += jointsBuf.length;

        // WEIGHTS_0
        bufferViews.push({ buffer: 0, byteOffset, byteLength: weightsBuf.length });
        accessors.push({
          bufferView: bufferViews.length - 1,
          componentType: 5126 /* FLOAT */,
          count: vertCount, type: 'VEC4',
        });
        primitives[primIdx].attributes['WEIGHTS_0'] = accessors.length - 1;
        bufferParts.push(weightsBuf);
        byteOffset += weightsBuf.length;
      }
      primIdx++;
    }
  }

  // Build glTF JSON
  // Scene root nodes: mesh node (0) + skeleton root (if rigged and skeleton root is a top-level node)
  const sceneNodes = [0];
  if (isRigged) {
    // Find skeleton root nodes that aren't children of any other joint node
    const childOfSomeone = new Set<number>();
    for (const n of nodes) {
      if (n.children) for (const c of n.children) childOfSomeone.add(c);
    }
    for (let i = 1; i < nodes.length; i++) {
      if (!childOfSomeone.has(i)) sceneNodes.push(i);
    }
  }

  const gltf: any = {
    asset: { version: '2.0', generator: 'PyroKitty' },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes,
    meshes: [{ primitives }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };

  if (skinObj) {
    gltf.skins = [skinObj];
  }

  // Encode JSON chunk (pad to 4 bytes with spaces)
  const jsonStr = JSON.stringify(gltf);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonBuf = Buffer.from(jsonStr + ' '.repeat(jsonPad), 'utf8');

  // Binary chunk
  const binBuf = Buffer.concat(bufferParts);

  // Assemble GLB: header(12) + JSON chunk(8+data) + BIN chunk(8+data)
  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const glb = Buffer.alloc(totalLength);
  let off = 0;

  // GLB header
  glb.writeUInt32LE(0x46546C67, off); off += 4; // magic "glTF"
  glb.writeUInt32LE(2, off); off += 4;           // version
  glb.writeUInt32LE(totalLength, off); off += 4;

  // JSON chunk
  glb.writeUInt32LE(jsonBuf.length, off); off += 4;
  glb.writeUInt32LE(0x4E4F534A, off); off += 4;   // "JSON"
  jsonBuf.copy(glb, off); off += jsonBuf.length;

  // BIN chunk
  glb.writeUInt32LE(binBuf.length, off); off += 4;
  glb.writeUInt32LE(0x004E4942, off); off += 4;   // "BIN\0"
  binBuf.copy(glb, off);

  return glb;
}
