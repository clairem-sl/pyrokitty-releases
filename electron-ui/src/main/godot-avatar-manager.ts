/**
 * Manages avatar lifecycle — creation, attachment routing, departure sweeps,
 * and Bakes on Mesh (BoM) texture substitution.
 */

import type { Bot } from '../../node-metaverse/dist/lib';
import { Message } from '../../node-metaverse/dist/lib/enums/Message';
import { TextureEntry } from '../../node-metaverse/dist/lib/classes/TextureEntry';
import type { AvatarAppearanceMessage } from '../../node-metaverse/dist/lib/classes/messages/AvatarAppearance';
import type { Subscription } from 'rxjs';
import type { GodotObjectSender } from './godot-object-sender';
import type { GodotAnimationManager } from './godot-animation-manager';
import type { GodotMaterialPipeline } from './godot-material-pipeline';
import type { TextureFetchQueue } from './texture-fetch-queue';
import type { SendFn } from './godot-bridge-types';
import { isHudAttachment, BAKE_MAGIC_UUIDS, BAKE_CHANNEL_NAMES, BAKE_CHANNEL_TO_TE_FACE, ZERO_UUID } from './godot-bridge-types';

export class GodotAvatarManager {
  private avatarAttachSubs = new Map<string, Subscription>();
  private objectSender!: GodotObjectSender;
  private connected = false;

  // BoM state: avatarUuid → array of 11 baked texture UUIDs (index = channel)
  private avatarBakedTextures = new Map<string, string[]>();
  // avatarUuid → set of attachment localIds that have magic bake UUIDs
  private avatarBakeObjects = new Map<string, Set<number>>();

  private materialPipeline: GodotMaterialPipeline | null = null;
  private textureFetchQueue: TextureFetchQueue | null = null;

  constructor(
    private bot: Bot,
    private send: SendFn,
    private trackedObjects: Set<number>,
    private trackedAvatars: Set<string>,
    private avatarLocalIds: Map<string, number>,
    private animationManager: GodotAnimationManager,
  ) {}

  /** Late-bind object sender to break circular dependency */
  setObjectSender(sender: GodotObjectSender): void {
    this.objectSender = sender;
  }

