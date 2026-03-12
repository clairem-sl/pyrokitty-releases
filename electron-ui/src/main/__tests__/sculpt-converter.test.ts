import { describe, it, expect } from 'vitest';
import { decodeSculptMap, buildSculptMesh, sculptMeshToGlb } from '../sculpt-converter';

describe('decodeSculptMap', () => {
  it('decodes a 2x2 RGB pixel grid to normalized Vec3', () => {
    // 4 pixels, RGB channels: (0,0,0), (255,255,255), (128,0,255), (0,128,0)
    const pixels = Buffer.from([
      0, 0, 0,
      255, 255, 255,
      128, 0, 255,
      0, 128, 0,
    ]);

    const grid = decodeSculptMap(pixels, 2, 2, 3);
    expect(grid.length).toBe(2);
    expect(grid[0].length).toBe(2);

    // (0,0,0) -> (-0.5, -0.5, -0.5)
    expect(grid[0][0]).toEqual({ x: -0.5, y: -0.5, z: -0.5 });
    // (255,255,255) -> (0.5, 0.5, 0.5)
    expect(grid[0][1]).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
    // (128,0,255) -> (128/255 - 0.5, -0.5, 0.5)
    expect(grid[1][0].x).toBeCloseTo(128 / 255 - 0.5, 10);
    expect(grid[1][0].y).toBeCloseTo(-0.5, 10);
    expect(grid[1][0].z).toBeCloseTo(0.5, 10);
  });

  it('handles RGBA (4 channels) by using only RGB', () => {
    const pixels = Buffer.from([
      255, 0, 0, 255,   // red pixel with full alpha
      0, 255, 0, 128,   // green pixel with half alpha
    ]);
    const grid = decodeSculptMap(pixels, 2, 1, 4);
    expect(grid[0][0]).toEqual({ x: 0.5, y: -0.5, z: -0.5 });
    expect(grid[0][1]).toEqual({ x: -0.5, y: 0.5, z: -0.5 });
  });

  it('returns empty grid for 0-height input', () => {
    const grid = decodeSculptMap(Buffer.alloc(0), 4, 0, 3);
    expect(grid).toEqual([]);
  });
});

describe('buildSculptMesh', () => {
  function make2x2Grid() {
    return [
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }],
    ];
  }

  it('produces correct vertex count for 2x2 grid', () => {
    const mesh = buildSculptMesh(make2x2Grid(), 0);
    // 4 vertices -> 12 position components
    expect(mesh.positions.length).toBe(12);
    // 4 vertices -> 8 UV components
    expect(mesh.uvs.length).toBe(8);
    // 2x2 grid -> 1x1 quads -> 2 triangles -> 6 indices
    expect(mesh.indices.length).toBe(6);
    // normals match positions count
    expect(mesh.normals.length).toBe(12);
  });

  it('UV corners are [0,0], [1,0], [0,1], [1,1]', () => {
    const mesh = buildSculptMesh(make2x2Grid(), 0);
    const uvPairs = [];
    for (let i = 0; i < mesh.uvs.length; i += 2) {
      uvPairs.push([mesh.uvs[i], mesh.uvs[i + 1]]);
    }
    expect(uvPairs).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  });

  it('normals are unit length', () => {
    const mesh = buildSculptMesh(make2x2Grid(), 0);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const len = Math.sqrt(mesh.normals[i] ** 2 + mesh.normals[i + 1] ** 2 + mesh.normals[i + 2] ** 2);
      expect(len).toBeCloseTo(1.0, 5);
    }
  });

  it('inverted winding reverses triangle order', () => {
    const normal = buildSculptMesh(make2x2Grid(), 0);
    const inverted = buildSculptMesh(make2x2Grid(), 0x40); // SculptType.Invert = 0x40

    // First triangle should have swapped vertex order
    expect(normal.indices.slice(0, 3)).not.toEqual(inverted.indices.slice(0, 3));
  });

  it('mirror flag negates X positions', () => {
    const normal = buildSculptMesh(make2x2Grid(), 0);
    const mirrored = buildSculptMesh(make2x2Grid(), 0x80); // SculptType.Mirror = 0x80

    // X components (every 3rd starting at 0) should be negated
    for (let i = 0; i < normal.positions.length; i += 3) {
      expect(mirrored.positions[i]).toBeCloseTo(-normal.positions[i], 10);
    }
  });

  it('scales to larger grids', () => {
    const rows = 8, cols = 8;
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({ x: c / (cols - 1) - 0.5, y: r / (rows - 1) - 0.5, z: 0 });
      }
      grid.push(row);
    }
    const mesh = buildSculptMesh(grid, 0);
    expect(mesh.positions.length).toBe(rows * cols * 3);
    expect(mesh.indices.length).toBe((rows - 1) * (cols - 1) * 6);
  });
});

describe('sculptMeshToGlb', () => {
  it('produces valid GLB binary header', () => {
    const mesh = buildSculptMesh(
      [
        [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
        [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }],
      ],
      0,
    );
    const glb = sculptMeshToGlb(mesh);

    // GLB magic: "glTF"
    expect(glb.readUInt32LE(0)).toBe(0x46546C67);
    // Version 2
    expect(glb.readUInt32LE(4)).toBe(2);
    // Total length matches buffer size
    expect(glb.readUInt32LE(8)).toBe(glb.length);
  });

  it('contains JSON and BIN chunks', () => {
    const mesh = buildSculptMesh(
      [
        [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
        [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }],
      ],
      0,
    );
    const glb = sculptMeshToGlb(mesh);

    // First chunk type: JSON (0x4E4F534A)
    expect(glb.readUInt32LE(16)).toBe(0x4E4F534A);

    // Parse JSON chunk to verify structure
    const jsonLen = glb.readUInt32LE(12);
    const jsonStr = glb.subarray(20, 20 + jsonLen).toString('utf8').trim();
    const gltf = JSON.parse(jsonStr);

    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.meshes).toHaveLength(1);
    expect(gltf.accessors).toHaveLength(4); // position, normal, uv, indices
    expect(gltf.bufferViews).toHaveLength(4);

    // Second chunk type: BIN (0x004E4942)
    const binChunkOffset = 20 + jsonLen;
    expect(glb.readUInt32LE(binChunkOffset + 4)).toBe(0x004E4942);
  });
});
