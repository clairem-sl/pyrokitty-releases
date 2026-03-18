/**
 * Handles sending objects to Godot — serialization, initial snapshot,
 * children, sweeps, and deferred texture promotion.
 */

import type { Bot } from '../../node-metaverse/dist/lib';
import { SculptType } from '../../node-metaverse/dist/lib';
import type { Subscription } from 'rxjs';
import { sculptMeshId } from './sculpt-converter';
import type { MeshFetchQueue } from './mesh-fetch-queue';
import type { TextureFetchQueue } from './texture-fetch-queue';
import type { SculptFetchQueue } from './sculpt-fetch-queue';
import type { GodotUpdateCoalescer } from './godot-update-coalescer';
import type { GodotMaterialPipeline } from './godot-material-pipeline';
import type { GodotAnimationManager } from './godot-animation-manager';
import type { GodotAvatarManager } from './godot-avatar-manager';
import type { SendFn } from './godot-bridge-types';
import { isHudAttachment, BAKE_MAGIC_UUIDS, ZERO_UUID, slPos, slQuat, slScale } from './godot-bridge-types';
import type { ObjectReadinessTracker } from './object-readiness-tracker';

export class GodotObjectSender {
  private deferredTextures = new Map<number, any>();
  /** Children waiting for their parent to be tracked before sending */
  private pendingChildren = new Map<number, { obj: any; parentLocalId: number }[]>();
  private textureUpdateSubs = new Map<number, Subscription>();
  private get TEXTURE_FETCH_RANGE(): number { return this.bot.agent?.cameraFar ?? 128; }

  private meshFetchQueue: MeshFetchQueue | null = null;
  private sculptFetchQueue: SculptFetchQueue | null = null;
  private textureFetchQueue: TextureFetchQueue | null = null;
  private updateCoalescer: GodotUpdateCoalescer | null = null;
  private avatarManager: GodotAvatarManager | null = null;
  private readinessTracker: ObjectReadinessTracker | null = null;

  // Self-avatar tracking for [SelfAvatar] logging
  selfAvatarLocalId: number = 0;
  readonly selfAttachmentIds = new Set<number>();
  readonly selfMeshIds = new Set<string>();
  readonly selfTextureIds = new Set<string>();

  constructor(
    private bot: Bot,
    private send: SendFn,
    private trackedObjects: Set<number>,
    private avatarLocalIds: Map<string, number>,
    private materialPipeline: GodotMaterialPipeline,
    private animationManager: GodotAnimationManager,
  ) { }

  /** Late-bind avatar manager to break circular dependency */
  setAvatarManager(mgr: GodotAvatarManager): void {
    this.avatarManager = mgr;
  }

  initQueues(
    meshFetchQueue: MeshFetchQueue,
    sculptFetchQueue: SculptFetchQueue,
    textureFetchQueue: TextureFetchQueue,
    updateCoalescer: GodotUpdateCoalescer,
  ): void {
    this.meshFetchQueue = meshFetchQueue;
    this.sculptFetchQueue = sculptFetchQueue;
    this.textureFetchQueue = textureFetchQueue;
    this.updateCoalescer = updateCoalescer;
  }

  setReadinessTracker(tracker: ObjectReadinessTracker): void {
    this.readinessTracker = tracker;
  }

  /** Build the object_complete message for an object */
  private buildCompleteMsg(obj: any, meshId: string | undefined, sculptInfo: ReturnType<GodotObjectSender['getSculptInfo']>, texInfo: any): any {
    const sculpt_meshId = sculptInfo ? sculptMeshId(sculptInfo.textureUuid, sculptInfo.sculptType) : undefined;
    const effectiveMeshId = meshId || sculpt_meshId || undefined;
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
    return {
      type: 'object_complete',
      localId: obj.ID,
      ...(effectiveMeshId ? { meshId: effectiveMeshId } : {}),
      ...(shapeParams ? { shape: shapeParams } : {}),
      ...(texInfo ? { faces: texInfo.faces } : {}),
    };
  }

  /** Returns mesh asset UUID if obj is a mesh, else undefined */
  getMeshId(obj: any): string | undefined {
    const md = obj.extraParams?.meshData;
    if (md && md.type === SculptType.Mesh) {
      return md.meshData?.toString();
    }
    return undefined;
  }