  /** Set references needed for BoM re-emit */
  initBom(materialPipeline: GodotMaterialPipeline, textureFetchQueue: TextureFetchQueue): void {
    this.materialPipeline = materialPipeline;
    this.textureFetchQueue = textureFetchQueue;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  // ─── BoM: AvatarAppearance Subscription ───────────────────────

  /** Subscribe to AvatarAppearance circuit messages. Returns subscription or null. */
  subscribeToAvatarAppearance(): Subscription | null {
    try {
      const circuit = this.bot.currentRegion?.circuit;
      if (!circuit) {
        console.warn('[BoM] No circuit available for AvatarAppearance subscription');
        return null;
      }
      console.log(`[BoM] Subscribing to AvatarAppearance (Message.AvatarAppearance=${Message.AvatarAppearance})`);
      return circuit.subscribeToMessages([
        Message.AvatarAppearance,
      ], (packet: any) => {
        try {
          const msg = packet.message as AvatarAppearanceMessage;
          const avatarId = msg.Sender.ID.toString();

          // Parse baked texture UUIDs from the avatar's TextureEntry
          // Baked faces are at specific ETextureIndex positions (8,9,10,11,20,21,41-45), NOT 0-10
          const te = TextureEntry.from(msg.ObjectData.TextureEntry);
          const bakes: string[] = [];
          for (let ch = 0; ch < 11; ch++) {
            const teFace = BAKE_CHANNEL_TO_TE_FACE[ch];
            const face = te.faces[teFace] ?? te.defaultTexture;
            const texId = face?.textureID?.toString() || '';
            bakes.push(texId);
          }

          const prevBakes = this.avatarBakedTextures.get(avatarId);
          this.avatarBakedTextures.set(avatarId, bakes);

          // Log bake channels that have real textures
          const filled = bakes
            .map((uuid, i) => (uuid && uuid !== ZERO_UUID) ? `${BAKE_CHANNEL_NAMES[i]}=${uuid.slice(0, 8)}` : null)
            .filter(Boolean);
          console.log(`[BoM] AvatarAppearance for ${avatarId.slice(0, 8)}: ${filled.length}/11 bake channels — ${filled.join(', ')}`);

          // Check if bakes changed (or this is the first appearance)
          const changed = !prevBakes || bakes.some((b, i) => b !== prevBakes[i]);
          if (changed && this.connected) {
            this.reemitBakeUpdates(avatarId, bakes);
          }
        } catch (err) {
          console.warn('[BoM] Error parsing AvatarAppearance:', (err as Error).message);
        }
      });
    } catch { return null; }
  }

  // ─── BoM: Bake Lookup & Tracking ──────────────────────────────

  /** Seed baked textures from MetaverseConnection's early AvatarAppearance buffer */
  seedBakedTextures(buffer: Map<string, string[]>): void {
    for (const [avatarId, bakes] of buffer) {
      this.avatarBakedTextures.set(avatarId, bakes);
    }
    console.log(`[BoM] Seeded ${buffer.size} avatar bake entries from login buffer`);
  }

  /** Get baked texture UUIDs for an avatar (11 entries, index = channel) */
  getBakedTextures(avatarId: string): string[] | undefined {
    return this.avatarBakedTextures.get(avatarId);
  }

  /**
   * Find which avatar UUID owns an object, by walking up the parent chain.
   * Returns undefined if the object is not an avatar attachment.
   */
  findOwnerAvatar(parentLocalId: number, depth = 0): string | undefined {
    if (depth > 4 || parentLocalId === 0) return undefined;
    for (const [avId, avLid] of this.avatarLocalIds) {
      if (avLid === parentLocalId) return avId;
    }
    try {
      const parent = this.bot.currentRegion.objects.getObjectByLocalID(parentLocalId);
      if (parent?.ParentID) return this.findOwnerAvatar(parent.ParentID, depth + 1);
    } catch { /* empty */ }
    return undefined;
  }

  /** Track an object localId as having bake UUIDs for a given avatar */
  trackBakeObject(avatarId: string, localId: number): void {
    let set = this.avatarBakeObjects.get(avatarId);
    if (!set) {
      set = new Set();
      this.avatarBakeObjects.set(avatarId, set);
    }
    set.add(localId);
  }

  /** Remove a localId from bake tracking (called on object kill) */
  removeBakeObject(localId: number): void {
    for (const set of this.avatarBakeObjects.values()) {
      set.delete(localId);
    }
  }

  /**
   * Re-emit face updates for all tracked bake objects of an avatar.
   * Called when AvatarAppearance arrives or changes.
   */
  private reemitBakeUpdates(avatarId: string, bakes: string[]): void {
    const objectSet = this.avatarBakeObjects.get(avatarId);
    if (!objectSet || objectSet.size === 0) {
      // No tracked bake objects yet — attachments may not have arrived.
      // They'll get substituted when sendObject runs.
      return;
    }

    let reemitted = 0;
    for (const localId of objectSet) {
      if (!this.trackedObjects.has(localId)) continue;
      try {
        const obj = this.bot.currentRegion.objects.getObjectByLocalID(localId);
        if (!obj || obj.deleted) continue;

        const texInfo = this.materialPipeline?.getTextureInfo(obj);
        if (!texInfo) continue;

        // Substitute magic bake UUIDs with actual baked textures
        let hadSub = false;
        for (const face of texInfo.faces) {
          const channel = BAKE_MAGIC_UUIDS.get(face.textureId);
          if (channel !== undefined) {
            const bakedUuid = bakes[channel];
            if (bakedUuid && bakedUuid !== ZERO_UUID) {
              face.textureId = bakedUuid;
              face._isBake = true;
              face._bakeAvatarUuid = avatarId;
              face._bakeChannel = channel;
              hadSub = true;
            }
          }
        }

        if (hadSub) {
          // Send updated faces to Godot
          this.send({ type: 'object_update_faces', localId, faces: texInfo.faces });

          // Fetch the new baked texture assets via appearance service
          for (const face of texInfo.faces) {
            if (face.textureId && !BAKE_MAGIC_UUIDS.has(face.textureId) && this.textureFetchQueue) {
              if (face._bakeChannel != null) {
                this.textureFetchQueue.requestBake(face.textureId, localId, avatarId, face._bakeChannel);
              } else {
                this.textureFetchQueue.request(face.textureId, localId);
              }
            }
          }
          reemitted++;
        }
      } catch { /* object may not exist anymore */ }
    }

    if (reemitted > 0) {
      console.log(`[BoM] Re-emitted face updates for ${reemitted} objects of avatar ${avatarId.slice(0, 8)}`);
    }
  }

  // ─── Avatar Lifecycle ─────────────────────────────────────────

  /** Send avatar_create with localId for attachment routing + skeleton creation */
  sendAvatarCreate(avatar: any, id: string): void {
    const pos = avatar.position;
    const rot = avatar.getRotation();
    let localId = 0;
    try {
      const gameObj = (avatar as any)._gameObject;
      if (gameObj) localId = gameObj.ID;
    } catch { /* gameObject may not be set yet */ }

    const parentId = (avatar as any)._gameObject?.ParentID || 0;

    const isSelf = id === this.bot.agent?.agentID?.toString();
    if (isSelf) {
      console.log(`[SelfAvatar] === Creating self avatar uuid=${id.slice(0, 8)} localId=${localId} name=${avatar.getName()} ===`);
    }

    this.send({
      type: 'avatar_create',
      id,
      localId,
      name: avatar.getName(),
      position: [pos.x, pos.y, pos.z],
      rotation: [rot.x, rot.y, rot.z, rot.w],
      parentId,
    });
    this.trackedAvatars.add(id);
    if (localId > 0) {
      this.avatarLocalIds.set(id, localId);
    }

    // Track self-avatar localId for attachment tagging
    if (isSelf && localId > 0) {
      this.objectSender.selfAvatarLocalId = localId;
    }

    // Send existing attachments
    const avLocalId = localId || 0;
    try {
      if (avLocalId > 0) {
        try {
          const storeChildren = this.bot.currentRegion.objects.getObjectsByParent(avLocalId);
          console.log(`[AvatarDebug] ${id.slice(0, 8)} localId=${avLocalId}: getObjectsByParent returned ${storeChildren.length} children`);
          for (const c of storeChildren.slice(0, 5)) {
            console.log(`[AvatarDebug]   child localId=${c.ID} IsAttachment=${c.IsAttachment} PCode=${c.PCode} meshId=${c.FullID?.toString()?.slice(0,8) || '?'}`);
          }
        } catch (e) { console.log(`[AvatarDebug] getObjectsByParent(${avLocalId}) failed: ${(e as Error).message}`); }
      }
      const attachments = avatar.getAttachments();
      console.log(`[Avatar] ${id.slice(0, 8)} localId=${localId}: ${attachments.size} attachments from getAttachments()`);
      let sentCount = 0;
      let skippedHud = 0;
      let skippedTracked = 0;
      for (const [, obj] of attachments) {
        if (isHudAttachment(obj)) { skippedHud++; continue; }
        if (!this.trackedObjects.has(obj.ID)) {
          this.objectSender.sendObject(obj, avLocalId);
          this.objectSender.sendChildren(obj);
          sentCount++;
        } else {
          skippedTracked++;
        }
      }
      console.log(`[Avatar] ${id.slice(0, 8)}: sent=${sentCount} skippedHud=${skippedHud} skippedTracked=${skippedTracked}`);
      if (isSelf) {
        console.log(`[SelfAvatar] Sent ${sentCount} attachments (${skippedHud} HUD skipped, ${skippedTracked} already tracked)`);
      }
    } catch (err) {
      console.error(`[Avatar] ${id.slice(0, 8)}: getAttachments error:`, (err as Error).message);
    }

    // Subscribe to late-arriving attachments
    if (avLocalId > 0) {
      this.avatarAttachSubs.get(id)?.unsubscribe();
      const attachSub = avatar.onAttachmentAdded.subscribe((obj: any) => {
        if (!this.connected) return;
        console.log(`[AvatarDebug] onAttachmentAdded: avatar=${id.slice(0,8)} obj=${obj.ID} IsAttachment=${obj.IsAttachment} attachPt=${obj.attachmentPoint} PCode=${obj.PCode} isHud=${isHudAttachment(obj)}`);
        if (isHudAttachment(obj)) return;
        if (this.trackedObjects.has(obj.ID)) return;
        this.objectSender.sendObject(obj, avLocalId);
        this.objectSender.sendChildren(obj);
      });
      this.avatarAttachSubs.set(id, attachSub);

      // Delayed debug for self-avatar
      if (id === this.bot.agent?.agentID?.toString()) {
        setTimeout(() => {
          try {
            const storeChildren = this.bot.currentRegion.objects.getObjectsByParent(avLocalId);
            const attachCount = avatar.getAttachments().size;
            console.log(`[AvatarDebug] SELF 10s check: avatar=${id.slice(0,8)} localId=${avLocalId}: getObjectsByParent=${storeChildren.length}, getAttachments()=${attachCount}`);
            for (const c of storeChildren.slice(0, 10)) {
              console.log(`[AvatarDebug]   child: avatar=${id.slice(0,8)} localId=${c.ID} uuid=${c.FullID?.toString()?.slice(0,8) || '?'} attachPt=${c.attachmentPoint} IsAttachment=${c.IsAttachment}`);
            }
          } catch (e) { console.log(`[AvatarDebug] SELF 10s check failed: ${(e as Error).message}`); }
        }, 10000);
      }
    }

    // Replay buffered avatar animations
    const buffered = this.animationManager.getBufferedAvatarAnims(id);
    if (buffered && buffered.length > 0 && localId > 0) {
      this.animationManager.updateAnimSet(localId, buffered.map(a => a.animId));
    }
  }

  /** Sweep for avatars that left the region */
  sweepAvatarDepartures(): void {
    try {
      const agents = this.bot.currentRegion.agents;
      for (const id of this.trackedAvatars) {
        if (!agents.has(id)) {
          this.send({ type: 'avatar_kill', id });
          this.trackedAvatars.delete(id);
          this.animationManager.cleanupAvatar(id);
          this.avatarLocalIds.delete(id);
          this.avatarAttachSubs.get(id)?.unsubscribe();
          this.avatarAttachSubs.delete(id);
          // Clean up BoM state
          this.avatarBakedTextures.delete(id);
          this.avatarBakeObjects.delete(id);
        }
      }
    } catch { /* bot may be disconnected */ }
  }

  cleanup(): void {
    for (const sub of this.avatarAttachSubs.values()) {
      sub.unsubscribe();
    }
    this.avatarAttachSubs.clear();
    this.avatarBakedTextures.clear();
    this.avatarBakeObjects.clear();
  }
}
