/**
 * Manages avatar lifecycle — creation, attachment routing, departure sweeps.
 */

import type { Bot } from '../../node-metaverse/dist/lib';
import type { Subscription } from 'rxjs';
import type { GodotObjectSender } from './godot-object-sender';
import type { GodotAnimationManager } from './godot-animation-manager';
import type { SendFn } from './godot-bridge-types';
import { isHudAttachment } from './godot-bridge-types';

export class GodotAvatarManager {
  private avatarAttachSubs = new Map<string, Subscription>();
  private objectSender!: GodotObjectSender;
  private connected = false;

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

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  /** Send avatar_create with localId for attachment routing + skeleton creation */
  sendAvatarCreate(avatar: any, id: string): void {
    const pos = avatar.position;
    const rot = avatar.getRotation();
    let localId = 0;
    try {
      const gameObj = (avatar as any)._gameObject;
      if (gameObj) localId = gameObj.ID;
    } catch { /* gameObject may not be set yet */ }

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
        }
      }
    } catch { /* bot may be disconnected */ }
  }

  cleanup(): void {
    for (const sub of this.avatarAttachSubs.values()) {
      sub.unsubscribe();
    }
    this.avatarAttachSubs.clear();
  }
}
