import * as THREE from 'three';

const SL_MAP_BASE = 'https://map.secondlife.com/map';
const TERRAIN_API = 'https://www.bonniebots.com/static-api/terrain';
const GRID_MIN = 0;
const GRID_MAX = 2048;
const MAX_CONCURRENT_LOADS = 12;
const TILE_RADIUS = 16;
const ZOOM = 1;
const TERRAIN_SEGMENTS = 64;
const HEIGHT_SCALE = 1 / 256; // SL meters → map units (1 unit = 1 region = 256m)

interface TileEntry {
  mesh: THREE.Mesh;
  texture: THREE.Texture | null;
  terrainApplied: boolean;
}

export class TileManager {
  private tiles = new Map<string, TileEntry>();
  private scene: THREE.Scene;
  private loader: THREE.TextureLoader;
  private loadQueue: string[] = [];
  private terrainQueue: string[] = [];
  private activeLoads = 0;
  private activeTerrainLoads = 0;
  private lastUpdateCol = -1;
  private lastUpdateRow = -1;
  // Regions known to have no terrain data — skip future fetches
  private noTerrainSet = new Set<string>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.loader = new THREE.TextureLoader();
    this.loader.crossOrigin = 'anonymous';
  }

  update(cameraTarget: THREE.Vector3): void {
    const gridX = cameraTarget.x;
    const gridY = -cameraTarget.z;

    const tileCol = Math.floor(gridX);
    const tileRow = Math.floor(gridY);

    if (tileCol === this.lastUpdateCol && tileRow === this.lastUpdateRow) {
      return;
    }
    this.lastUpdateCol = tileCol;
    this.lastUpdateRow = tileRow;

    const needed = new Set<string>();

    for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
      for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy++) {
        const slX = tileCol + dx;
        const slY = tileRow + dy;

        if (slX < GRID_MIN || slY < GRID_MIN || slX >= GRID_MAX || slY >= GRID_MAX) continue;

        const key = `${slX}-${slY}`;
        needed.add(key);

        if (!this.tiles.has(key)) {
          this.createTile(key, slX, slY);
        }
      }
    }

    for (const [key, entry] of this.tiles) {
      if (!needed.has(key)) {
        this.disposeEntry(entry);
        this.tiles.delete(key);
      }
    }

    this.processQueue();
    this.processTerrainQueue();
  }

  private createTile(key: string, slX: number, slY: number): void {
    const geometry = new THREE.PlaneGeometry(1, 1, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
      color: 0x1a3a5c,
      roughness: 1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.position.set(slX + 0.5, 0, -(slY + 0.5));
    mesh.userData = { slX, slY };

    this.scene.add(mesh);
    const entry: TileEntry = { mesh, texture: null, terrainApplied: false };
    this.tiles.set(key, entry);

    this.loadQueue.push(key);
    if (!this.noTerrainSet.has(key)) {
      this.terrainQueue.push(key);
    }
  }

  /** Fetch raw Float32LE terrain binary by grid coordinates */
  private async loadTerrain(key: string): Promise<void> {
    const entry = this.tiles.get(key);
    if (!entry || entry.terrainApplied) return;

    const { slX, slY } = entry.mesh.userData;

    try {
      const resp = await fetch(`${TERRAIN_API}/${slX}-${slY}.bin`);
      if (!resp.ok) {
        this.noTerrainSet.add(key);
        return;
      }

      const buf = await resp.arrayBuffer();
      if (buf.byteLength !== 256 * 256 * 4) {
        this.noTerrainSet.add(key);
        return;
      }

      if (!this.tiles.has(key)) return;

      const heights = new Float32Array(buf);
      const geometry = entry.mesh.geometry as THREE.PlaneGeometry;
      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);

        const u = vx + 0.5; // 0..1
        const v = -vz + 0.5; // 0..1
        const hx = Math.min(255, Math.floor(u * 256));
        const hy = Math.min(255, Math.floor(v * 256));

        const height = heights[hy * 256 + hx];
        posAttr.setY(i, height * HEIGHT_SCALE);
      }

      posAttr.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      entry.terrainApplied = true;
    } catch {
      this.noTerrainSet.add(key);
    }
  }

  private processTerrainQueue(): void {
    while (this.terrainQueue.length > 0 && this.activeTerrainLoads < 4) {
      const key = this.terrainQueue.shift()!;
      if (!this.tiles.has(key)) continue;

      this.activeTerrainLoads++;
      this.loadTerrain(key).finally(() => {
        this.activeTerrainLoads--;
        this.processTerrainQueue();
      });
    }
  }

  private processQueue(): void {
    while (this.loadQueue.length > 0 && this.activeLoads < MAX_CONCURRENT_LOADS) {
      const key = this.loadQueue.shift()!;
      const entry = this.tiles.get(key);
      if (!entry) continue;

      this.activeLoads++;
      const { slX, slY } = entry.mesh.userData;
      const url = `${SL_MAP_BASE}-${ZOOM}-${slX}-${slY}-objects.jpg`;

      this.loader.load(
        url,
        (texture) => {
          this.activeLoads--;
          if (!this.tiles.has(key)) {
            texture.dispose();
            this.processQueue();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          const mat = entry.mesh.material as THREE.MeshStandardMaterial;
          mat.map = texture;
          mat.color.setHex(0xffffff);
          mat.needsUpdate = true;
          entry.texture = texture;
          this.processQueue();
        },
        undefined,
        () => {
          this.activeLoads--;
          this.processQueue();
        },
      );
    }
  }

  private disposeEntry(entry: TileEntry): void {
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    const mat = entry.mesh.material as THREE.MeshStandardMaterial;
    if (entry.texture) {
      entry.texture.dispose();
    }
    mat.dispose();
  }

  raycast(raycaster: THREE.Raycaster): { gridX: number; gridY: number; localX: number; localY: number } | null {
    const meshes = Array.from(this.tiles.values()).map(e => e.mesh);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length === 0) return null;

    const point = hits[0].point;
    const gridXf = point.x;
    const gridYf = -point.z;

    return {
      gridX: Math.floor(gridXf),
      gridY: Math.floor(gridYf),
      localX: Math.floor((gridXf - Math.floor(gridXf)) * 256),
      localY: Math.floor((gridYf - Math.floor(gridYf)) * 256),
    };
  }

  dispose(): void {
    for (const [, entry] of this.tiles) {
      this.disposeEntry(entry);
    }
    this.tiles.clear();
    this.loadQueue.length = 0;
    this.terrainQueue.length = 0;
  }
}
