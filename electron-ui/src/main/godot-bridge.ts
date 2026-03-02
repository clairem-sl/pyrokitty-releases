/**
 * GodotBridge — Spawns a Godot 4 sidecar and streams object/avatar data
 * from node-metaverse over WebSocket.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { Bot } from '../../node-metaverse/dist/lib';
import { ControlFlags, SculptType } from '../../node-metaverse/dist/lib';
import type { Subscription } from 'rxjs';
import { MeshFetchQueue } from './mesh-fetch-queue';
import { TextureFetchQueue } from './texture-fetch-queue';
import { SculptFetchQueue } from './sculpt-fetch-queue';
import { sculptMeshId } from './sculpt-converter';
import { MaterialFetchQueue, MaterialOverrideData, TextureTransform } from './material-fetch-queue';

const GODOT_WS_PORT_BASE = 9100;
let nextPort = GODOT_WS_PORT_BASE;

function getGodotDir(): string {
  const appRoot = app.getAppPath();
  const versionFile = app.isPackaged
    ? path.join(process.resourcesPath, 'godot-viewer', 'godot-version.txt')
    : path.join(appRoot, '..', 'godot-viewer', 'godot-version.txt');
  return fs.readFileSync(versionFile, 'utf8').trim();
}

function getGodotPath(): string {
  const dir = getGodotDir();
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'godot-viewer', dir, `${dir}.exe`);
  } else {
    const appRoot = app.getAppPath();
    return path.join(appRoot, '..', 'godot-viewer', dir, `${dir}.exe`);
  }
}

function getProjectPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'godot-viewer');
  } else {
    const appRoot = app.getAppPath();
    return path.join(appRoot, '..', 'godot-viewer');
  }
}

function getCacheDirBase(): string {
  return path.join(app.getPath('userData'), 'asset-cache');
}

export class GodotBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private port: number;
  private bot: Bot;
  private subscriptions: Subscription[] = [];
  private trackedObjects = new Set<number>(); // localIds we've sent to Godot
  private trackedAvatars = new Set<string>(); // avatar UUIDs we've sent
  private updateBuffer: Map<number, any> = new Map(); // coalesced terse updates
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private avatarUpdateBuffer: Map<string, any> = new Map(); // coalesced avatar terse updates
  private avatarUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private killSweepTimer: ReturnType<typeof setInterval> | null = null;
  private meshFetchQueue: MeshFetchQueue | null = null;
  private textureFetchQueue: TextureFetchQueue | null = null;
  private sculptFetchQueue: SculptFetchQueue | null = null;
  private materialFetchQueue: MaterialFetchQueue | null = null;
  private materialToFaces = new Map<string, { localId: number; faceIndex: number; face: any; inlineOverride: any }[]>();
  private textureUpdateSubs = new Map<number, Subscription>(); // per-object onTextureUpdate subscriptions
  private connected = false;
  private _dbgMoving = false;           // for movement freeze diagnostics
  private _dbgAgentNullAt = 0;         // timestamp of first agent-null drop in current run
  private assetReadyBuffer: object[] = [];
  private assetReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGodotStats: any = null;
  private pbrFaceCount = 0; // count of faces with PBR overrides
  private deferredTextures = new Map<number, any>(); // localId → obj reference (for re-fetching textures later)
  private readonly TEXTURE_FETCH_RANGE = 160; // meters — 128m cull + 32m buffer for large prims

  private vrMode: boolean;

  constructor(bot: Bot, options: { vrMode?: boolean } = {}) {
    super();
    this.bot = bot;
    this.port = nextPort++;
    this.vrMode = options.vrMode ?? false;
  }

  /** Returns mesh asset UUID if obj is a mesh, else undefined */
  private getMeshId(obj: any): string | undefined {
    const md = obj.extraParams?.meshData;
    if (md && md.type === SculptType.Mesh) {
      return md.meshData?.toString();
    }
    return undefined;
  }

  /** Returns sculpt texture UUID and type flags if obj is a sculpted prim, else undefined */
  private getSculptInfo(obj: any): { textureUuid: string; sculptType: number } | undefined {
    const sd = obj.extraParams?.sculptData;
    if (!sd) return undefined;
    const baseType = sd.type & 0x07;
    if (baseType < SculptType.Sphere || baseType > SculptType.Cylinder) return undefined;
    const textureUuid = sd.texture?.toString();
    if (!textureUuid || textureUuid === '00000000-0000-0000-0000-000000000000') return undefined;
    return { textureUuid, sculptType: sd.type };
  }

  /** Extract per-face texture info from a GameObject (up to 8 faces) */
  private getTextureInfo(obj: any): {
    faces: {
      index: number; textureId: string; color: number[]; fullBright: boolean; doubleSided: boolean;
      alphaMode: number; alphaCutoff: number; mappingType?: number;
      repeatU: number; repeatV: number; offsetU: number; offsetV: number; rotation: number;
      isPBR?: boolean; normalTextureId?: string; ormTextureId?: string; emissiveTextureId?: string;
      metallicFactor?: number; roughnessFactor?: number; emissiveFactor?: number[];
      pbrBaseColor?: number[];
    }[];
    textureIds: string[]; // unique texture IDs for fetch queue
  } | undefined {
    try {
      const te = obj.TextureEntry;
      if (!te || !te.defaultTexture) return undefined;

      const ZERO = '00000000-0000-0000-0000-000000000000';

      // GLTF material overrides per face — extract all PBR data
      const gltfDS = new Map<number, boolean>();
      const gltfAlpha = new Map<number, { mode: number; cutoff: number }>();
      const gltfPBR = new Map<number, {
        baseColorTextureId?: string;
        normalTextureId?: string;
        ormTextureId?: string;
        emissiveTextureId?: string;
        baseColor?: number[];
        metallicFactor?: number;
        roughnessFactor?: number;
        emissiveFactor?: number[];
      }>();
      const overrides = te.gltfMaterialOverrides;
      if (overrides && overrides.size > 0) {
        for (const [idx, override] of overrides) {
          if (override.doubleSided !== undefined) {
            gltfDS.set(idx, override.doubleSided);
          }
          if (override.alphaMode !== undefined || override.alphaCutoff !== undefined) {
            gltfAlpha.set(idx, {
              mode: override.alphaMode ?? -1,
              cutoff: override.alphaCutoff ?? 0.5,
            });
          }
          // Extract PBR texture UUIDs and factors
          const pbr: any = {};
          let hasPBR = false;
          if (override.textures && Array.isArray(override.textures)) {
            const texIds = override.textures;
            const t0 = texIds[0]?.toString();
            const t1 = texIds[1]?.toString();
            const t2 = texIds[2]?.toString();
            const t3 = texIds[3]?.toString();
            if (t0 && t0 !== ZERO) { pbr.baseColorTextureId = t0; hasPBR = true; }
            if (t1 && t1 !== ZERO) { pbr.normalTextureId = t1; hasPBR = true; }
            if (t2 && t2 !== ZERO) { pbr.ormTextureId = t2; hasPBR = true; }
            if (t3 && t3 !== ZERO) { pbr.emissiveTextureId = t3; hasPBR = true; }
          }
          if (override.baseColor) { pbr.baseColor = override.baseColor; hasPBR = true; }
          if (override.metallicFactor !== undefined) { pbr.metallicFactor = override.metallicFactor; hasPBR = true; }
          if (override.roughnessFactor !== undefined) { pbr.roughnessFactor = override.roughnessFactor; hasPBR = true; }
          if (override.emissiveFactor) { pbr.emissiveFactor = override.emissiveFactor; hasPBR = true; }
          if (hasPBR) {
            gltfPBR.set(idx, pbr);
          }
        }
      }
      // Fallback doubleSided from any face
      let defaultDS: boolean | undefined = false;
      if (gltfDS.size > 0) defaultDS = gltfDS.values().next().value;

      const faces: any[] = [];
      const textureIdSet = new Set<string>();

      // Resolve all 8 potential faces; each inherits from defaultTexture for unset fields
      for (let i = 0; i < 8; i++) {
        const face = te.faces[i] ?? te.defaultTexture;
        const pbr = gltfPBR.get(i);

        // PBR base color texture overrides legacy textureId when present
        let textureId: string;
        if (pbr?.baseColorTextureId) {
          textureId = pbr.baseColorTextureId;
        } else {
          textureId = face.textureID?.toString() || '';
        }
        if (!textureId || textureId === ZERO) continue;

        const rgba = face.rgba;
        const color = rgba
          ? [rgba.getRed(), rgba.getGreen(), rgba.getBlue(), rgba.getAlpha()]
          : [1, 1, 1, 1];

        const faceData: any = {
          index: i,
          textureId,
          color,
          fullBright: (face.material & 0x20) !== 0,
          doubleSided: gltfDS.get(i) ?? defaultDS,
          alphaMode: gltfAlpha.get(i)?.mode ?? -1, // -1=default, 0=opaque, 1=blend, 2=mask
          alphaCutoff: gltfAlpha.get(i)?.cutoff ?? 0.5,
          repeatU: face.repeatU ?? 1,
          repeatV: face.repeatV ?? 1,
          offsetU: face.offsetU ?? 0,
          offsetV: face.offsetV ?? 0,
          rotation: face.rotation ?? 0,
          ...(face.mappingType ? { mappingType: face.mappingType } : {}),
        };
        textureIdSet.add(textureId);

        // Add PBR fields when present
        if (pbr) {
          faceData.isPBR = true;
          this.pbrFaceCount++;
          if (pbr.normalTextureId) {
            faceData.normalTextureId = pbr.normalTextureId;
            textureIdSet.add(pbr.normalTextureId);
          }
          if (pbr.ormTextureId) {
            faceData.ormTextureId = pbr.ormTextureId;
            textureIdSet.add(pbr.ormTextureId);
          }
          if (pbr.emissiveTextureId) {
            faceData.emissiveTextureId = pbr.emissiveTextureId;
            textureIdSet.add(pbr.emissiveTextureId);
          }
          if (pbr.metallicFactor !== undefined) faceData.metallicFactor = pbr.metallicFactor;
          if (pbr.roughnessFactor !== undefined) faceData.roughnessFactor = pbr.roughnessFactor;
          if (pbr.emissiveFactor) faceData.emissiveFactor = pbr.emissiveFactor;
          if (pbr.baseColor) faceData.pbrBaseColor = pbr.baseColor;
        }

        faces.push(faceData);
      }

      if (faces.length === 0) return undefined;
      return { faces, textureIds: Array.from(textureIdSet) };
    } catch {
      return undefined;
    }
  }

  async start(): Promise<void> {
    // Spawn Godot process
    const godotPath = getGodotPath();
    const projectPath = getProjectPath();

    // Ensure cache directories exist (writable location outside asar)
    const cacheBase = getCacheDirBase();
    fs.mkdirSync(path.join(cacheBase, 'meshes'), { recursive: true });
    fs.mkdirSync(path.join(cacheBase, 'textures'), { recursive: true });
    fs.mkdirSync(path.join(cacheBase, 'terrain'), { recursive: true });

    // VR requires openxr/enabled=true but that setting causes errors in non-VR mode.
    // override.vr.cfg holds the VR-only settings; copy it to override.cfg for VR
    // launches, delete it otherwise. override.cfg is .gitignored.
    const overridePath = path.join(projectPath, 'override.cfg');
    const overrideVrPath = path.join(projectPath, 'override.vr.cfg');
    if (this.vrMode) {
      fs.copyFileSync(overrideVrPath, overridePath);
      console.log('[GodotBridge] Copied override.vr.cfg → override.cfg (VR mode)');
    } else {
      try { fs.unlinkSync(overridePath); } catch { /* not present, fine */ }
    }

    console.log(`[GodotBridge] Spawning Godot on port ${this.port} — ${godotPath}`);

    const userArgs = [`--ws-port=${this.port}`];
    if (this.vrMode) userArgs.push('--vr');

    this.process = spawn(godotPath, [
      '--path', projectPath,
      '--', ...userArgs,
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data) => {
      console.log(`[Godot] ${data.toString().trim()}`);
    });

    this.process.stderr?.on('data', (data) => {
      console.error(`[Godot] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      console.log(`[GodotBridge] Godot exited with code ${code}`);
      this.cleanup();
      this.emit('exit');
    });

    this.process.on('error', (err) => {
      console.error(`[GodotBridge] Godot spawn error:`, err);
      this.emit('exit');
    });

    // Connect WebSocket with retries (Godot needs time to start)
    await this.connectWebSocket();
  }

  private async connectWebSocket(): Promise<void> {
    const maxAttempts = 15;
    const delayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!this.process || this.process.exitCode !== null) {
        throw new Error('Godot process exited before WebSocket connected');
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Connection timeout'));
          }, 3000);

          ws.on('open', () => {
            clearTimeout(timeout);
            this.ws = ws;
            this.connected = true;
            console.log(`[GodotBridge] WebSocket connected (attempt ${attempt})`);

            ws.on('message', (data) => {
              try {
                const msg = JSON.parse(data.toString());
                switch (msg.type) {
                  case 'ready':
                    break;
                  case 'input_move':
                    this.handleInputMove(msg);
                    break;
                  case 'pipeline_stats':
                    this.lastGodotStats = msg;
                    break;
                }
              } catch { /* ignore bad messages */ }
            });

            ws.on('close', () => {
              console.log('[GodotBridge] WebSocket closed');
              this.connected = false;
              // TODO: auto-reconnect — Godot resets ws_peer=null on close and is ready
              // to accept a new connection immediately, but we never re-call connectWebSocket().
              // Movement is silently dead until the process is restarted.
            });

            resolve();
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            ws.close();
            reject(err);
          });
        });
        break; // Connected successfully
      } catch {
        if (attempt === maxAttempts) {
          throw new Error(`Failed to connect to Godot after ${maxAttempts} attempts`);
        }
        console.log(`[GodotBridge] Connect attempt ${attempt}/${maxAttempts} failed, retrying...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // Tell Godot which avatar is "self" so camera can follow
    const selfId = this.bot.agent?.agentID?.toString?.() || '';
    if (selfId) {
      this.send({ type: 'self_id', id: selfId });
    }

    // Init mesh fetch queue
    this.meshFetchQueue = new MeshFetchQueue(this.bot, (meshUuid, cachePath) => {
      const fwdPath = cachePath.replace(/\\/g, '/');
      this.queueAssetReady({ type: 'mesh_ready', meshId: meshUuid, path: fwdPath });
    });

    // Init texture fetch queue
    this.textureFetchQueue = new TextureFetchQueue(this.bot, (textureUuid, cachePath) => {
      const fwdPath = cachePath.replace(/\\/g, '/');
      this.queueAssetReady({ type: 'texture_ready', textureId: textureUuid, path: fwdPath });
    });

    // Init sculpt fetch queue (sculpt textures → GLB meshes)
    this.sculptFetchQueue = new SculptFetchQueue(this.bot, (meshId, cachePath) => {
      const fwdPath = cachePath.replace(/\\/g, '/');
      this.queueAssetReady({ type: 'mesh_ready', meshId, path: fwdPath });
    });

    // Init material fetch queue (PBR material assets → texture UUIDs + factors)
    this.materialFetchQueue = new MaterialFetchQueue(this.bot, (materialUuid, data) => {
      this.handleMaterialReady(materialUuid, data);
    });

    // Send initial snapshot and subscribe to events
    this.sendInitialSnapshot();
    this.subscribeToEvents();

    // Send terrain + environment async (don't block object streaming)
    this.sendTerrain().catch(err => {
      console.error('[GodotBridge] Error sending terrain:', err);
    });
  }

  private send(msg: object): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Buffer asset ready messages and flush in batches to avoid freezing Godot */
  private queueAssetReady(msg: object): void {
    this.assetReadyBuffer.push(msg);
    if (!this.assetReadyTimer) {
      this.assetReadyTimer = setTimeout(() => this.flushAssetReady(), 50);
    }
  }

  private flushAssetReady(): void {
    this.assetReadyTimer = null;
    if (this.assetReadyBuffer.length === 0) return;

    // Send a batch per tick so Godot can process between frames
    const BATCH_SIZE = 200;
    const batch = this.assetReadyBuffer.splice(0, BATCH_SIZE);
    let meshCount = 0, texCount = 0;
    for (const msg of batch) {
      this.send(msg);
      if ((msg as any).type === 'mesh_ready') meshCount++;
      else texCount++;
    }

    // Schedule next batch if more remain
    if (this.assetReadyBuffer.length > 0) {
      this.assetReadyTimer = setTimeout(() => this.flushAssetReady(), 50);
    }
  }

  /** Get the bot avatar's current global position, or null if unavailable */
  private getBotPosition(): { x: number; y: number; z: number; distance(other: any): number } | null {
    const agentId = this.bot.agent.agentID?.toString();
    const agents = this.bot.currentRegion?.agents;
    if (!agentId || !agents) return null;
    const me = agents.get(agentId);
    return me?.position ?? null;
  }

  /** Get global position for any object (resolves child local→global via parent) */
  private getGlobalPosition(obj: any): { x: number; y: number; z: number; distance(other: any): number } | null {
    const pos = obj.Position;
    if (!pos) return null;
    // Root prims (ParentID === 0) already have global coords
    if (!obj.ParentID || obj.ParentID === 0) return pos;
    // Child prim — Position is local offset from parent, add to parent's global position
    try {
      const parent = this.bot.currentRegion.objects.getObjectByLocalID(obj.ParentID);
      const pp = parent?.Position;
      if (pp) {
        const gx = pp.x + pos.x;
        const gy = pp.y + pos.y;
        const gz = pp.z + pos.z;
        return {
          x: gx, y: gy, z: gz,
          distance(other: any) {
            const dx = gx - other.x, dy = gy - other.y, dz = gz - other.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
          },
        };
      }
    } catch { /* parent not found */ }
    return null; // can't determine global position — skip distance check
  }

  /** Send a single object to Godot with optional parentId */
  private sendObject(obj: any, parentLocalId: number): void {
    const pos = obj.Position;
    if (!pos) return;

    const rot = obj.Rotation;
    const scl = obj.Scale;
    const meshId = this.getMeshId(obj);
    const sculptInfo = this.getSculptInfo(obj);
    const sculpt_meshId = sculptInfo ? sculptMeshId(sculptInfo.textureUuid, sculptInfo.sculptType) : undefined;
    const texInfo = this.getTextureInfo(obj);

    // Send prim shape params for non-mesh/non-sculpt objects so Godot can
    // generate procedural geometry instead of a box placeholder.
    const shapeParams = (!meshId && !sculptInfo) ? {
      pathCurve: obj.PathCurve ?? 16,
      profileCurve: obj.ProfileCurve ?? 1,
      pathBegin: obj.PathBegin ?? 0,
      pathEnd: obj.PathEnd ?? 1,
      pathScaleX: obj.PathScaleX ?? 1,
      pathScaleY: obj.PathScaleY ?? 1,
      pathShearX: obj.PathShearX ?? 0,
      pathShearY: obj.PathShearY ?? 0,
      pathTwist: obj.PathTwist ?? 0,
      pathTwistBegin: obj.PathTwistBegin ?? 0,
      pathRadiusOffset: obj.PathRadiusOffset ?? 0,
      pathTaperX: obj.PathTaperX ?? 0,
      pathTaperY: obj.PathTaperY ?? 0,
      pathRevolutions: obj.PathRevolutions ?? 1,
      pathSkew: obj.PathSkew ?? 0,
      profileBegin: obj.ProfileBegin ?? 0,
      profileEnd: obj.ProfileEnd ?? 1,
      profileHollow: obj.ProfileHollow ?? 0,
    } : undefined;


    this.send({
      type: 'object_create',
      localId: obj.ID,
      uuid: obj.FullID?.toString() || '',
      parentId: parentLocalId,
      position: [pos.x, pos.y, pos.z],
      rotation: rot ? [rot.x, rot.y, rot.z, rot.w] : [0, 0, 0, 1],
      scale: scl ? [scl.x, scl.y, scl.z] : [0.5, 0.5, 0.5],
      ...(meshId ? { meshId } : sculpt_meshId ? { meshId: sculpt_meshId } : {}),
      ...(shapeParams ? { shape: shapeParams } : {}),
      ...(texInfo ? { faces: texInfo.faces } : {}),
    });
    this.trackedObjects.add(obj.ID);

    // Subscribe to live texture changes for this object
    if (obj.onTextureUpdate) {
      const texSub = obj.onTextureUpdate.subscribe(() => this.handleObjectTextureUpdate(obj));
      this.textureUpdateSubs.set(obj.ID, texSub);
    }

    if (meshId && this.meshFetchQueue) {
      this.meshFetchQueue.request(meshId, obj.ID);
    }
    if (sculptInfo && this.sculptFetchQueue) {
      this.sculptFetchQueue.request(sculptInfo.textureUuid, sculptInfo.sculptType, obj.ID);
    }
    // Distance gate: skip texture fetches for objects beyond render range
    let skipTextures = false;
    try {
      const botPos = this.getBotPosition();
      if (botPos) {
        const globalPos = this.getGlobalPosition(obj);
        if (globalPos) {
          const dist = globalPos.distance(botPos);
          if (dist > this.TEXTURE_FETCH_RANGE) {
            skipTextures = true;
            this.deferredTextures.set(obj.ID, obj);
          }
        }
      }
    } catch { /* bot may not be fully connected yet — fetch textures anyway */ }

    if (!skipTextures) {
      this.fetchTexturesForObject(obj, texInfo);
    }
  }

  /** Fetch legacy + PBR textures and material assets for an object */
  private fetchTexturesForObject(obj: any, texInfo?: ReturnType<typeof this.getTextureInfo>): void {
    // Collect face indices covered by renderMaterialData — skip legacy textures for these
    const rmd = obj.extraParams?.renderMaterialData;
    const materialFaceIndices = new Set<number>();
    if (rmd && rmd.params && rmd.params.length > 0) {
      for (const param of rmd.params) {
        const matUuid = param.textureUUID?.toString();
        if (matUuid && matUuid !== '00000000-0000-0000-0000-000000000000') {
          materialFaceIndices.add(param.textureIndex);
        }
      }
    }

    if (texInfo && this.textureFetchQueue) {
      // Only queue legacy textures for faces NOT covered by material assets
      for (const face of texInfo.faces) {
        if (materialFaceIndices.has(face.index)) continue;
        if (face.textureId) {
          this.textureFetchQueue.request(face.textureId, obj.ID);
        }
        // Also queue PBR textures from inline overrides (not from renderMaterialData)
        if (face.normalTextureId) this.textureFetchQueue.request(face.normalTextureId, obj.ID);
        if (face.ormTextureId) this.textureFetchQueue.request(face.ormTextureId, obj.ID);
        if (face.emissiveTextureId) this.textureFetchQueue.request(face.emissiveTextureId, obj.ID);
      }
    }

    // Queue material asset fetches for PBR faces via renderMaterialData
    if (materialFaceIndices.size > 0 && this.materialFetchQueue) {
      const te = obj.TextureEntry;
      const overrides = te?.gltfMaterialOverrides;
      for (const param of rmd!.params) {
        const matUuid = param.textureUUID?.toString();
        if (!matUuid || matUuid === '00000000-0000-0000-0000-000000000000') continue;
        const faceIndex = param.textureIndex;

        // Get legacy face data for this face (used as fallback color/UV)
        const face = te?.faces?.[faceIndex] ?? te?.defaultTexture;

        // Get inline gltfMaterialOverride for this face (layered on top of material asset)
        const inlineOverride = overrides?.get(faceIndex) ?? null;

        // Record which faces need this material
        let list = this.materialToFaces.get(matUuid);
        if (!list) {
          list = [];
          this.materialToFaces.set(matUuid, list);
        }
        list.push({ localId: obj.ID, faceIndex, face, inlineOverride });

        this.materialFetchQueue.request(matUuid);
      }
    }
  }

  /** Handle a material asset being fetched and parsed — send face updates to Godot */
  private handleMaterialReady(materialUuid: string, data: MaterialOverrideData): void {
    const entries = this.materialToFaces.get(materialUuid);
    if (!entries || entries.length === 0) return;

    // Group face updates by localId so we send one message per object
    const byObject = new Map<number, any[]>();
    const ZERO = '00000000-0000-0000-0000-000000000000';

    for (const { localId, faceIndex, face, inlineOverride } of entries) {
      if (!this.trackedObjects.has(localId)) continue;

      // Layer: material asset (base) → inline gltfMaterialOverride (on top)
      // Start with material asset data, then override with inline fields
      let baseColorTextureId = data.baseColorTextureId;
      let normalTextureId = data.normalTextureId;
      let metallicFactor = data.metallicFactor;
      let roughnessFactor = data.roughnessFactor;
      let emissiveFactor = data.emissiveFactor;
      let baseColor = data.baseColor;
      let alphaMode = data.alphaMode;
      let alphaCutoff = data.alphaCutoff;
      let doubleSided = data.doubleSided;

      // Texture transforms: material asset base, then inline override on top
      let baseColorTransform: TextureTransform | null = data.textureTransforms?.[0] ?? null;

      if (inlineOverride) {
        // Inline override replaces specific fields from the material asset
        if (inlineOverride.textures && Array.isArray(inlineOverride.textures)) {
          const t0 = inlineOverride.textures[0]?.toString();
          const t1 = inlineOverride.textures[1]?.toString();
          if (t0 && t0 !== ZERO) baseColorTextureId = t0;
          if (t1 && t1 !== ZERO) normalTextureId = t1;
        }
        if (inlineOverride.baseColor) baseColor = inlineOverride.baseColor;
        if (inlineOverride.metallicFactor !== undefined) metallicFactor = inlineOverride.metallicFactor;
        if (inlineOverride.roughnessFactor !== undefined) roughnessFactor = inlineOverride.roughnessFactor;
        if (inlineOverride.emissiveFactor) emissiveFactor = inlineOverride.emissiveFactor;
        if (inlineOverride.alphaMode !== undefined) alphaMode = inlineOverride.alphaMode;
        if (inlineOverride.alphaCutoff !== undefined) alphaCutoff = inlineOverride.alphaCutoff;
        if (inlineOverride.doubleSided !== undefined) doubleSided = inlineOverride.doubleSided;
        // Inline override texture transforms replace material asset transforms
        if (inlineOverride.textureTransforms && Array.isArray(inlineOverride.textureTransforms)) {
          if (inlineOverride.textureTransforms[0]) {
            baseColorTransform = inlineOverride.textureTransforms[0];
          }
        }
      }

      // Use PBR texture transform if available, else fall back to legacy UV params
      // glTF KHR_texture_transform: scale = repeat, offset = offset, rotation = rotation
      const repeatU = baseColorTransform?.scale?.[0] ?? face?.repeatU ?? 1;
      const repeatV = baseColorTransform?.scale?.[1] ?? face?.repeatV ?? 1;
      const offsetU = baseColorTransform?.offset?.[0] ?? face?.offsetU ?? 0;
      const offsetV = baseColorTransform?.offset?.[1] ?? face?.offsetV ?? 0;
      const rotation = baseColorTransform?.rotation ?? face?.rotation ?? 0;

      // Build face data from merged result + legacy face fallback
      const rgba = face?.rgba;
      const legacyColor = rgba
        ? [rgba.getRed(), rgba.getGreen(), rgba.getBlue(), rgba.getAlpha()]
        : [1, 1, 1, 1];

      const faceData: any = {
        index: faceIndex,
        textureId: baseColorTextureId || face?.textureID?.toString() || '',
        color: legacyColor,
        fullBright: face ? (face.material & 0x20) !== 0 : false,
        doubleSided: doubleSided ?? false,
        alphaMode: alphaMode ?? -1,
        alphaCutoff: alphaCutoff ?? 0.5,
        repeatU,
        repeatV,
        offsetU,
        offsetV,
        rotation,
        isPBR: true,
        ...(face?.mappingType ? { mappingType: face.mappingType } : {}),
      };

      // PBR-specific fields
      if (normalTextureId) faceData.normalTextureId = normalTextureId;
      if (metallicFactor !== undefined) faceData.metallicFactor = metallicFactor;
      if (roughnessFactor !== undefined) faceData.roughnessFactor = roughnessFactor;
      if (emissiveFactor) faceData.emissiveFactor = emissiveFactor;
      if (baseColor) faceData.pbrBaseColor = baseColor;

      this.pbrFaceCount++;

      // Queue textures for fetching (base color + normal only, per plan)
      if (baseColorTextureId && this.textureFetchQueue) {
        this.textureFetchQueue.request(baseColorTextureId, localId);
      }
      if (normalTextureId && this.textureFetchQueue) {
        this.textureFetchQueue.request(normalTextureId, localId);
      }

      let faces = byObject.get(localId);
      if (!faces) {
        faces = [];
        byObject.set(localId, faces);
      }
      faces.push(faceData);
    }

    // Send face updates to Godot
    for (const [localId, faces] of byObject) {
      this.send({
        type: 'object_update_faces',
        localId,
        faces,
      });
    }

    // Clean up — this material is fully processed
    this.materialToFaces.delete(materialUuid);
  }

  /** Handle live texture/UV change on a tracked object — re-send face data to Godot */
  private handleObjectTextureUpdate(obj: any): void {
    if (!this.trackedObjects.has(obj.ID)) return;
    const texInfo = this.getTextureInfo(obj);
    if (!texInfo) return;
    this.send({
      type: 'object_update_faces',
      localId: obj.ID,
      faces: texInfo.faces,
    });
    this.fetchTexturesForObject(obj, texInfo);
  }

  /** Recursively send children of a root/parent object */
  private sendChildren(obj: any): void {
    if (!obj.children) return;
    for (const child of obj.children) {
      if (child.PCode === 47) continue;
      this.sendObject(child, obj.ID);
      this.sendChildren(child);
    }
  }

  /** Re-scan all tracked roots for untracked children (catches late arrivals) */
  private rescanChildren(): void {
    if (!this.connected) return;
    try {
      const objectStore = this.bot.currentRegion.objects;
      let found = 0;
      for (const localId of this.trackedObjects) {
        const children = objectStore.getObjectsByParent(localId);
        for (const child of children) {
          if (child.PCode === 47) continue;
          if (!this.trackedObjects.has(child.ID)) {
            this.sendObject(child, localId);
            found++;
          }
        }
      }
      if (found > 0) {
        console.log(`[GodotBridge] Rescan found ${found} missing children`);
      }
    } catch { /* bot may be disconnected */ }
  }

  private sendInitialSnapshot(): void {
    try {
      const region = this.bot.currentRegion;

      // Send initial avatars immediately — small count, no throttling needed
      const agents = region.agents;
      for (const [id, avatar] of agents) {
        const pos = avatar.position;
        const rot = avatar.getRotation();
        this.send({
          type: 'avatar_create',
          id,
          name: avatar.getName(),
          position: [pos.x, pos.y, pos.z],
          rotation: [rot.x, rot.y, rot.z, rot.w],
        });
        this.trackedAvatars.add(id);
      }
      console.log(`[GodotBridge] Sent ${agents.size} initial avatars`);

      // Flatten all objects (roots then children, depth-first) into a queue.
      // Parent always comes before its children so Godot can resolve linkset positions.
      const queue: { obj: any; parentId: number }[] = [];
      const collect = (obj: any, parentId: number) => {
        if (obj.PCode === 47) return;
        queue.push({ obj, parentId });
        if (obj.children) {
          for (const child of obj.children) {
            if (child.PCode !== 47) collect(child, obj.ID);
          }
        }
      };
      for (const obj of region.objects.getAllObjects({})) {
        collect(obj, 0);
      }

      // Pre-mark all queued objects as tracked so that onNewObjectEvent won't
      // duplicate-send any of them while the batched send is in progress.
      for (const { obj } of queue) {
        this.trackedObjects.add(obj.ID);
      }

      console.log(`[GodotBridge] Sending ${queue.length} objects in batches of 200 (50ms apart)`);

      // Send 200 objects per tick, 50ms between ticks.
      // Godot's 12ms per-frame message budget is the real throttle; we just avoid
      // a single synchronous burst that would block the Electron main thread.
      const BATCH_SIZE = 200;
      let offset = 0;
      const sendNextBatch = () => {
        if (!this.connected) return;
        const end = Math.min(offset + BATCH_SIZE, queue.length);
        for (let i = offset; i < end; i++) {
          this.sendObject(queue[i].obj, queue[i].parentId);
        }
        offset = end;
        if (offset < queue.length) {
          setTimeout(sendNextBatch, 50);
        } else {
          console.log(`[GodotBridge] Initial snapshot complete: ${queue.length} objects`);
        }
      };
      sendNextBatch();
    } catch (err) {
      console.error('[GodotBridge] Error sending initial snapshot:', err);
    }
  }

  private async sendTerrain(): Promise<void> {
    const region = this.bot.currentRegion;

    // Wait for all terrain patches to arrive
    try {
      await region.waitForTerrain();
    } catch {
      console.warn('[GodotBridge] Terrain wait timed out, sending what we have');
    }

    // Write terrain as raw Float32 binary to cache file (256KB vs ~500KB+ JSON)
    const buf = Buffer.alloc(256 * 256 * 4);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const h = region.terrain[y]?.[x] ?? 0;
        buf.writeFloatLE(h < 0 ? 0 : h, (y * 256 + x) * 4);
      }
    }

    const safeName = region.regionName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cachePath = path.join(getCacheDirBase(), 'terrain', `${safeName}.bin`);
    fs.writeFileSync(cachePath, buf);
    const fwdPath = cachePath.replace(/\\/g, '/');

    console.log(`[GodotBridge] Terrain cached (waterHeight=${region.waterHeight})`);
    this.send({
      type: 'terrain_ready',
      path: fwdPath,
      waterHeight: region.waterHeight ?? 20,
    });

    // Send environment data (small message, no caching needed)
    this.sendEnvironment();
  }

  private sendEnvironment(): void {
    try {
      const env = this.bot.currentRegion.environment;
      const dayCycle = env?.dayCycle;

      // Default sun direction: roughly 45° elevation, from southeast
      let sunDir = [0.5, 0.7, -0.5];
      let sunColor = [1.0, 0.95, 0.8];
      let ambientColor = [0.3, 0.35, 0.4];

      if (dayCycle) {
        // Try to get sun rotation from dayCycle or first frame
        let sunRot = dayCycle.sunRotation;
        let slColor = dayCycle.sunlightColor;

        // If no direct properties, try first frame
        if (!sunRot && dayCycle.frames) {
          for (const [, frame] of dayCycle.frames) {
            if (frame.sunRotation) {
              sunRot = frame.sunRotation;
              if (!slColor && frame.sunlightColor) slColor = frame.sunlightColor;
              break;
            }
          }
        }

        if (sunRot) {
          // Rotate (0, 0, -1) by sunRotation to get sun direction in SL coords
          const { x: qx, y: qy, z: qz, w: qw } = sunRot;
          // v = q * (0,0,-1) * q^-1, simplified:
          const vx = -2 * (qx * qz + qy * qw);
          const vy = -2 * (qy * qz - qx * qw);
          const vz = -(1 - 2 * (qx * qx + qy * qy));
          sunDir = [vx, vy, vz];
        }

        if (slColor) {
          // sunlightColor can be Vector3 or Vector4
          const r = (slColor as any).x ?? 0;
          const g = (slColor as any).y ?? 0;
          const b = (slColor as any).z ?? 0;
          sunColor = [Math.min(r, 1), Math.min(g, 1), Math.min(b, 1)];
        }

        // Ambient from legacy haze if available
        const haze = (dayCycle as any).legacyHaze;
        if (haze?.ambient) {
          const a = haze.ambient;
          ambientColor = [
            Math.min((a as any).x ?? 0.3, 1),
            Math.min((a as any).y ?? 0.35, 1),
            Math.min((a as any).z ?? 0.4, 1),
          ];
        }
      }

      this.send({
        type: 'environment_data',
        sunDirection: sunDir,
        sunColor,
        ambientColor,
      });
    } catch (err) {
      console.error('[GodotBridge] Error sending environment:', err);
    }
  }

  private subscribeToEvents(): void {
    const events = this.bot.clientEvents;

    // New objects (roots and children)
    const newObjSub = events.onNewObjectEvent.subscribe((event) => {
      const obj = event.object;
      if (obj.PCode === 47) return; // Skip avatars

      // Skip avatar attachments: parent is an avatar
      if (obj.ParentID && obj.ParentID !== 0) {
        try {
          const parent = this.bot.currentRegion.objects.getObjectByLocalID(obj.ParentID);
          if (parent && parent.PCode === 47) return;
        } catch { /* parent not found yet — send it, Godot will buffer */ }
      }

      const parentId = obj.ParentID || 0;
      this.sendObject(obj, parentId);

      // If this is a root, check for already-arrived children
      if (parentId === 0) {
        try {
          const children = this.bot.currentRegion.objects.getObjectsByParent(obj.ID);
          for (const child of children) {
            if (child.PCode === 47) continue;
            if (!this.trackedObjects.has(child.ID)) {
              this.sendObject(child, obj.ID);
            }
          }
        } catch { /* ignore */ }
      }
    });
    this.subscriptions.push(newObjSub);

    // Terse updates (position/rotation) — coalesced into batches
    const terseSub = events.onObjectUpdatedTerseEvent.subscribe((event) => {
      const obj = event.object;

      // Avatar terse updates — event-driven instead of polling
      if (obj.PCode === 47) {
        const avatarId = obj.FullID?.toString();
        if (avatarId && this.trackedAvatars.has(avatarId)) {
          const pos = obj.Position;
          const rot = obj.Rotation;
          const vel = obj.Velocity;
          this.avatarUpdateBuffer.set(avatarId, {
            id: avatarId,
            ...(pos ? { position: [pos.x, pos.y, pos.z] } : {}),
            ...(rot ? { rotation: [rot.x, rot.y, rot.z, rot.w] } : {}),
            ...(vel ? { velocity: [vel.x, vel.y, vel.z] } : {}),
          });
          if (!this.avatarUpdateTimer) {
            this.avatarUpdateTimer = setTimeout(() => {
              this.flushAvatarUpdateBuffer();
              this.avatarUpdateTimer = null;
            }, 50);
          }
        }
        return;
      }

      // Object terse updates
      if (!this.trackedObjects.has(obj.ID)) return;

      const pos = obj.Position;
      const rot = obj.Rotation;
      const scl = obj.Scale;

      this.updateBuffer.set(obj.ID, {
        localId: obj.ID,
        ...(pos ? { position: [pos.x, pos.y, pos.z] } : {}),
        ...(rot ? { rotation: [rot.x, rot.y, rot.z, rot.w] } : {}),
        ...(scl ? { scale: [scl.x, scl.y, scl.z] } : {}),
      });

      // Flush every 50ms
      if (!this.updateTimer) {
        this.updateTimer = setTimeout(() => {
          this.flushUpdateBuffer();
          this.updateTimer = null;
        }, 50);
      }
    });
    this.subscriptions.push(terseSub);

    // Full object updates (may include scale changes)
    const fullUpdateSub = events.onObjectUpdatedEvent.subscribe((event) => {
      const obj = event.object;
      if (!this.trackedObjects.has(obj.ID)) return;

      const pos = obj.Position;
      const rot = obj.Rotation;
      const scl = obj.Scale;

      this.updateBuffer.set(obj.ID, {
        localId: obj.ID,
        ...(pos ? { position: [pos.x, pos.y, pos.z] } : {}),
        ...(rot ? { rotation: [rot.x, rot.y, rot.z, rot.w] } : {}),
        ...(scl ? { scale: [scl.x, scl.y, scl.z] } : {}),
      });

      if (!this.updateTimer) {
        this.updateTimer = setTimeout(() => {
          this.flushUpdateBuffer();
          this.updateTimer = null;
        }, 50);
      }
    });
    this.subscriptions.push(fullUpdateSub);

    // Avatar enter — event-driven (replaces 500ms polling)
    const avatarEnterSub = events.onAvatarEnteredRegion.subscribe((avatar) => {
      try {
        const id = avatar.getKey().toString();
        if (!id || this.trackedAvatars.has(id)) return;
        const pos = avatar.position;
        const rot = avatar.getRotation();
        this.send({
          type: 'avatar_create',
          id,
          name: avatar.getName(),
          position: [pos.x, pos.y, pos.z],
          rotation: [rot.x, rot.y, rot.z, rot.w],
        });
        this.trackedAvatars.add(id);
      } catch { /* avatar may not be fully initialized yet */ }
    });
    this.subscriptions.push(avatarEnterSub);

    // Kill sweep + child rescan: every 2s
    // (onObjectKilledEvent and child onNewObjectEvent are not fired in node-metaverse)
    let memLogCounter = 0;
    this.killSweepTimer = setInterval(() => {
      this.sweepDeletedObjects();
      this.sweepAvatarDepartures();
      this.rescanChildren();
      this.sweepDeferredTextures();

      // Log memory stats every 30s (15 ticks × 2s)
      if (++memLogCounter % 15 === 0) {
        const mem = process.memoryUsage();
        const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
        let objStoreSize: string | number = '?';
        try { objStoreSize = this.bot.currentRegion?.objects?.getNumberOfObjects?.() ?? '?'; } catch { /* bot disconnected */ }
        const tq = this.textureFetchQueue;
        const mq = this.meshFetchQueue;
        const sq = this.sculptFetchQueue;
        const matq = this.materialFetchQueue;
        const gs = this.lastGodotStats;
        const godotStr = gs
          ? ` | godot(${gs.fps?.toFixed(0) ?? '?'}fps budget:${gs.budgetElapsed?.toFixed(1) ?? '?'}/${gs.budgetAvail?.toFixed(1) ?? '?'}/${gs.budgetUsed?.toFixed(1) ?? '?'}ms el/av/us): tex: w=${gs.texWorkers}(${gs.texReady ?? '?'}rdy) q=${gs.texQueue} done=${gs.texDone} cached=${gs.texCached} fail=${gs.texFailed} pending=${gs.texPending} [${gs.texTiming ?? '?'}] | mesh: w=${gs.meshWorkers}(${gs.meshReady ?? '?'}rdy) q=${gs.meshQueue} done=${gs.meshDone} cached=${gs.meshCached} fail=${gs.meshFailed} pending=${gs.meshPending} | mats=${gs.materials}(${gs.materialReuse ?? '?'}reuse) opaque=${gs.texOpaque ?? '?'}`
          : '';
        console.log(`[GodotBridge] Memory: rss=${mb(mem.rss)}MB heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB ext=${mb(mem.external)}MB | objects=${objStoreSize} tracked=${this.trackedObjects.size} | tex: q=${tq?.queueDepth ?? '?'} active=${tq?.activeCount ?? '?'} done=${tq?.notifiedCount ?? '?'} fail=${tq?.failedCount ?? '?'} gpu=${tq?.gpuCompressCount ?? '?'}/${tq?.webpFallbackCount ?? '?'}wp decode: q=${tq?.decodePool?.queueDepth ?? '?'} active=${tq?.decodePool?.activeCount ?? '?'} gpuq: q=${tq?.gpuQueueDepth ?? '?'} active=${tq?.gpuQueueActive ?? '?'} | mesh: q=${mq?.queueDepth ?? '?'} active=${mq?.activeCount ?? '?'} done=${mq?.notifiedCount ?? '?'} fail=${mq?.failedCount ?? '?'} | sculpt: q=${sq?.queueDepth ?? '?'} active=${sq?.activeCount ?? '?'} done=${sq?.notifiedCount ?? '?'} fail=${sq?.failedCount ?? '?'} | mat: q=${matq?.queueDepth ?? '?'} active=${matq?.activeCount ?? '?'} done=${matq?.cachedCount ?? '?'} fail=${matq?.failedCount ?? '?'} | pbr: ${this.pbrFaceCount} faces | deferred: ${this.deferredTextures.size}${godotStr}`);
      }
    }, 2000);
  }

  private flushUpdateBuffer(): void {
    if (this.updateBuffer.size === 0) return;

    const objects = Array.from(this.updateBuffer.values());
    this.updateBuffer.clear();

    this.send({
      type: 'object_update_batch',
      objects,
    });
  }

  private flushAvatarUpdateBuffer(): void {
    if (this.avatarUpdateBuffer.size === 0) return;

    const avatars = Array.from(this.avatarUpdateBuffer.values());
    this.avatarUpdateBuffer.clear();

    this.send({
      type: 'avatar_update_batch',
      avatars,
    });
  }

  /** Sweep for avatars that left the region (called from killSweep timer) */
  private sweepAvatarDepartures(): void {
    try {
      const agents = this.bot.currentRegion.agents;
      for (const id of this.trackedAvatars) {
        if (!agents.has(id)) {
          this.send({ type: 'avatar_kill', id });
          this.trackedAvatars.delete(id);
        }
      }
    } catch { /* bot may be disconnected */ }
  }

  private sweepDeletedObjects(): void {
    try {
      const objectStore = this.bot.currentRegion.objects;
      for (const localId of this.trackedObjects) {
        try {
          const obj = objectStore.getObjectByLocalID(localId);
          if (!obj || obj.deleted) {
            this.send({ type: 'object_kill', localId });
            this.trackedObjects.delete(localId);
            this.textureUpdateSubs.get(localId)?.unsubscribe();
            this.textureUpdateSubs.delete(localId);
          }
        } catch {
          // Object not found in store — it's been killed
          this.send({ type: 'object_kill', localId });
          this.trackedObjects.delete(localId);
          this.textureUpdateSubs.get(localId)?.unsubscribe();
          this.textureUpdateSubs.delete(localId);
        }
      }
    } catch { /* bot may be disconnected */ }
  }

  /** Promote deferred textures for objects now within fetch range */
  private sweepDeferredTextures(): void {
    if (this.deferredTextures.size === 0) return;
    try {
      const botPos = this.getBotPosition();
      if (!botPos) return;

      const objectStore = this.bot.currentRegion.objects;
      let promoted = 0;

      for (const [localId, obj] of this.deferredTextures) {
        // Object deleted from store — just drop it
        let live: any;
        try {
          live = objectStore.getObjectByLocalID(localId);
          if (!live || live.deleted) {
            this.deferredTextures.delete(localId);
            continue;
          }
        } catch {
          this.deferredTextures.delete(localId);
          continue;
        }

        const globalPos = this.getGlobalPosition(live);
        if (!globalPos) continue;
        const dist = globalPos.distance(botPos);
        if (dist <= this.TEXTURE_FETCH_RANGE) {
          this.deferredTextures.delete(localId);
          const texInfo = this.getTextureInfo(live);
          this.fetchTexturesForObject(live, texInfo);
          promoted++;
        }
      }

      if (promoted > 0) {
        console.log(`[GodotBridge] Promoted ${promoted} deferred objects for texture fetch (${this.deferredTextures.size} still deferred)`);
      }
    } catch { /* bot may be disconnected */ }
  }

  private handleInputMove(msg: any): void {
    const agent = this.bot.agent;
    if (!agent) {
      const now = Date.now();
      if (this._dbgAgentNullAt === 0) this._dbgAgentNullAt = now;
      // Log once per second while agent is null so the log isn't spammed
      if (now - this._dbgAgentNullAt < 1100) {
        console.warn(`[GodotBridge] input_move dropped — bot.agent is null (no circuit?)`);
      }
      return;
    }
    if (this._dbgAgentNullAt !== 0) {
      console.log(`[GodotBridge] bot.agent restored after ${((Date.now() - this._dbgAgentNullAt) / 1000).toFixed(1)}s`);
      this._dbgAgentNullAt = 0;
    }

    const isMoving = msg.forward || msg.backward || msg.strafe_left || msg.strafe_right
      || msg.jump || msg.crouch;
    if (isMoving && !this._dbgMoving) {
      console.log(`[GodotBridge] Movement started fwd=${msg.forward} back=${msg.backward} sl=${msg.strafe_left} sr=${msg.strafe_right}`);
      this._dbgMoving = true;
    } else if (!isMoving && this._dbgMoving) {
      console.log(`[GodotBridge] Movement stopped`);
      this._dbgMoving = false;
    }

    // Forward/backward only — A/D rotation is handled via body quaternion
    if (msg.forward) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_AT_POS);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_AT_POS);
    }
    if (msg.backward) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_AT_NEG);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_AT_NEG);
    }
    if (msg.jump) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
    }
    if (msg.crouch) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
    }

    // Strafe
    if (msg.strafe_left) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_LEFT_POS);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_LEFT_POS);
    }
    if (msg.strafe_right) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_LEFT_NEG);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_LEFT_NEG);
    }

    // Run (double-tap W or Ctrl+R always-run)
    if (msg.running) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_FAST_AT);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_FAST_AT);
    }

    // Fly toggle
    if (typeof msg.fly === 'boolean') {
      if (msg.fly) {
        agent.setControlFlag(ControlFlags.AGENT_CONTROL_FLY);
      } else {
        agent.clearControlFlag(ControlFlags.AGENT_CONTROL_FLY);
      }
    }

    // Set body rotation from camera yaw
    // Godot yaw=0 means facing -Z (Godot) = +Y (SL North)
    // SL body rotation is around Z-up axis. Heading 0 = +X (East).
    // So SL heading = godotYaw + PI/2
    if (typeof msg.yaw === 'number') {
      const slHeading = msg.yaw + Math.PI / 2;
      const halfAngle = slHeading / 2;
      // Quaternion around SL Z axis (0, 0, sin, cos)
      let qz = Math.sin(halfAngle);
      let qw = Math.cos(halfAngle);
      // SL wire format only sends x,y,z and reconstructs w = sqrt(1-x²-y²-z²),
      // which is always positive. Negate all components when w < 0 so the
      // reconstructed quaternion matches our intent (q and -q = same rotation).
      if (qw < 0) { qz = -qz; qw = -qw; }
      (agent as any).bodyRotation.x = 0;
      (agent as any).bodyRotation.y = 0;
      (agent as any).bodyRotation.z = qz;
      (agent as any).bodyRotation.w = qw;
    }

    agent.sendAgentUpdate();
  }

  stop(): void {
    this.cleanup();

    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private cleanup(): void {
    // Unsubscribe from events
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    // Unsubscribe per-object texture update subscriptions
    for (const sub of this.textureUpdateSubs.values()) {
      sub.unsubscribe();
    }
    this.textureUpdateSubs.clear();

    // Clear timers
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    if (this.avatarUpdateTimer) {
      clearTimeout(this.avatarUpdateTimer);
      this.avatarUpdateTimer = null;
    }
    if (this.killSweepTimer) {
      clearInterval(this.killSweepTimer);
      this.killSweepTimer = null;
    }

    // Destroy fetch queues
    if (this.meshFetchQueue) {
      this.meshFetchQueue.destroy();
      this.meshFetchQueue = null;
    }
    if (this.textureFetchQueue) {
      this.textureFetchQueue.destroy();
      this.textureFetchQueue = null;
    }
    if (this.sculptFetchQueue) {
      this.sculptFetchQueue.destroy();
      this.sculptFetchQueue = null;
    }
    if (this.materialFetchQueue) {
      this.materialFetchQueue.destroy();
      this.materialFetchQueue = null;
    }
    this.materialToFaces.clear();
    this.deferredTextures.clear();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.trackedObjects.clear();
    this.trackedAvatars.clear();
    this.updateBuffer.clear();
    this.avatarUpdateBuffer.clear();
    this.assetReadyBuffer = [];
    if (this.assetReadyTimer) {
      clearTimeout(this.assetReadyTimer);
      this.assetReadyTimer = null;
    }
  }

  get isActive(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }
}