  /** Returns light info if obj has a light source, else undefined */
  getLightInfo(obj: any): {
    color: number[]; intensity: number; radius: number; falloff: number; cutoff: number;
    isSpot?: boolean; spotFov?: number; spotFocus?: number; spotAmbiance?: number; projTexture?: string;
  } | undefined {
    const ld = obj.extraParams?.lightData;
    if (!ld || ld.Intensity <= 0) return undefined;
    const ZERO = '00000000-0000-0000-0000-000000000000';
    const lid = obj.extraParams?.lightImageData;
    const projTex = lid?.texture?.toString();
    const isSpot = !!(projTex && projTex !== ZERO);
    return {
      color: [ld.Color.getRed(), ld.Color.getGreen(), ld.Color.getBlue()],
      intensity: ld.Intensity,
      radius: ld.Radius,
      falloff: ld.Falloff,
      cutoff: ld.Cutoff,
      ...(isSpot ? {
        isSpot: true,
        spotFov: lid!.params.x,
        spotFocus: lid!.params.y,
        spotAmbiance: lid!.params.z,
        projTexture: projTex!,
      } : {}),
    };
  }

  /** Returns sculpt texture UUID and type flags if obj is a sculpted prim, else undefined */
  getSculptInfo(obj: any): { textureUuid: string; sculptType: number } | undefined {
    const sd = obj.extraParams?.sculptData;
    if (!sd) return undefined;
    const baseType = sd.type & 0x07;
    if (baseType < SculptType.Sphere || baseType > SculptType.Cylinder) return undefined;
    const textureUuid = sd.texture?.toString();
    if (!textureUuid || textureUuid === '00000000-0000-0000-0000-000000000000') return undefined;
    return { textureUuid, sculptType: sd.type };
  }

  /** Get the bot avatar's current global position, or null if unavailable */
  getBotPosition(): { x: number; y: number; z: number; distance(other: any): number } | null {
    const agentId = this.bot.agent.agentID?.toString();
    const agents = this.bot.currentRegion?.agents;
    if (!agentId || !agents) return null;
    const me = agents.get(agentId);
    return me?.position ?? null;
  }

  /** Get global position for a root prim (ParentID === 0). Returns null for children. */
  getGlobalPosition(obj: any): { x: number; y: number; z: number; distance(other: any): number } | null {
    const pos = obj.Position;
    if (!pos) return null;
    if (obj.ParentID && obj.ParentID !== 0) return null;
    return pos;
  }

