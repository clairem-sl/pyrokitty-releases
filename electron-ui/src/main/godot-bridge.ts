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
import { Message } from '../../node-metaverse/dist/lib/enums/Message';
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

// In dev mode __dirname is dist/main/, godot-viewer is at ../../.. (project root)
function getGodotViewerRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'godot-viewer')
    : path.join(__dirname, '..', '..', '..', 'godot-viewer');
}

function getGodotDir(): string {
  const versionFile = path.join(getGodotViewerRoot(), 'godot-version.txt');
  return fs.readFileSync(versionFile, 'utf8').trim();
}

function getGodotPath(): string {
  const dir = getGodotDir();
  return path.join(getGodotViewerRoot(), dir, `${dir}.exe`);
}

function getProjectPath(): string {
  return getGodotViewerRoot();
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

  constructor(bot: Bot, options: { vrMode?: boolean; objectAnimationBuffer?: Map<string, { animId: string; sequenceId: number }[]>; avatarAppearanceBuffer?: Map<string, string[]> } = {}) {
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
    this.objectSender.setAvatarManager(this.avatarManager);
    this.materialPipeline.setAvatarManager(this.avatarManager);

    // Seed from MetaverseConnection's early ObjectAnimation buffer
    if (options.objectAnimationBuffer) {
      this.animationManager.seedObjectAnimationBuffer(options.objectAnimationBuffer);
    }

    // Seed from MetaverseConnection's early AvatarAppearance buffer
    if (options.avatarAppearanceBuffer && options.avatarAppearanceBuffer.size > 0) {
      this.avatarManager.seedBakedTextures(options.avatarAppearanceBuffer);
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

    // Subscribe to animation + appearance messages early
    const objAnimSub = this.animationManager.subscribeToObjectAnimation();
    if (objAnimSub) this.subscriptions.push(objAnimSub);
    const avatarAnimSub = this.animationManager.subscribeToAvatarAnimation();
    if (avatarAnimSub) this.subscriptions.push(avatarAnimSub);
    const appearanceSub = this.avatarManager.subscribeToAvatarAppearance();
    if (appearanceSub) this.subscriptions.push(appearanceSub);

    console.log(`[GodotBridge] Spawning Godot on port ${this.port} — ${godotPath}`);

    const userArgs = [`--ws-port=${this.port}`];
    if (this.vrMode) userArgs.push('--vr');

    // Pass saved window bounds as engine args (before --) so the window
    // appears at the correct size/position immediately, avoiding a visible
    // resize flash. Godot processes --resolution and --position before
    // creating the window, unlike user args which are only available in _ready().
    const engineArgs: string[] = [];
    const savedBounds = getSavedBounds('godot');
    if (savedBounds) {
      engineArgs.push('--resolution', `${savedBounds.width}x${savedBounds.height}`);
      engineArgs.push('--position', `${savedBounds.x},${savedBounds.y}`);
    }

    this.process = spawn(godotPath, [
      '--path', projectPath,
      ...engineArgs,
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
    const meshFetchQueue = new MeshFetchQueue(this.bot, (meshUuid, cachePath, isRigged, jointNames, jointOverrides) => {
      const fwdPath = cachePath.replace(/\\/g, '/');
      const msg: any = { type: 'mesh_ready', meshId: meshUuid, path: fwdPath };
      if (isRigged) {
        msg.isRigged = true;
        msg.jointNames = jointNames;
        if (jointOverrides && jointOverrides.length > 0) {
          msg.jointOverrides = jointOverrides;
        }
      }
      if (jointOverrides && jointOverrides.length > 0) {
        console.log(`[MeshReady] meshId=${meshUuid.slice(0, 8)} jointOverrides=${jointOverrides.length}`);
      }
      if (this.objectSender.selfMeshIds.has(meshUuid)) {
        console.log(`[SelfAvatar] Mesh ready: meshId=${meshUuid.slice(0, 8)} isRigged=${isRigged} joints=${jointNames?.length ?? 0} overrides=${jointOverrides?.length ?? 0}`);
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
      console.log(`[Animesh] animation_ready: ${animUuid.slice(0, 8)} (${data.joints.length} joints, ${data.duration.toFixed(1)}s, loop=${data.loop}, pri=${data.priority ?? '?'})`);
      this.animationManager.checkAnimBatchReady(animUuid);
    });

    // Wire fetch queues to sub-modules
    this.materialPipeline.initQueues(materialFetchQueue, this.textureFetchQueue);
    this.animationManager.initFetchQueue(animationFetchQueue);
    this.avatarManager.initBom(this.materialPipeline, this.textureFetchQueue);

    this.environmentMgr = new GodotEnvironmentManager(this.bot, (msg) => this.send(msg));

    this.updateCoalescer = new GodotUpdateCoalescer({
      isTracked: (id) => this.trackedObjects.has(id),
      isAvatarTracked: (id) => this.trackedAvatars.has(id),
      getLightInfo: (obj) => this.objectSender.getLightInfo(obj),
      send: (msg) => this.send(msg),
      resendObject: (obj) => {
        this.objectSender.sendObject(obj, obj.ParentID ?? 0);
        this.objectSender.sendChildren(obj);
      },
    });

    this.objectSender.initQueues(meshFetchQueue, sculptFetchQueue, this.textureFetchQueue, this.updateCoalescer);

    // Send initial snapshot and subscribe to events
    this.objectSender.sendInitialSnapshot((avatar, id) => this.avatarManager.sendAvatarCreate(avatar, id));
    this.subscribeToEvents();

    // Replay sitting state if we were seated before Godot restarted
    const sitState = this.inputHandler.getSitState();
    if (sitState.seatLocalId > 0 && sitState.position && sitState.rotation) {
      this.send({ type: 'sitting_state', sitting: true });
      const selfId = this.bot.agent?.agentID?.toString();
      if (selfId) {
        this.send({
          type: 'avatar_update',
          id: selfId,
          position: sitState.position,
          rotation: sitState.rotation,
          parentId: sitState.seatLocalId,
        });
      }
      console.log(`[GodotBridge] Replayed sitting state on reconnect: seatLocalId=${sitState.seatLocalId}`);
    }

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
      case 'stand_up':
        this.inputHandler.handleStandUp();
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

    // Self-avatar sit detection via AvatarSitResponse (onObjectUpdatedEvent is not fired
    // for avatars when ParentID > 0, so we must use the circuit message directly).
    // Standing is detected via onObjectUpdatedEvent which DOES fire when ParentID → 0.
    let selfAvatarSeatLocalId = 0;

    const circuit = this.bot.currentRegion?.circuit;
    if (circuit) {
      const sitResponseSub = circuit.subscribeToMessages([Message.AvatarSitResponse], (packet: any) => {
        try {
          const msg = packet.message;
          const seatUuid: string = msg.SitObject.ID.toString();
          const sitPos = msg.SitTransform.SitPosition;
          const sitRot = msg.SitTransform.SitRotation;

          const region = this.bot.currentRegion;
          if (!region) return;

          let seatLocalId = 0;
          try {
            seatLocalId = region.objects.getObjectByUUID(seatUuid as any).ID;
          } catch {
            console.warn(`[GodotBridge] AvatarSitResponse: seat ${seatUuid.slice(0, 8)} not in object store`);
            return;
          }

          selfAvatarSeatLocalId = seatLocalId;
          this.inputHandler.setSittingState(
            true, seatLocalId,
            [sitPos.x, sitPos.y, sitPos.z],
            [sitRot.x, sitRot.y, sitRot.z, sitRot.w],
          );
          this.send({ type: 'sitting_state', sitting: true });

          // Push avatar into the correct seated position immediately.
          const selfId = this.bot.agent?.agentID?.toString();
          if (selfId) {
            this.send({
              type: 'avatar_update',
              id: selfId,
              position: [sitPos.x, sitPos.y, sitPos.z],
              rotation: [sitRot.x, sitRot.y, sitRot.z, sitRot.w],
              parentId: seatLocalId,
            });
          }
          console.log(`[GodotBridge] AvatarSitResponse: seated on ${seatUuid.slice(0, 8)} localId=${seatLocalId} offset=(${sitPos.x.toFixed(2)},${sitPos.y.toFixed(2)},${sitPos.z.toFixed(2)})`);
        } catch (e) {
          console.error('[GodotBridge] AvatarSitResponse handler error:', e);
        }
      });
      this.subscriptions.push(sitResponseSub);
    }

    // Standing detection: onObjectUpdatedEvent DOES fire for the avatar when ParentID → 0.
    const selfStandSub = events.onObjectUpdatedEvent.subscribe((event: any) => {
      const obj = event.object;
      if (obj.PCode !== 47) return;
      const avatarId = obj.FullID?.toString();
      if (!avatarId) return;
      const selfId = this.bot.agent?.agentID?.toString();
      if (!selfId || avatarId !== selfId) return;
      if ((obj.ParentID || 0) !== 0 || selfAvatarSeatLocalId === 0) return;

      selfAvatarSeatLocalId = 0;
      this.inputHandler.setSittingState(false, 0);
      this.send({ type: 'sitting_state', sitting: false });
      console.log('[GodotBridge] Self avatar stood up (ParentID → 0)');
    });
    this.subscriptions.push(selfStandSub);

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
