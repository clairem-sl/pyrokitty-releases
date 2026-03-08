/**
 * GodotBridge — Spawns a Godot 4 sidecar and streams object/avatar data
 * from node-metaverse over WebSocket.
 *
 * Orchestrates sub-modules:
 *  - GodotInputHandler — movement, object interaction
 *  - GodotAnimationManager — animation batching for avatars/animesh
 *  - GodotMaterialPipeline — texture/material fetching and processing
 *  - GodotObjectSender — object serialization, snapshots, sweeps
 *  - GodotAvatarManager — avatar lifecycle and attachment routing
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { app } from 'electron';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { Bot } from '../../node-metaverse/dist/lib';
import type { Subscription } from 'rxjs';
import { MeshFetchQueue } from './mesh-fetch-queue';
import { TextureFetchQueue } from './texture-fetch-queue';
import { SculptFetchQueue } from './sculpt-fetch-queue';
import { MaterialFetchQueue } from './material-fetch-queue';
import { AnimationFetchQueue } from './animation-fetch-queue';
import { getSavedBounds, saveExternalBounds } from './window-state-manager';
import { GodotEnvironmentManager } from './godot-environment-manager';
import { GodotUpdateCoalescer } from './godot-update-coalescer';
import { GodotInputHandler } from './godot-input-handler';
import { GodotAnimationManager } from './godot-animation-manager';
import { GodotMaterialPipeline } from './godot-material-pipeline';
import { GodotObjectSender } from './godot-object-sender';
import { GodotAvatarManager } from './godot-avatar-manager';
import { isHudAttachment } from './godot-bridge-types';

const GODOT_WS_PORT_BASE = 9200;
let nextPort = GODOT_WS_PORT_BASE;

function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number, attempts: number) => {
      if (attempts <= 0) {
        reject(new Error(`No free port found starting from ${startPort}`));
        return;
      }
      const srv = net.createServer();
      srv.once('error', () => tryPort(port + 1, attempts - 1));
      srv.listen(port, '127.0.0.1', () => {
        srv.close(() => resolve(port));
      });
    };
    tryPort(startPort, 20);
  });
}

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
  private connected = false;
  private vrMode: boolean;

  // Shared state (passed to sub-modules)
  private trackedObjects = new Set<number>();
  private trackedAvatars = new Set<string>();
  private avatarLocalIds = new Map<string, number>();

  // Sub-modules
  private inputHandler: GodotInputHandler;
  private animationManager: GodotAnimationManager;
  private materialPipeline: GodotMaterialPipeline;
  private objectSender: GodotObjectSender;
  private avatarManager: GodotAvatarManager;

  // Managers (already extracted)
  private environmentMgr: GodotEnvironmentManager | null = null;
  private updateCoalescer: GodotUpdateCoalescer | null = null;

  // Fetch queues (owned by bridge, initialized in connectWebSocket)
  private textureFetchQueue: TextureFetchQueue | null = null;

  // Asset ready batching
  private assetReadyBuffer: object[] = [];
  private assetReadyTimer: ReturnType<typeof setTimeout> | null = null;

  // Stats
  private lastGodotStats: any = null;
  private killSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(bot: Bot, options: { vrMode?: boolean; objectAnimationBuffer?: Map<string, { animId: string; sequenceId: number }[]> } = {}) {
    super();
    this.bot = bot;
    this.port = 0;
    this.vrMode = options.vrMode ?? false;

    const send = (msg: object) => this.send(msg);

    // Initialize sub-modules
    this.inputHandler = new GodotInputHandler(bot, send);
    this.animationManager = new GodotAnimationManager(bot, send, this.avatarLocalIds);
    this.materialPipeline = new GodotMaterialPipeline(bot, send, this.trackedObjects);
    this.objectSender = new GodotObjectSender(
      bot, send, this.trackedObjects, this.avatarLocalIds,
      this.materialPipeline, this.animationManager,
    );
    this.avatarManager = new GodotAvatarManager(
      bot, send, this.trackedObjects, this.trackedAvatars,
      this.avatarLocalIds, this.animationManager,
    );
    this.avatarManager.setObjectSender(this.objectSender);

    // Seed from MetaverseConnection's early ObjectAnimation buffer
    if (options.objectAnimationBuffer) {
      this.animationManager.seedObjectAnimationBuffer(options.objectAnimationBuffer);
    }
  }

  async start(): Promise<void> {
    this.port = await findFreePort(nextPort);
    nextPort = this.port + 1;

    const godotPath = getGodotPath();
    const projectPath = getProjectPath();

    // Ensure cache directories exist
    const cacheBase = getCacheDirBase();
    fs.mkdirSync(path.join(cacheBase, 'meshes'), { recursive: true });
    fs.mkdirSync(path.join(cacheBase, 'textures'), { recursive: true });
    fs.mkdirSync(path.join(cacheBase, 'terrain'), { recursive: true });

    // VR config
    const overridePath = path.join(projectPath, 'override.cfg');
    const overrideVrPath = path.join(projectPath, 'override.vr.cfg');
    if (this.vrMode) {
      fs.copyFileSync(overrideVrPath, overridePath);
      console.log('[GodotBridge] Copied override.vr.cfg → override.cfg (VR mode)');
    } else {
      try { fs.unlinkSync(overridePath); } catch { /* not present, fine */ }
    }

    // Subscribe to animation messages early
    const objAnimSub = this.animationManager.subscribeToObjectAnimation();
    if (objAnimSub) this.subscriptions.push(objAnimSub);
    const avatarAnimSub = this.animationManager.subscribeToAvatarAnimation();
    if (avatarAnimSub) this.subscriptions.push(avatarAnimSub);

    console.log(`[GodotBridge] Spawning Godot on port ${this.port} — ${godotPath}`);

    const userArgs = [`--ws-port=${this.port}`];
    if (this.vrMode) userArgs.push('--vr');

    const savedBounds = getSavedBounds('godot');
    if (savedBounds) {
      userArgs.push(`--window-position=${savedBounds.x},${savedBounds.y}`);
      userArgs.push(`--window-size=${savedBounds.width},${savedBounds.height}`);
    }

    this.process = spawn(godotPath, [
      '--path', projectPath,
      '--', ...userArgs,
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data) => {
      const text = data.toString().trim();
      console.log(`[Godot] ${text}`);
      if (text.includes('SHADER ERROR')) {
        console.error(`[GodotBridge] Shader compilation failed — killing Godot`);
        this.process?.kill();
      }
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
            this.setConnected(true);
            console.log(`[GodotBridge] WebSocket connected (attempt ${attempt})`);

            ws.on('message', (data) => {
              try {
                const msg = JSON.parse(data.toString());
                this.handleGodotMessage(msg);
              } catch { /* ignore bad messages */ }
            });

            ws.on('close', () => {
              console.log('[GodotBridge] WebSocket closed');
              this.setConnected(false);
            });

            resolve();
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            ws.close();
            reject(err);
          });
        });
        break;
      } catch {
        if (attempt === maxAttempts) {
          throw new Error(`Failed to connect to Godot after ${maxAttempts} attempts`);
        }
        console.log(`[GodotBridge] Connect attempt ${attempt}/${maxAttempts} failed, retrying...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // Tell Godot which avatar is "self"
    const selfId = this.bot.agent?.agentID?.toString?.() || '';
    if (selfId) {
      this.send({ type: 'self_id', id: selfId });
    }

    // Init fetch queues
    const meshFetchQueue = new MeshFetchQueue(this.bot, (meshUuid, cachePath, isRigged, jointNames, staticCachePath) => {
      const fwdPath = cachePath.replace(/\\/g, '/');
      const msg: any = { type: 'mesh_ready', meshId: meshUuid, path: fwdPath };
      if (isRigged) {
        msg.isRigged = true;
        msg.jointNames = jointNames;
      }
      if (staticCachePath) msg.staticPath = staticCachePath.replace(/\\/g, '/');
      if (this.objectSender.selfMeshIds.has(meshUuid)) {
        console.log(`[SelfAvatar] Mesh ready: meshId=${meshUuid.slice(0, 8)} isRigged=${isRigged} joints=${jointNames?.length ?? 0} hasStatic=${!!staticCachePath}`);
      }
      this.queueAssetReady(msg);
    });

    this.textureFetchQueue = new TextureFetchQueue(this.bot, (textureUuid, cachePath) => {
      const fwdPath = cachePath.replace(/\\/g, '/');
      if (this.objectSender.selfTextureIds.has(textureUuid)) {
        console.log(`[SelfAvatar] Texture ready: textureId=${textureUuid.slice(0, 8)}`);
      }
      this.queueAssetReady({ type: 'texture_ready', textureId: textureUuid, path: fwdPath });
    });

    const sculptFetchQueue = new SculptFetchQueue(this.bot, (meshId, cachePath) => {
      const fwdPath = cachePath.replace(/\\/g, '/');
      this.queueAssetReady({ type: 'mesh_ready', meshId, path: fwdPath });
    });

    const materialFetchQueue = new MaterialFetchQueue(this.bot, (materialUuid, data) => {
      this.materialPipeline.handleMaterialReady(materialUuid, data);
    });

    const animationFetchQueue = new AnimationFetchQueue(this.bot, (animUuid, data) => {
      console.log(`[Animesh] animation_ready: ${animUuid.slice(0, 8)} (${data.joints.length} joints, ${data.duration.toFixed(1)}s, loop=${data.loop})`);
      this.animationManager.checkAnimBatchReady(animUuid);
    });

    // Wire fetch queues to sub-modules
    this.materialPipeline.initQueues(materialFetchQueue, this.textureFetchQueue);
    this.animationManager.initFetchQueue(animationFetchQueue);

    this.environmentMgr = new GodotEnvironmentManager(this.bot, (msg) => this.send(msg));

    this.updateCoalescer = new GodotUpdateCoalescer({
      isTracked: (id) => this.trackedObjects.has(id),
      isAvatarTracked: (id) => this.trackedAvatars.has(id),
      getLightInfo: (obj) => this.objectSender.getLightInfo(obj),
      send: (msg) => this.send(msg),
    });

    this.objectSender.initQueues(meshFetchQueue, sculptFetchQueue, this.textureFetchQueue, this.updateCoalescer);

    // Send initial snapshot and subscribe to events
    this.objectSender.sendInitialSnapshot((avatar, id) => this.avatarManager.sendAvatarCreate(avatar, id));
    this.subscribeToEvents();

    // Send terrain + environment async
    this.environmentMgr.sendTerrain().catch(err => {
      console.error('[GodotBridge] Error sending terrain:', err);
    });
  }

  private handleGodotMessage(msg: any): void {
    switch (msg.type) {
      case 'ready':
        break;
      case 'input_move':
        this.inputHandler.handleInputMove(msg);
        break;
      case 'pipeline_stats':
        this.lastGodotStats = msg;
        break;
      case 'request_object_properties':
        this.inputHandler.handleRequestObjectProperties(msg.localId);
        break;
      case 'set_object_name':
        this.inputHandler.handleSetObjectName(msg.localId, msg.name);
        break;
      case 'set_object_description':
        this.inputHandler.handleSetObjectDescription(msg.localId, msg.description);
        break;
      case 'object_touch':
        this.inputHandler.handleObjectTouch(msg);
        break;
      case 'window_bounds':
        saveExternalBounds('godot', {
          x: msg.x, y: msg.y,
          width: msg.width, height: msg.height,
        });
        break;
      case 'quit':
        console.log('[GodotBridge] Godot requested immediate quit');
        this.stop();
        break;
    }
  }

  private setConnected(connected: boolean): void {
    this.connected = connected;
    this.animationManager.setConnected(connected);
    this.avatarManager.setConnected(connected);
  }

  private send(msg: object): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private queueAssetReady(msg: object): void {
    this.assetReadyBuffer.push(msg);
    if (!this.assetReadyTimer) {
      this.assetReadyTimer = setTimeout(() => this.flushAssetReady(), 50);
    }
  }

  private flushAssetReady(): void {
    this.assetReadyTimer = null;
    if (this.assetReadyBuffer.length === 0) return;

    const BATCH_SIZE = 200;
    const batch = this.assetReadyBuffer.splice(0, BATCH_SIZE);
    for (const msg of batch) {
      this.send(msg);
    }

    if (this.assetReadyBuffer.length > 0) {
      this.assetReadyTimer = setTimeout(() => this.flushAssetReady(), 50);
    }
  }

  private subscribeToEvents(): void {
    const events = this.bot.clientEvents;

    // New objects
    const newObjSub = events.onNewObjectEvent.subscribe((event) => {
      const obj = event.object;
      if (obj.PCode === 47) return;
      if (isHudAttachment(obj)) return;

      const parentId = obj.ParentID || 0;
      this.objectSender.sendObject(obj, parentId);

      if (parentId === 0) {
        try {
          const children = this.bot.currentRegion.objects.getObjectsByParent(obj.ID);
          for (const child of children) {
            if (child.PCode === 47) continue;
            if (isHudAttachment(child)) continue;
            if (!this.trackedObjects.has(child.ID)) {
              this.objectSender.sendObject(child, obj.ID);
            }
          }
        } catch { /* ignore */ }
      }
    });
    this.subscriptions.push(newObjSub);

    // Terse + full updates
    const updateSubs = this.updateCoalescer!.subscribe(events);
    this.subscriptions.push(...updateSubs);

    // Avatar enter
    const avatarEnterSub = events.onAvatarEnteredRegion.subscribe((avatar) => {
      try {
        const id = avatar.getKey().toString();
        if (!id || this.trackedAvatars.has(id)) return;
        this.avatarManager.sendAvatarCreate(avatar, id);
      } catch { /* avatar may not be fully initialized yet */ }
    });
    this.subscriptions.push(avatarEnterSub);

    // Kill sweep + child rescan: every 2s
    let memLogCounter = 0;
    this.killSweepTimer = setInterval(() => {
      this.objectSender.sweepDeletedObjects();
      this.avatarManager.sweepAvatarDepartures();
      this.objectSender.rescanChildren();
      this.objectSender.sweepDeferredTextures();

      // Log memory stats every 30s
      if (++memLogCounter % 15 === 0) {
        this.logMemoryStats();
      }
    }, 2000);
  }

  private logMemoryStats(): void {
    const mem = process.memoryUsage();
    const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
    let objStoreSize: string | number = '?';
    try { objStoreSize = this.bot.currentRegion?.objects?.getNumberOfObjects?.() ?? '?'; } catch { /* bot disconnected */ }
    const tq = this.textureFetchQueue;
    const gs = this.lastGodotStats;
    const godotStr = gs
      ? ` | godot(${gs.fps?.toFixed(0) ?? '?'}fps budget:${gs.budgetElapsed?.toFixed(1) ?? '?'}/${gs.budgetAvail?.toFixed(1) ?? '?'}/${gs.budgetUsed?.toFixed(1) ?? '?'}ms el/av/us): tex: w=${gs.texWorkers}(${gs.texReady ?? '?'}rdy) q=${gs.texQueue} done=${gs.texDone} cached=${gs.texCached} fail=${gs.texFailed} pending=${gs.texPending} [${gs.texTiming ?? '?'}] | mesh: w=${gs.meshWorkers}(${gs.meshReady ?? '?'}rdy) q=${gs.meshQueue} done=${gs.meshDone} cached=${gs.meshCached} fail=${gs.meshFailed} pending=${gs.meshPending} | mats=${gs.materials}(${gs.materialReuse ?? '?'}reuse) opaque=${gs.texOpaque ?? '?'}`
      : '';
    console.log(`[GodotBridge] Memory: rss=${mb(mem.rss)}MB heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB ext=${mb(mem.external)}MB | objects=${objStoreSize} tracked=${this.trackedObjects.size} | tex: q=${tq?.queueDepth ?? '?'} active=${tq?.activeCount ?? '?'} done=${tq?.notifiedCount ?? '?'} fail=${tq?.failedCount ?? '?'} gpu=${tq?.gpuCompressCount ?? '?'}/${tq?.webpFallbackCount ?? '?'}wp decode: q=${tq?.decodePool?.queueDepth ?? '?'} active=${tq?.decodePool?.activeCount ?? '?'} gpuq: q=${tq?.gpuQueueDepth ?? '?'} active=${tq?.gpuQueueActive ?? '?'} | pbr: ${this.materialPipeline.totalPbrFaceCount} faces | deferred: ${this.objectSender.deferredCount}${godotStr}`);
  }

  stop(): void {
    this.cleanup();

    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private cleanup(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    if (this.killSweepTimer) {
      clearInterval(this.killSweepTimer);
      this.killSweepTimer = null;
    }

    // Clean up sub-modules
    this.objectSender.cleanup();
    this.avatarManager.cleanup();
    this.animationManager.cleanup();
    this.materialPipeline.cleanup();

    // Clean up managers
    this.updateCoalescer?.cleanup();
    this.updateCoalescer = null;
    this.environmentMgr?.cleanup();
    this.environmentMgr = null;

    // Destroy texture fetch queue (owned by bridge for stats access)
    if (this.textureFetchQueue) {
      this.textureFetchQueue.destroy();
      this.textureFetchQueue = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnected(false);
    this.trackedObjects.clear();
    this.trackedAvatars.clear();
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