  /** Send a single object to Godot with optional parentId */
  sendObject(obj: any, parentLocalId: number): void {
    if (this.trackedObjects.has(obj.ID)) return;
    const pos = obj.Position;
    if (!pos) return;

    // Buffer children whose parent hasn't been sent yet
    if (parentLocalId > 0 && !this.trackedObjects.has(parentLocalId)) {
      // Avatar localIds are always valid parents (tracked separately)
      let isAvatarParent = false;
      for (const [, lid] of this.avatarLocalIds) { if (lid === parentLocalId) { isAvatarParent = true; break; } }
      if (!isAvatarParent) {
        let buf = this.pendingChildren.get(parentLocalId);
        if (!buf) {
          buf = [];
          this.pendingChildren.set(parentLocalId, buf);
        }
        buf.push({ obj, parentLocalId });
        return;
      }
    }

    const rot = obj.Rotation;
    const scl = obj.Scale;
    const meshId = this.getMeshId(obj);
    const sculptInfo = this.getSculptInfo(obj);
    const texInfo = this.materialPipeline.getTextureInfo(obj);

    // BoM: substitute magic bake UUIDs with actual baked textures for avatar attachments
    if (texInfo && parentLocalId > 0 && this.avatarManager) {
      const avatarId = this.avatarManager.findOwnerAvatar(parentLocalId);
      if (avatarId) {
        let hasBakeUuids = false;
        for (const face of texInfo.faces) {
          if (BAKE_MAGIC_UUIDS.has(face.textureId)) {
            hasBakeUuids = true;
            break;
          }
        }
        if (hasBakeUuids) {
          // Track this object for re-emit when bakes arrive/change
          this.avatarManager.trackBakeObject(avatarId, obj.ID);

          const bakes = this.avatarManager.getBakedTextures(avatarId);
          if (bakes) {
            for (const face of texInfo.faces) {
              const channel = BAKE_MAGIC_UUIDS.get(face.textureId);
              if (channel !== undefined) {
                const bakedUuid = bakes[channel];
                if (bakedUuid && bakedUuid !== ZERO_UUID) {
                  face.textureId = bakedUuid;
                  face._isBake = true;
                  face._bakeAvatarUuid = avatarId;
                  face._bakeChannel = channel;
                }
              }
            }
            // Rebuild textureIds after substitution
            const idSet = new Set<string>();
            for (const face of texInfo.faces) {
              idSet.add(face.textureId);
              if (face.normalTextureId) idSet.add(face.normalTextureId);
              if (face.ormTextureId) idSet.add(face.ormTextureId);
              if (face.emissiveTextureId) idSet.add(face.emissiveTextureId);
            }
            texInfo.textureIds = Array.from(idSet);
          }
        }
      }
    }

    const lightInfo = this.getLightInfo(obj);

    const isAnimesh = !!(obj.extraParams?.extendedMeshData?.flags & 0x1);
    const objUuid = obj.FullID?.toString() || '';

    // Log avatar attachments
    const isSelfAttach = parentLocalId > 0 && parentLocalId === this.selfAvatarLocalId;
    if (parentLocalId > 0) {
      let isAvatarAttach = isSelfAttach;
      if (!isAvatarAttach) {
        for (const [, lid] of this.avatarLocalIds) { if (lid === parentLocalId) { isAvatarAttach = true; break; } }
      }
      if (isAvatarAttach) {
        console.log(`[AvatarDebug] Sending attachment: localId=${obj.ID} meshId=${meshId?.slice(0, 8) || 'none'} parentId=${parentLocalId} isAnimesh=${isAnimesh} uuid=${objUuid.slice(0, 8)}`);
      }
    }

    // Track self-avatar attachments for [SelfAvatar] logging
    if (isSelfAttach) {
      this.selfAttachmentIds.add(obj.ID);
      const faceCount = texInfo?.faces?.length ?? 0;
      const texCount = texInfo?.textureIds?.length ?? 0;
      console.log(`[SelfAvatar] Attachment: localId=${obj.ID} uuid=${objUuid.slice(0, 8)} meshId=${meshId?.slice(0, 8) || 'none'} isAnimesh=${isAnimesh} faces=${faceCount} textures=${texCount}`);
      if (meshId) this.selfMeshIds.add(meshId);
      if (texInfo) {
        for (const tid of texInfo.textureIds) this.selfTextureIds.add(tid);
      }
    }

    if (isAnimesh) {
      console.log(`[Animesh] Detected animesh object localId=${obj.ID} uuid=${objUuid} meshId=${meshId || 'none'} parentId=${parentLocalId}`);
    }

    // Distance gate: defer asset fetching for far root prims.
    // Only roots are gated — child positions are relative and rotation-dependent,
    // so their true world distance can't be computed without full transform math.
    let skipAssets = false;
    if (parentLocalId === 0) {
      try {
        const botPos = this.getBotPosition();
        if (botPos) {
          const globalPos = this.getGlobalPosition(obj);
          if (globalPos) {
            const dist = globalPos.distance(botPos);
            if (dist > this.TEXTURE_FETCH_RANGE) {
              skipAssets = true;
              this.deferredTextures.set(obj.ID, obj);
            }
          }
        }
      } catch { /* bot may not be fully connected yet */ }
    }

    // Phase 1: lightweight object_create with spatial info only
    this.send({
      type: 'object_create',
      localId: obj.ID,
      uuid: objUuid,
      parentId: parentLocalId,
      position: slPos(pos),
      rotation: rot ? slQuat(rot) : [0, 0, 0, 1],
      scale: scl ? slScale(scl) : [0.5, 0.5, 0.5],
      ...(lightInfo ? { light: lightInfo } : {}),
      ...(isAnimesh ? { animesh: true } : {}),
      ...(sculptInfo ? { sculpt: true } : {}),
      ...(obj.attachmentPoint > 0 ? { attachmentPoint: obj.attachmentPoint } : {}),
    });

    // Phase 2: build and track object_complete (skip deferred — tracked on promotion)
    if (!skipAssets) {
      const completeMsg = this.buildCompleteMsg(obj, meshId, sculptInfo, texInfo);
      const effectiveMeshId = completeMsg.meshId || undefined;
      if (this.readinessTracker) {
        this.readinessTracker.track(obj.ID, effectiveMeshId || null, new Set(), completeMsg);
      } else {
        this.send(completeMsg);
      }
    }
    if (lightInfo) {
      this.updateCoalescer?.trackLight(obj.ID);
    }
    this.updateCoalescer?.trackAnimesh(obj.ID, isAnimesh);
    if (isAnimesh && objUuid) {
      this.animationManager.registerAnimeshObject(objUuid, obj.ID);
      const buffered = this.animationManager.getBufferedObjectAnims(objUuid);
      if (buffered && buffered.length > 0) {
        console.log(`[Animesh] Replaying ${buffered.length} buffered animations for ${objUuid.slice(0, 8)} localId=${obj.ID}: ${buffered.map(a => a.animId.slice(0, 8)).join(', ')}`);
        this.animationManager.updateAnimSet(obj.ID, buffered.map(a => a.animId));
      } else {
        console.log(`[Animesh] No buffered animations for ${objUuid.slice(0, 8)} localId=${obj.ID} (ObjectAnimation not yet received)`);
      }
    }
    this.trackedObjects.add(obj.ID);

    // Flush any children that were waiting for this parent
    const waiting = this.pendingChildren.get(obj.ID);
    if (waiting) {
      this.pendingChildren.delete(obj.ID);
      for (const { obj: childObj, parentLocalId: childParent } of waiting) {
        this.sendObject(childObj, childParent);
      }
    }

    // Subscribe to live texture changes
    if (obj.onTextureUpdate) {
      const texSub = obj.onTextureUpdate.subscribe(() => this.materialPipeline.handleObjectTextureUpdate(obj));
      this.textureUpdateSubs.set(obj.ID, texSub);
    }

    if (!skipAssets) {
      if (meshId && this.meshFetchQueue) {
        this.meshFetchQueue.request(meshId, obj.ID);
      }
      if (sculptInfo && this.sculptFetchQueue) {
        this.sculptFetchQueue.request(sculptInfo.textureUuid, sculptInfo.sculptType, obj.ID);
      }
      if (lightInfo?.isSpot && lightInfo.projTexture && this.textureFetchQueue) {
        console.log(`[GodotBridge] Requesting proj texture ${lightInfo.projTexture} for localId=${obj.ID}`);
        this.textureFetchQueue.request(lightInfo.projTexture, obj.ID);
      }
      this.materialPipeline.fetchTexturesForObject(obj, texInfo);
    }
  }

