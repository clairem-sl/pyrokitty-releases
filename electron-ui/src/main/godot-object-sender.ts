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
  private textureUpdateSubs = new Map<number, Subscription>();
  private readonly TEXTURE_FETCH_RANGE = 160;

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

  /** Get global position for any object (walks full parent chain for nested children) */
  getGlobalPosition(obj: any, depth = 0): { x: number; y: number; z: number; distance(other: any): number } | null {
    const pos = obj.Position;
    if (!pos) return null;
    if (!obj.ParentID || obj.ParentID === 0) return pos;
    if (depth > 4) return null; // Safety: prevent infinite loops
    try {
      const parent = this.bot.currentRegion.objects.getObjectByLocalID(obj.ParentID);
      if (!parent) return null;
      const pp = this.getGlobalPosition(parent, depth + 1);
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
    return null;
  }

  /** Send a single object to Godot with optional parentId */
  sendObject(obj: any, parentLocalId: number): void {
    const pos = obj.Position;
    if (!pos) return;

    const rot = obj.Rotation;
    const scl = obj.Scale;
    const meshId = this.getMeshId(obj);
    const sculptInfo = this.getSculptInfo(obj);
    const sculpt_meshId = sculptInfo ? sculptMeshId(sculptInfo.textureUuid, sculptInfo.sculptType) : undefined;
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

    // Distance gate: determine if textures should be deferred for far objects
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
    } catch { /* bot may not be fully connected yet */ }

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
      ...(obj.attachmentPoint > 0 ? { attachmentPoint: obj.attachmentPoint } : {}),
    });

    // Phase 2: build full message for deferred object_complete
    const effectiveMeshId = meshId || sculpt_meshId || undefined;
    const completeMsg: any = {
      type: 'object_complete',
      localId: obj.ID,
      ...(effectiveMeshId ? { meshId: effectiveMeshId } : {}),
      ...(shapeParams ? { shape: shapeParams } : {}),
      ...(texInfo ? { faces: texInfo.faces } : {}),
    };

    // Collect texture IDs for readiness tracking
    const textureIds = new Set<string>();
    if (texInfo && !skipTextures) {
      for (const face of texInfo.faces) {
        if (face.textureId && face.textureId !== ZERO_UUID) textureIds.add(face.textureId);
        if (face.normalTextureId) textureIds.add(face.normalTextureId);
        if (face.ormTextureId) textureIds.add(face.ormTextureId);
        if (face.emissiveTextureId) textureIds.add(face.emissiveTextureId);
      }
    }

    // Register with readiness tracker
    if (this.readinessTracker) {
      this.readinessTracker.track(obj.ID, effectiveMeshId || null, textureIds, completeMsg);
    } else {
      // No tracker — send immediately (backward compat)
      this.send(completeMsg);
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

    // Subscribe to live texture changes
    if (obj.onTextureUpdate) {
      const texSub = obj.onTextureUpdate.subscribe(() => this.materialPipeline.handleObjectTextureUpdate(obj));
      this.textureUpdateSubs.set(obj.ID, texSub);
    }

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

    if (!skipTextures) {
      this.materialPipeline.fetchTexturesForObject(obj, texInfo);
    }
  }

  /** Recursively send children of a root/parent object */
  sendChildren(obj: any): void {
    if (!obj.children) return;
    for (const child of obj.children) {
      if (child.PCode === 47) continue;
      if (isHudAttachment(child)) continue;
      this.sendObject(child, obj.ID);
      this.sendChildren(child);
    }
  }

  /** Max objects to send per rescan tick to avoid flooding Godot */
  private static readonly RESCAN_BATCH_LIMIT = 50;

  /** Re-scan all tracked roots for untracked children (catches late arrivals) */
  rescanChildren(): void {
    try {
      const objectStore = this.bot.currentRegion.objects;
      let found = 0;
      const limit = GodotObjectSender.RESCAN_BATCH_LIMIT;
      for (const localId of this.trackedObjects) {
        if (found >= limit) break;
        const children = objectStore.getObjectsByParent(localId);
        for (const child of children) {
          if (found >= limit) break;
          if (child.PCode === 47) continue;
          if (isHudAttachment(child)) continue;
          if (!this.trackedObjects.has(child.ID)) {
            this.sendObject(child, localId);
            found++;
          }
        }
      }
      // Scan avatar attachments
      for (const [, avatarLocalId] of this.avatarLocalIds) {
        if (found >= limit) break;
        try {
          const children = objectStore.getObjectsByParent(avatarLocalId);
          for (const child of children) {
            if (found >= limit) break;
            if (child.PCode === 47) continue;
            if (isHudAttachment(child)) continue;
            if (!this.trackedObjects.has(child.ID)) {
              this.sendObject(child, avatarLocalId);
              found++;
            }
          }
        } catch { /* avatar may have left */ }
      }
      if (found > 0) {
        console.log(`[GodotBridge] Rescan found ${found} missing children${found >= limit ? ` (capped at ${limit}, more next tick)` : ''}`);
      }
    } catch { /* bot may be disconnected */ }
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

      const queue: { obj: any; parentId: number }[] = [];
      const collect = (obj: any, parentId: number) => {
        if (obj.PCode === 47) return;
        if (isHudAttachment(obj)) return;
        // Skip objects already sent during avatar creation
        if (this.trackedObjects.has(obj.ID)) return;
        queue.push({ obj, parentId });
        if (obj.children) {
          for (const child of obj.children) {
            if (child.PCode !== 47) collect(child, obj.ID);
          }
        }
      };

      const avatarLocalIdSet = new Set<number>();
      for (const [, lid] of this.avatarLocalIds) {
        avatarLocalIdSet.add(lid);
      }

      // Collect avatar attachments explicitly (skips already-tracked from avatar creation)
      let attachmentRouted = 0;
      for (const avLid of avatarLocalIdSet) {
        try {
          const attachObjs = region.objects.getObjectsByParent(avLid);
          for (const obj of attachObjs) {
            if (obj.PCode === 47) continue;
            if (isHudAttachment(obj)) continue;
            if (this.trackedObjects.has(obj.ID)) continue;
            collect(obj, avLid);
            attachmentRouted++;
          }
        } catch { /* avatar may not have attachments yet */ }
      }

      // Collect all other objects
      for (const obj of region.objects.getAllObjects({})) {
        collect(obj, 0);
      }
      console.log(`[GodotBridge] Routed ${attachmentRouted} avatar attachments + ${queue.length - attachmentRouted} objects`);

      // Pre-mark all queued objects as tracked
      for (const { obj } of queue) {
        this.trackedObjects.add(obj.ID);
      }

      // Throttled batching: 50 objects every 100ms to avoid overwhelming Godot
      // during cold start (Vulkan resource creation, skeleton setup, etc.)
      const BATCH_SIZE = 50;
      const BATCH_INTERVAL_MS = 100;
      console.log(`[GodotBridge] Sending ${queue.length} objects in batches of ${BATCH_SIZE} (${BATCH_INTERVAL_MS}ms apart)`);

      let offset = 0;
      const connected = () => this.trackedObjects.size > 0; // proxy for connected state
      const sendNextBatch = () => {
        if (!connected()) return;
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
        if (!globalPos) continue;
        const dist = globalPos.distance(botPos);
        if (dist <= this.TEXTURE_FETCH_RANGE) {
          this.deferredTextures.delete(localId);
          const texInfo = this.materialPipeline.getTextureInfo(live);

          // Re-apply BoM substitution (texInfo has original magic UUIDs from the live object)
          if (texInfo && live.ParentID > 0 && this.avatarManager) {
            const avatarId = this.avatarManager.findOwnerAvatar(live.ParentID);
            if (avatarId) {
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
              }
            }
          }

          this.materialPipeline.fetchTexturesForObject(live, texInfo);

          // Add texture requirements to readiness tracker for promoted objects
          if (this.readinessTracker && texInfo) {
            const promotedTexIds = new Set<string>();
            for (const face of texInfo.faces) {
              if (face.textureId && face.textureId !== ZERO_UUID) promotedTexIds.add(face.textureId);
              if (face.normalTextureId) promotedTexIds.add(face.normalTextureId);
              if (face.ormTextureId) promotedTexIds.add(face.ormTextureId);
              if (face.emissiveTextureId) promotedTexIds.add(face.emissiveTextureId);
            }
            if (promotedTexIds.size > 0) {
              this.readinessTracker.addTextures(localId, promotedTexIds);
            }
          }

          promoted++;
        }
      }

      if (promoted > 0) {
        console.log(`[GodotBridge] Promoted ${promoted} deferred objects for texture fetch (${this.deferredTextures.size} still deferred)`);
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
