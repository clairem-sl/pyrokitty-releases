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
  private deferredTextures = new Map<string, any>();
  /** Children waiting for their parent to be tracked before sending */
  private pendingChildren = new Map<string, { obj: any; parentUuid: string }[]>();
  private textureUpdateSubs = new Map<string, Subscription>();
  private get TEXTURE_FETCH_RANGE(): number { return this.bot.agent?.cameraFar ?? 128; }

  private meshFetchQueue: MeshFetchQueue | null = null;
  private sculptFetchQueue: SculptFetchQueue | null = null;
  private textureFetchQueue: TextureFetchQueue | null = null;
  private updateCoalescer: GodotUpdateCoalescer | null = null;
  private avatarManager: GodotAvatarManager | null = null;
  private readinessTracker: ObjectReadinessTracker | null = null;

  // Self-avatar tracking for [SelfAvatar] logging
  selfAvatarUuid: string = '';
  readonly selfAttachmentIds = new Set<string>();
  readonly selfMeshIds = new Set<string>();
  readonly selfTextureIds = new Set<string>();

  constructor(
    private bot: Bot,
    private send: SendFn,
    private trackedObjects: Set<string>,
    private trackedAvatars: Set<string>,
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
      uuid: obj.FullID?.toString() || '',
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

  /** Get world position for a root prim, accounting for region offset. Returns null for children. */
  getWorldPosition(obj: any): { x: number; y: number; z: number } | null {
    const pos = obj.Position;
    if (!pos) return null;
    if (obj.ParentID && obj.ParentID !== 0) return null;
    // Add region offset relative to main region
    const objRegion = obj.region;
    const mainRegion = this.bot.currentRegion;
    if (objRegion && mainRegion) {
      const dx = ((objRegion.xCoordinate ?? 0) - (mainRegion.xCoordinate ?? 0)) * 256;
      const dy = ((objRegion.yCoordinate ?? 0) - (mainRegion.yCoordinate ?? 0)) * 256;
      return { x: pos.x + dx, y: pos.y + dy, z: pos.z };
    }
    return pos;
  }

  /** Send a single object to Godot with optional parentUuid */
  sendObject(obj: any, parentUuid: string): void {
    const objUuid = obj.FullID?.toString() || '';
    if (this.trackedObjects.has(objUuid)) return;
    const pos = obj.Position;
    if (!pos) return;

    // Buffer children whose parent hasn't been sent yet
    if (parentUuid !== '' && !this.trackedObjects.has(parentUuid)) {
      // Avatar UUIDs are always valid parents (tracked separately)
      if (!this.trackedAvatars.has(parentUuid)) {
        let buf = this.pendingChildren.get(parentUuid);
        if (!buf) {
          buf = [];
          this.pendingChildren.set(parentUuid, buf);
        }
        buf.push({ obj, parentUuid });
        return;
      }
    }

    const rot = obj.Rotation;
    const scl = obj.Scale;
    const meshId = this.getMeshId(obj);
    const sculptInfo = this.getSculptInfo(obj);
    const texInfo = this.materialPipeline.getTextureInfo(obj);
    if (!texInfo) {
      const te = obj.TextureEntry;
      console.warn(`[ObjectSender] No texInfo for ${objUuid.slice(0, 8)}: TextureEntry=${te ? 'present' : 'null'}, defaultTexture=${te?.defaultTexture ? 'present' : 'null'}`);
    }

    // BoM: substitute magic bake UUIDs with actual baked textures for avatar attachments
    if (texInfo && parentUuid !== '' && this.avatarManager) {
      const avatarId = this.avatarManager.findOwnerAvatar(parentUuid);
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
          this.avatarManager.trackBakeObject(avatarId, objUuid);

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

    // Log avatar attachments
    const isSelfAttach = parentUuid !== '' && parentUuid === this.selfAvatarUuid;
    if (parentUuid !== '') {
      let isAvatarAttach = isSelfAttach || this.trackedAvatars.has(parentUuid);
      if (isAvatarAttach) {
        console.log(`[AvatarDebug] Sending attachment: uuid=${objUuid.slice(0, 8)} meshId=${meshId?.slice(0, 8) || 'none'} parentUuid=${parentUuid.slice(0, 8)} isAnimesh=${isAnimesh}`);
      }
    }

    // Track self-avatar attachments for [SelfAvatar] logging
    if (isSelfAttach) {
      this.selfAttachmentIds.add(objUuid);
      const faceCount = texInfo?.faces?.length ?? 0;
      const texCount = texInfo?.textureIds?.length ?? 0;
      console.log(`[SelfAvatar] Attachment: uuid=${objUuid.slice(0, 8)} meshId=${meshId?.slice(0, 8) || 'none'} isAnimesh=${isAnimesh} faces=${faceCount} textures=${texCount}`);
      if (meshId) this.selfMeshIds.add(meshId);
      if (texInfo) {
        for (const tid of texInfo.textureIds) this.selfTextureIds.add(tid);
      }
    }

    if (isAnimesh) {
      console.log(`[Animesh] Detected animesh object uuid=${objUuid} meshId=${meshId || 'none'} parentUuid=${parentUuid.slice(0, 8)}`);
    }

    // Distance gate: skip entirely for far root prims (no placeholder, no assets).
    // They stay in deferredTextures and get created when the bot moves closer.
    if (parentUuid === '') {
      try {
        const botPos = this.getBotPosition();
        if (botPos) {
          const worldPos = this.getWorldPosition(obj);
          if (worldPos) {
            const dx = worldPos.x - botPos.x, dy = worldPos.y - botPos.y, dz = worldPos.z - botPos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > this.TEXTURE_FETCH_RANGE) {
              this.deferredTextures.set(objUuid, obj);
              this.trackedObjects.add(objUuid);
              return;
            }
          }
        }
      } catch { /* bot may not be fully connected yet */ }
    }

    // Phase 1: lightweight object_create with spatial info only
    const regionCacheID = obj.region?.cacheID?.toString() ?? '';
    this.send({
      type: 'object_create',
      uuid: objUuid,
      parentUuid: parentUuid,
      cacheID: regionCacheID,
      position: slPos(pos),
      rotation: rot ? slQuat(rot) : [0, 0, 0, 1],
      scale: scl ? slScale(scl) : [0.5, 0.5, 0.5],
      ...(lightInfo ? { light: lightInfo } : {}),
      ...(isAnimesh ? { animesh: true } : {}),
      ...(sculptInfo ? { sculpt: true } : {}),
      ...(obj.attachmentPoint > 0 ? { attachmentPoint: obj.attachmentPoint } : {}),
    });

    // Phase 2: build and track object_complete
    const completeMsg = this.buildCompleteMsg(obj, meshId, sculptInfo, texInfo);
    const effectiveMeshId = completeMsg.meshId || undefined;
    if (this.readinessTracker) {
      this.readinessTracker.track(objUuid, effectiveMeshId || null, new Set(), completeMsg);
    } else {
      this.send(completeMsg);
    }
    if (lightInfo) {
      this.updateCoalescer?.trackLight(objUuid);
    }
    this.updateCoalescer?.trackAnimesh(objUuid, isAnimesh);
    if (isAnimesh && objUuid) {
      this.animationManager.registerAnimeshObject(objUuid);
      const buffered = this.animationManager.getBufferedObjectAnims(objUuid);
      if (buffered && buffered.length > 0) {
        console.log(`[Animesh] Replaying ${buffered.length} buffered animations for ${objUuid.slice(0, 8)}: ${buffered.map(a => a.animId.slice(0, 8)).join(', ')}`);
        this.animationManager.updateAnimSet(objUuid, buffered.map(a => a.animId));
      } else {
        console.log(`[Animesh] No buffered animations for ${objUuid.slice(0, 8)} (ObjectAnimation not yet received)`);
      }
    }
    this.trackedObjects.add(objUuid);

    // Flush any children that were waiting for this parent
    const waiting = this.pendingChildren.get(objUuid);
    if (waiting) {
      this.pendingChildren.delete(objUuid);
      for (const { obj: childObj, parentUuid: childParent } of waiting) {
        this.sendObject(childObj, childParent);
      }
    }

    // Subscribe to live texture changes
    if (obj.onTextureUpdate) {
      const texSub = obj.onTextureUpdate.subscribe(() => this.materialPipeline.handleObjectTextureUpdate(obj));
      this.textureUpdateSubs.set(objUuid, texSub);
    }

    if (meshId && this.meshFetchQueue) {
      this.meshFetchQueue.request(meshId, objUuid);
    }
    if (sculptInfo && this.sculptFetchQueue) {
      this.sculptFetchQueue.request(sculptInfo.textureUuid, sculptInfo.sculptType, objUuid);
    }
    if (lightInfo?.isSpot && lightInfo.projTexture && this.textureFetchQueue) {
      console.log(`[GodotBridge] Requesting proj texture ${lightInfo.projTexture} for uuid=${objUuid.slice(0, 8)}`);
      this.textureFetchQueue.request(lightInfo.projTexture, objUuid);
    }
    this.materialPipeline.fetchTexturesForObject(obj, texInfo);
  }

  /** Recursively send children of a root/parent object */
  sendChildren(obj: any): void {
    try {
      const children = this.bot.currentRegion.objects.getObjectsByParent(obj.ID);
      const parentUuid = obj.FullID?.toString() || '';
      for (const child of children) {
        if (child.PCode === 47) continue;
        if (isHudAttachment(child)) continue;
        this.sendObject(child, parentUuid);
        this.sendChildren(child);
      }
    } catch { /* */ }
  }

  /** Send initial snapshot of all objects and avatars */
  sendInitialSnapshot(sendAvatarCreate: (avatar: any, id: string) => void, allRegions?: any[]): void {
    try {
      const regions = allRegions ?? [this.bot.currentRegion];

      // Send initial avatars from all regions
      let totalAvatars = 0;
      for (const region of regions) {
        const agents = region.agents;
        for (const [id, avatar] of agents) {
          sendAvatarCreate(avatar, id);
        }
        totalAvatars += agents.size;
      }
      console.log(`[GodotBridge] Sent ${totalAvatars} initial avatars from ${regions.length} region(s)`);

      const queue: { obj: any; parentUuid: string }[] = [];
      const collected = new Set<string>();

      for (const region of regions) {
        const objectStore = region.objects;
        const collect = (obj: any, parentUuid: string) => {
          if (obj.PCode === 47) return;
          if (isHudAttachment(obj)) return;
          const objUuid = obj.FullID?.toString() || '';
          if (this.trackedObjects.has(objUuid)) return;
          if (collected.has(objUuid)) return;
          collected.add(objUuid);
          queue.push({ obj, parentUuid });
          // Collect children from object store (obj.children may not be populated)
          try {
            const children = objectStore.getObjectsByParent(obj.ID);
            for (const child of children) {
              collect(child, objUuid);
            }
          } catch { /* */ }
        };

        // Iterate ALL objects in the store
        objectStore.forEachObject((obj: any) => {
          let parentUuid = '';
          if (obj.ParentID && obj.ParentID !== 0) {
            try {
              const parent = objectStore.getObjectByLocalID(obj.ParentID);
              parentUuid = parent?.FullID?.toString() || '';
            } catch { /* */ }
          }
          collect(obj, parentUuid);
        });
      }

      // Throttled batching: 50 objects every 100ms to avoid overwhelming Godot
      // during cold start (Vulkan resource creation, skeleton setup, etc.)
      const BATCH_SIZE = 50;
      const BATCH_INTERVAL_MS = 100;
      console.log(`[GodotBridge] Initial snapshot: queued ${queue.length} objects`);

      let offset = 0;
      const sendNextBatch = () => {
        const end = Math.min(offset + BATCH_SIZE, queue.length);
        for (let i = offset; i < end; i++) {
          this.sendObject(queue[i].obj, queue[i].parentUuid);
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

  /** Find an object by UUID across all regions (main + children). */
  private findObjectByUUID(uuid: string): any {
    try {
      const obj = this.bot.currentRegion?.objects?.getObjectByUUID(uuid as any);
      if (obj) return obj;
    } catch { /* */ }
    for (const childRegion of this.bot.childAgentManager?.getChildRegions() ?? []) {
      try {
        const obj = childRegion.objects?.getObjectByUUID(uuid as any);
        if (obj) return obj;
      } catch { /* */ }
    }
    return null;
  }

  /** Sweep for deleted objects */
  sweepDeletedObjects(): void {
    try {
      for (const uuid of this.trackedObjects) {
        const obj = this.findObjectByUUID(uuid);
        if (!obj || obj.deleted) {
          this.send({ type: 'object_kill', uuid });
          this.trackedObjects.delete(uuid);
          this.textureUpdateSubs.get(uuid)?.unsubscribe();
          this.textureUpdateSubs.delete(uuid);
          this.animationManager.cleanupUuid(uuid);
          this.avatarManager?.removeBakeObject(uuid);
          this.readinessTracker?.remove(uuid);
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

      let promoted = 0;

      for (const [uuid, _obj] of this.deferredTextures) {
        const live = this.findObjectByUUID(uuid);
        if (!live || live.deleted) {
          this.deferredTextures.delete(uuid);
          continue;
        }

        const worldPos = this.getWorldPosition(live);
        if (!worldPos) {
          continue;
        }
        const dx = worldPos.x - botPos.x, dy = worldPos.y - botPos.y, dz = worldPos.z - botPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist <= this.TEXTURE_FETCH_RANGE) {
          this.deferredTextures.delete(uuid);
          // Remove from tracked so sendObject doesn't skip it as duplicate
          this.trackedObjects.delete(uuid);
          // Full send — deferred objects are always roots (parentUuid = '')
          this.sendObject(live, '');
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
