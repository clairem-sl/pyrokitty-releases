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
  children: string[];
}

let skeletonCache: Map<string, SkeletonJoint> | null = null;

function getSkeletonHierarchy(): Map<string, SkeletonJoint> {
  if (skeletonCache) return skeletonCache;

  // Find avatar_skeleton.xml — try electron-ui/viewer/character/ first
  const candidates = [
    // From src/main/ → electron-ui/viewer/character/
    path.join(__dirname, '..', '..', 'viewer', 'character', 'avatar_skeleton.xml'),
    // From dist/main/ → electron-ui/viewer/character/
    path.join(__dirname, '..', '..', '..', 'viewer', 'character', 'avatar_skeleton.xml'),
    // From electron-ui/ → indra/newview/character/
    path.join(__dirname, '..', '..', '..', '..', 'indra', 'newview', 'character', 'avatar_skeleton.xml'),
  ];
  let xml = '';
  for (const p of candidates) {
    try { xml = fs.readFileSync(p, 'utf8'); break; } catch { /* try next */ }
  }
  if (!xml) {
    console.warn('[mesh-converter] avatar_skeleton.xml not found, skeleton hierarchy unavailable');
    skeletonCache = new Map();
    return skeletonCache;
  }

  skeletonCache = parseSkeletonXml(xml);
  console.log(`[mesh-converter] Loaded skeleton hierarchy: ${skeletonCache.size} joints`);
  return skeletonCache;
}

function parseSkeletonXml(xml: string): Map<string, SkeletonJoint> {
  const joints = new Map<string, SkeletonJoint>();
  // Stack-based parser: track parent bone names via nesting depth
  const parentStack: string[] = [];

  // Match <bone ...> (opening, may be self-closing) and </bone> (closing)
  const tagRegex = /<(\/?)bone\b([^>]*?)(\/?)>/g;
  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    const isClosing = match[1] === '/';
    const attrs = match[2];
    const isSelfClosing = match[3] === '/';

    if (isClosing) {
      parentStack.pop();
      continue;
    }

    const nameMatch = attrs.match(/\bname="([^"]+)"/);
    const posMatch = attrs.match(/\bpos="([^"]+)"/);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const pos: [number, number, number] = [0, 0, 0];
    if (posMatch) {
      const parts = posMatch[1].trim().split(/\s+/).map(Number);
      if (parts.length >= 3) {
        pos[0] = parts[0]; pos[1] = parts[1]; pos[2] = parts[2];
      }
    }

    const parentName = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;
    joints.set(name, { name, parent: parentName, pos, children: [] });
    if (parentName && joints.has(parentName)) {
      joints.get(parentName)!.children.push(name);
    }

    if (!isSelfClosing) {
      parentStack.push(name);
    }
  }
  return joints;
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

export function isMeshCached(meshUuid: string): boolean {
  return fs.existsSync(meshCachePath(meshUuid));
}

function metaPath(meshUuid: string): string {
  return path.join(getCacheDir(), `${meshUuid}.meta`);
}

/** Read persisted rigged/jointNames info for a cached mesh.
 *  Falls back to scanning the GLB JSON chunk for "skins" if no .meta file exists. */
