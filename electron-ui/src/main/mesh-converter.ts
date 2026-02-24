/**
 * mesh-converter.ts — Converts LLMesh to GLB (binary glTF 2.0).
 * Hand-rolled GLB encoder, no npm dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { LLMesh } from '../../node-metaverse/dist/lib/classes/public/LLMesh';
import type { LLSubMesh } from '../../node-metaverse/dist/lib/classes/public/interfaces/LLSubMesh';

const LOD_PREFERENCE = ['high_lod', 'medium_lod', 'low_lod', 'lowest_lod'];

function getCacheDir(): string {
  const appRoot = app.getAppPath();
  return path.join(appRoot, '..', 'godot-viewer', 'cache', 'meshes');
}

export function meshCachePath(meshUuid: string): string {
  return path.join(getCacheDir(), `${meshUuid}.glb`);
}

export function isMeshCached(meshUuid: string): boolean {
  return fs.existsSync(meshCachePath(meshUuid));
}

export async function ensureMeshCached(meshUuid: string, mesh: LLMesh): Promise<string> {
  const cachePath = meshCachePath(meshUuid);
  if (fs.existsSync(cachePath)) return cachePath;

  const glb = llMeshToGlb(mesh);
  if (!glb) throw new Error(`Failed to convert mesh ${meshUuid} to GLB`);

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, glb);
  return cachePath;
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
    // SL (x,y,z) → Godot (x,z,-y)
    const posBuf = Buffer.alloc(vertCount * 12);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertCount; i++) {
      const p = sub.position[i];
      const gx = p.x;
      const gy = p.z;
      const gz = -p.y;
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
        nrmBuf.writeFloatLE(n.x, i * 12);
        nrmBuf.writeFloatLE(n.z, i * 12 + 4);
        nrmBuf.writeFloatLE(-n.y, i * 12 + 8);
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

  // Build glTF JSON
  const gltf = {
    asset: { version: '2.0', generator: 'PyroKitty' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };

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
