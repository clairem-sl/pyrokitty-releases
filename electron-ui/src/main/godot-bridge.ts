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

const GODOT_WS_PORT_BASE = 9100;
let nextPort = GODOT_WS_PORT_BASE;

function getGodotPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'godot-viewer', 'Godot_v4.6.1-stable_mono_win64', 'Godot_v4.6.1-stable_mono_win64.exe');
  } else {
    const appRoot = app.getAppPath();
    return path.join(appRoot, '..', 'godot-viewer', 'Godot_v4.6.1-stable_mono_win64', 'Godot_v4.6.1-stable_mono_win64.exe');
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
  private connected = false;
  private assetReadyBuffer: object[] = [];
  private assetReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGodotStats: any = null;

  constructor(bot: Bot) {
    super();
    this.bot = bot;
    this.port = nextPort++;
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
      textureId: string; color: number[]; fullBright: boolean; doubleSided: boolean;
      repeatU: number; repeatV: number; offsetU: number; offsetV: number; rotation: number;
    }[];
    textureIds: string[]; // unique texture IDs for fetch queue
  } | undefined {
    try {
      const te = obj.TextureEntry;
      if (!te || !te.defaultTexture) return undefined;

      // GLTF material overrides per face
      const gltfDS = new Map<number, boolean>();
      const gltfAlpha = new Map<number, { mode: number; cutoff: number }>();
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
        }
      }
      // Fallback doubleSided from any face
      let defaultDS: boolean | undefined = false;
      if (gltfDS.size > 0) defaultDS = gltfDS.values().next().value;

      const faces: any[] = [];
      const textureIdSet = new Set<string>();
      const ZERO = '00000000-0000-0000-0000-000000000000';

      // Resolve all 8 potential faces; each inherits from defaultTexture for unset fields
      for (let i = 0; i < 8; i++) {
        const face = te.faces[i] ?? te.defaultTexture;
        const textureId = face.textureID?.toString() || '';
        if (!textureId || textureId === ZERO) continue;

        const rgba = face.rgba;
        const color = rgba
          ? [rgba.getRed(), rgba.getGreen(), rgba.getBlue(), rgba.getAlpha()]
          : [1, 1, 1, 1];

        faces.push({
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
        });
        textureIdSet.add(textureId);
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

    console.log(`[GodotBridge] Spawning Godot on port ${this.port}`);
    console.log(`[GodotBridge] Path: ${godotPath}`);
    console.log(`[GodotBridge] Project: ${projectPath}`);

    this.process = spawn(godotPath, [
      '--path', projectPath,
      '--', `--ws-port=${this.port}`,
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
                    console.log('[GodotBridge] Godot ready');
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
    if (meshCount + texCount > 0) {
      console.log(`[GodotBridge] Sent ${meshCount} meshes + ${texCount} textures (${this.assetReadyBuffer.length} queued)`);
    }

    // Schedule next batch if more remain
    if (this.assetReadyBuffer.length > 0) {
      this.assetReadyTimer = setTimeout(() => this.flushAssetReady(), 50);
    }
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

    this.send({
      type: 'object_create',
      localId: obj.ID,
      uuid: obj.FullID?.toString() || '',
      parentId: parentLocalId,
      position: [pos.x, pos.y, pos.z],
      rotation: rot ? [rot.x, rot.y, rot.z, rot.w] : [0, 0, 0, 1],
      scale: scl ? [scl.x, scl.y, scl.z] : [0.5, 0.5, 0.5],
      ...(meshId ? { meshId } : sculpt_meshId ? { meshId: sculpt_meshId } : {}),
      ...(texInfo ? { faces: texInfo.faces } : {}),
    });
    this.trackedObjects.add(obj.ID);

    if (meshId && this.meshFetchQueue) {
      this.meshFetchQueue.request(meshId, obj.ID);
    }
    if (sculptInfo && this.sculptFetchQueue) {
      this.sculptFetchQueue.request(sculptInfo.textureUuid, sculptInfo.sculptType, obj.ID);
    }
    if (texInfo && this.textureFetchQueue) {
      for (const tid of texInfo.textureIds) {
        this.textureFetchQueue.request(tid, obj.ID);
      }
    }
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
      const objects = region.objects.getAllObjects({});

      let count = 0;
      let childCount = 0;
      for (const obj of objects) {
        // getAllObjects returns root objects with children[] populated
        if (obj.PCode === 47) continue; // Skip avatars

        this.sendObject(obj, 0);
        count++;

        // Send all children recursively
        if (obj.children && obj.children.length > 0) {
          const before = this.trackedObjects.size;
          this.sendChildren(obj);
          childCount += this.trackedObjects.size - before;
        }
      }

      console.log(`[GodotBridge] Sent ${count} root objects + ${childCount} children`);

      // Send initial avatars
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

      console.log(`[GodotBridge] Sending environment data (sunDir=${sunDir})`);
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

      // Log memory stats every 30s (15 ticks × 2s)
      if (++memLogCounter % 15 === 0) {
        const mem = process.memoryUsage();
        const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
        const objStoreSize = this.bot.currentRegion?.objects?.getNumberOfObjects?.() ?? '?';
        const tq = this.textureFetchQueue;
        const mq = this.meshFetchQueue;
        const sq = this.sculptFetchQueue;
        const gs = this.lastGodotStats;
        const godotStr = gs
          ? ` | godot(${gs.fps?.toFixed(0) ?? '?'}fps budget:${gs.budgetElapsed?.toFixed(1) ?? '?'}/${gs.budgetAvail?.toFixed(1) ?? '?'}/${gs.budgetUsed?.toFixed(1) ?? '?'}ms el/av/us): tex: w=${gs.texWorkers}(${gs.texReady ?? '?'}rdy) q=${gs.texQueue} done=${gs.texDone} cached=${gs.texCached} fail=${gs.texFailed} pending=${gs.texPending} [${gs.texTiming ?? '?'}] | mesh: w=${gs.meshWorkers}(${gs.meshReady ?? '?'}rdy) q=${gs.meshQueue} done=${gs.meshDone} cached=${gs.meshCached} fail=${gs.meshFailed} pending=${gs.meshPending} | mats=${gs.materials}(${gs.materialReuse ?? '?'}reuse) opaque=${gs.texOpaque ?? '?'}`
          : '';
        console.log(`[GodotBridge] Memory: rss=${mb(mem.rss)}MB heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB ext=${mb(mem.external)}MB | objects=${objStoreSize} tracked=${this.trackedObjects.size} | tex: q=${tq?.queueDepth ?? '?'} active=${tq?.activeCount ?? '?'} done=${tq?.notifiedCount ?? '?'} fail=${tq?.failedCount ?? '?'} gpu=${tq?.gpuCompressCount ?? '?'}/${tq?.webpFallbackCount ?? '?'}wp decode: q=${tq?.decodePool?.queueDepth ?? '?'} active=${tq?.decodePool?.activeCount ?? '?'} gpuq: q=${tq?.gpuQueueDepth ?? '?'} active=${tq?.gpuQueueActive ?? '?'} | mesh: q=${mq?.queueDepth ?? '?'} active=${mq?.activeCount ?? '?'} done=${mq?.notifiedCount ?? '?'} fail=${mq?.failedCount ?? '?'} | sculpt: q=${sq?.queueDepth ?? '?'} active=${sq?.activeCount ?? '?'} done=${sq?.notifiedCount ?? '?'} fail=${sq?.failedCount ?? '?'}${godotStr}`);
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
          }
        } catch {
          // Object not found in store — it's been killed
          this.send({ type: 'object_kill', localId });
          this.trackedObjects.delete(localId);
        }
      }
    } catch { /* bot may be disconnected */ }
  }

  private handleInputMove(msg: any): void {
    const agent = this.bot.agent;
    if (!agent) return;

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
    console.log('[GodotBridge] Stopping...');
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