  /** Recursively send children of a root/parent object */
  sendChildren(obj: any): void {
    try {
      const children = this.bot.currentRegion.objects.getObjectsByParent(obj.ID);
      for (const child of children) {
        if (child.PCode === 47) continue;
        if (isHudAttachment(child)) continue;
        this.sendObject(child, obj.ID);
        this.sendChildren(child);
      }
    } catch { /* */ }
  }

  /** Send initial snapshot of all objects and avatars */
  sendInitialSnapshot(sendAvatarCreate: (avatar: any, id: string) => void): void {
    try {
      const region = this.bot.currentRegion;

      // Send initial avatars
      const agents = region.agents;
      for (const [id, avatar] of agents) {
        sendAvatarCreate(avatar, id);
      }
      console.log(`[GodotBridge] Sent ${agents.size} initial avatars`);

      const objectStore = region.objects;
      const queue: { obj: any; parentId: number }[] = [];
      const collected = new Set<number>();
      const collect = (obj: any, parentId: number) => {
        if (obj.PCode === 47) return;
        if (isHudAttachment(obj)) return;
        if (this.trackedObjects.has(obj.ID)) return;
        if (collected.has(obj.ID)) return;
        collected.add(obj.ID);
        queue.push({ obj, parentId });
        // Collect children from object store (obj.children may not be populated)
        try {
          const children = objectStore.getObjectsByParent(obj.ID);
          for (const child of children) {
            collect(child, obj.ID);
          }
        } catch { /* */ }
      };

      // Iterate ALL objects in the store — getAllObjects filters too aggressively
      objectStore.forEachObject((obj: any) => {
        collect(obj, obj.ParentID || 0);
      });

      // Throttled batching: 50 objects every 100ms to avoid overwhelming Godot
      // during cold start (Vulkan resource creation, skeleton setup, etc.)
      const BATCH_SIZE = 50;
      const BATCH_INTERVAL_MS = 100;
      console.log(`[GodotBridge] Initial snapshot: queued ${queue.length} objects`);

      let offset = 0;
      const sendNextBatch = () => {
        const end = Math.min(offset + BATCH_SIZE, queue.length);
        for (let i = offset; i < end; i++) {
          this.sendObject(queue[i].obj, queue[i].parentId);
        }
        offset = end;
        if (offset < queue.length) {
          setTimeout(sendNextBatch, BATCH_INTERVAL_MS);
        } else {
          console.log(`[GodotBridge] Initial snapshot complete: ${queue.length} objects`);
        }
      };
      sendNextBatch();
    } catch (err) {
      console.error('[GodotBridge] Error sending initial snapshot:', err);
    }
  }