export function readMeshMeta(meshUuid: string): { isRigged: boolean; jointNames?: string[] } | undefined {
  // Fast path: .meta sidecar exists
  try {
    const data = JSON.parse(fs.readFileSync(metaPath(meshUuid), 'utf8'));
    return { isRigged: !!data.isRigged, jointNames: data.jointNames };
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
  isRigged: boolean;
  jointNames?: string[];
}

export async function ensureMeshCached(meshUuid: string, mesh: LLMesh): Promise<MeshConvertResult> {
  const cachePath = meshCachePath(meshUuid);
  const isRigged = !!(mesh.skin && mesh.skin.jointNames.length > 0);

  if (fs.existsSync(cachePath)) {
    // Persist meta if missing (backfill for meshes cached before meta was added)
    if (!fs.existsSync(metaPath(meshUuid)) && isRigged) {
      try { fs.writeFileSync(metaPath(meshUuid), JSON.stringify({ isRigged, jointNames: mesh.skin?.jointNames })); } catch { /* ignore */ }
    }
    return { cachePath, isRigged, jointNames: mesh.skin?.jointNames };
  }

  const glb = llMeshToGlb(mesh);
  if (!glb) throw new Error(`Failed to convert mesh ${meshUuid} to GLB`);

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, glb);
  // Persist rigged info alongside the GLB
  if (isRigged) {
    try { fs.writeFileSync(metaPath(meshUuid), JSON.stringify({ isRigged, jointNames: mesh.skin?.jointNames })); } catch { /* ignore */ }
  }
  return { cachePath, isRigged, jointNames: mesh.skin?.jointNames };
}

export function llMeshToGlb(mesh: LLMesh): Buffer | null {
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
  let bsm: number[] | null = null;
  if (mesh.skin?.bindShapeMatrix) {
    const raw = mesh.skin.bindShapeMatrix.all();
    const isId = raw[0] === 1 && raw[5] === 1 && raw[10] === 1 && raw[15] === 1 &&
      raw[1] === 0 && raw[2] === 0 && raw[3] === 0 && raw[4] === 0 &&
      raw[6] === 0 && raw[7] === 0 && raw[8] === 0 && raw[9] === 0 &&
      raw[11] === 0 && raw[12] === 0 && raw[13] === 0 && raw[14] === 0;
    if (!isId) bsm = raw;
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
        if (bsm) {
          // Transform normal by BSM upper-3x3, then re-normalize
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
  const skin = mesh.skin;
  const isRigged = skin && skin.jointNames.length > 0 &&
    submeshes!.some(s => s.weights && s.weights.length > 0);

  const nodes: any[] = [{ mesh: 0 }]; // node 0 = mesh node
  let skinObj: any = undefined;

  if (isRigged) {
    const skeleton = getSkeletonHierarchy();
    const jointNames = skin!.jointNames;

    // Collect all joints used by this mesh + ancestors up to root
    const usedJoints = new Set<string>(jointNames);
    for (const jn of jointNames) {
      let cur = jn;
      while (cur && skeleton.has(cur)) {
        usedJoints.add(cur);
        const parent = skeleton.get(cur)!.parent;
        if (!parent) break;
        cur = parent;
      }
    }

    // Build ordered list: topological order (parents before children)
    const orderedJoints: string[] = [];
    const visited = new Set<string>();
    function visit(name: string): void {
      if (visited.has(name) || !usedJoints.has(name)) return;
      const sj = skeleton.get(name);
      if (sj?.parent && usedJoints.has(sj.parent)) visit(sj.parent);
      visited.add(name);
      orderedJoints.push(name);
    }
    for (const jn of usedJoints) visit(jn);

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

    // Create glTF nodes for each joint
    let skeletonRootIdx = -1;
    for (let i = 0; i < orderedJoints.length; i++) {
      const jname = orderedJoints[i];
      const sj = skeleton.get(jname);
      const node: any = { name: jname };

      // Local position: SL (x,y,z) → Godot (x, z, -y)
      if (sj) {
        node.translation = [sj.pos[0], sj.pos[2], -sj.pos[1]];
      }

      // Children in the glTF node
      const childNodeIndices: number[] = [];
      if (sj) {
        for (const childName of sj.children) {
          if (jointNameToNodeIdx.has(childName)) {
            childNodeIndices.push(jointNameToNodeIdx.get(childName)!);
          }
        }
      }
      if (childNodeIndices.length > 0) {
        node.children = childNodeIndices;
      }

      nodes.push(node);

      // Track skeleton root (joint with no parent in our set)
      if (!sj?.parent || !usedJoints.has(sj.parent)) {
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