  /** Sweep for deleted objects */
  sweepDeletedObjects(): void {
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
            this.animationManager.cleanupLocalId(localId);
            this.avatarManager?.removeBakeObject(localId);
            this.readinessTracker?.remove(localId);
          }
        } catch {
          this.send({ type: 'object_kill', localId });
          this.trackedObjects.delete(localId);
          this.textureUpdateSubs.get(localId)?.unsubscribe();
          this.textureUpdateSubs.delete(localId);
          this.animationManager.cleanupLocalId(localId);
          this.avatarManager?.removeBakeObject(localId);
          this.readinessTracker?.remove(localId);
        }
      }
    } catch { /* bot may be disconnected */ }
  }

  /** Promote deferred textures for objects now within fetch range */
  sweepDeferredTextures(): void {
    if (this.deferredTextures.size === 0) return;
    try {
      const botPos = this.getBotPosition();
      if (!botPos) return;

      const objectStore = this.bot.currentRegion.objects;
      let promoted = 0;

      for (const [localId, _obj] of this.deferredTextures) {
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
        if (!globalPos) {
          continue;
        }
        const dist = globalPos.distance(botPos);
        if (dist <= this.TEXTURE_FETCH_RANGE) {
          this.deferredTextures.delete(localId);
          const texInfo = this.materialPipeline.getTextureInfo(live);

          // Request mesh and sculpt (deferred at sendObject time)
          const liveMeshId = this.getMeshId(live);
          const liveSculptInfo = this.getSculptInfo(live);
          if (liveMeshId && this.meshFetchQueue) {
            this.meshFetchQueue.request(liveMeshId, localId);
          }
          if (liveSculptInfo && this.sculptFetchQueue) {
            this.sculptFetchQueue.request(liveSculptInfo.textureUuid, liveSculptInfo.sculptType, localId);
          }
          this.materialPipeline.fetchTexturesForObject(live, texInfo);

          // Build object_complete and register with readiness tracker (was skipped at sendObject time)
          const completeMsg = this.buildCompleteMsg(live, liveMeshId, liveSculptInfo, texInfo);
          const effectiveMeshId = completeMsg.meshId || undefined;
          if (this.readinessTracker) {
            this.readinessTracker.track(localId, effectiveMeshId || null, new Set(), completeMsg);
          } else {
            this.send(completeMsg);
          }

          promoted++;
        }
      }

      if (promoted > 0) {
        console.log(`[GodotBridge] Deferred sweep: promoted=${promoted} remaining=${this.deferredTextures.size}`);
      }
    } catch { /* bot may be disconnected */ }
  }

  get deferredCount(): number {
    return this.deferredTextures.size;
  }

  get readinessPendingCount(): number {
    return this.readinessTracker?.pendingCount ?? 0;
  }

  /** Light reset for region change — clear tracking but keep queues alive */
  clearForRegionChange(): void {
    for (const sub of this.textureUpdateSubs.values()) {
      sub.unsubscribe();
    }
    this.textureUpdateSubs.clear();
    this.deferredTextures.clear();
    this.pendingChildren.clear();
    this.meshFetchQueue?.clearPending();
    this.sculptFetchQueue?.clearPending();
    this.readinessTracker?.clearAll();
  }

  cleanup(): void {
    for (const sub of this.textureUpdateSubs.values()) {
      sub.unsubscribe();
    }
    this.textureUpdateSubs.clear();
    this.deferredTextures.clear();
    this.pendingChildren.clear();
    if (this.meshFetchQueue) {
      this.meshFetchQueue.destroy();
      this.meshFetchQueue = null;
    }
    if (this.sculptFetchQueue) {
      this.sculptFetchQueue.destroy();
      this.sculptFetchQueue = null;
    }
  }
}
