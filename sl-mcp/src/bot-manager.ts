/**
 * Bot lifecycle manager — adapted from metaverse-connection.ts but simplified.
 * No Electron IPC, no display name cache, no chat sessions — just bot + data access.
 *
 * ## node-metaverse UUID gotcha
 *
 * Many node-metaverse APIs return Maps keyed by UUID *objects*, not strings.
 * For example, `getDisplayNames()` returns `Map<UUID, {...}>` even though the
 * type declaration says `Map<string, {...}>`. Calling `.get(stringId)` on such
 * a map will always return undefined because object identity !== string equality.
 *
 * **Always convert UUID keys to strings before doing lookups:**
 *   ```ts
 *   const lookup = new Map<string, V>();
 *   for (const [key, val] of uuidKeyedMap) {
 *     lookup.set(key.toString(), val);
 *   }
 *   ```
 *
 * Similarly, when we store IDs internally (friends, avatars, groups), we always
 * call `.toString()` on UUID objects so our Maps use plain string keys.
 */

import { Bot, BotOptionFlags, LoginParameters, Vector3 } from '../../electron-ui/node-metaverse/dist/lib/index.js';
import { ChatType } from '../../electron-ui/node-metaverse/dist/lib/enums/ChatType.js';
import { ChatSourceType } from '../../electron-ui/node-metaverse/dist/lib/enums/ChatSourceType.js';
import { InstantMessageEventFlags } from '../../electron-ui/node-metaverse/dist/lib/enums/InstantMessageEventFlags.js';
import { RightsFlags } from '../../electron-ui/node-metaverse/dist/lib/enums/RightsFlags.js';
import { UUID } from '../../electron-ui/node-metaverse/dist/lib/classes/UUID.js';
import { Quaternion } from '../../electron-ui/node-metaverse/dist/lib/classes/Quaternion.js';
import { DeRezDestination } from '../../electron-ui/node-metaverse/dist/lib/enums/DeRezDestination.js';
import { AssetType } from '../../electron-ui/node-metaverse/dist/lib/enums/AssetType.js';
import { ControlFlags } from '../../electron-ui/node-metaverse/dist/lib/enums/ControlFlags.js';

export type BotState = 'disconnected' | 'logging_in' | 'connected';

export interface Friend {
  id: string;
  name: string;
  online: boolean;
}

export interface Group {
  id: string;
  name: string;
}

export interface NearbyAvatar {
  id: string;
  /** Legacy username (e.g. "Aranur Kamachi") */
  name: string;
  /** Custom display name (e.g. "Aard") — resolved via GetDisplayNames cap */
  displayName?: string;
  position: { x: number; y: number; z: number };
}

export interface IncomingIM {
  fromName: string;
  fromId: string;
  message: string;
  timestamp: number;
}

export interface NearbyChatMessage {
  fromName: string;
  fromId: string;
  message: string;
  chatType: string;
  timestamp: number;
}

export class BotManager {
  private bot: Bot | null = null;
  private _state: BotState = 'disconnected';
  private friends = new Map<string, Friend>();
  private groups = new Map<string, Group>();
  private nearbyAvatars = new Map<string, NearbyAvatar>();
  private recentIMs: IncomingIM[] = [];
  private recentChat: NearbyChatMessage[] = [];
  private maxRecentIMs = 50;
  private maxRecentChat = 100;

  get state(): BotState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected' && this.bot !== null;
  }

  getBot(): Bot | null {
    return this.bot;
  }

  // ============ Session ============

  async login(params: {
    firstName: string;
    lastName: string;
    password: string;
    loginUrl?: string;
    startLocation?: string;
  }): Promise<string> {
    if (this._state !== 'disconnected') {
      throw new Error(`Cannot login: state is ${this._state}`);
    }

    this._state = 'logging_in';

    try {
      const loginParams = new LoginParameters();
      loginParams.firstName = params.firstName;
      loginParams.lastName = params.lastName;
      loginParams.password = params.password;
      loginParams.url = params.loginUrl || 'https://login.agni.lindenlab.com/cgi-bin/login.cgi';
      loginParams.start = params.startLocation || 'last';

      this.bot = new Bot(loginParams, BotOptionFlags.None);
      await this.bot.login();
      // Set draw distance BEFORE connectToSim so the sim sends us objects within range
      this.bot.agent.cameraFar = 32;
      this.setupEventSubscriptions();
      this.populateFriendsFromLogin();
      await this.bot.connectToSim();
      // Request 360-degree interest list so sim sends all objects within draw distance
      // (default mode only sends objects the camera is facing)
      await this.bot.setInterestList('360').catch(() => { });

      this._state = 'connected';
      const region = this.bot.currentRegion?.regionName || 'unknown';
      return `Logged in as ${params.firstName} ${params.lastName} in ${region}`;
    } catch (err: any) {
      this._state = 'disconnected';
      this.bot = null;
      throw err;
    }
  }

  async logout(): Promise<void> {
    if (this.bot) {
      try { await this.bot.close(); } catch { }
      this.bot = null;
    }
    this.friends.clear();
    this.groups.clear();
    this.nearbyAvatars.clear();
    this.recentIMs = [];
    this.recentChat = [];
    this._state = 'disconnected';
  }

  getStatus(): Record<string, unknown> {
    if (!this.bot || this._state !== 'connected') {
      return { state: this._state };
    }
    const region = this.bot.currentRegion;
    let agentPosition: { x: number; y: number; z: number } | undefined;
    // region.agents is a Map<string, Avatar> keyed by agent UUID string
    const selfAvatar = region?.agents?.get(this.bot.agentID().toString());
    if (selfAvatar) {
      const pos = selfAvatar.position;
      agentPosition = { x: pos.x, y: pos.y, z: pos.z };
    }
    return {
      state: this._state,
      avatarName: `${this.bot.agent.firstName} ${this.bot.agent.lastName}`,
      avatarId: this.bot.agentID().toString(),
      region: region?.regionName,
      position: agentPosition,
    };
  }

  // ============ Chat ============

  async say(message: string, type: 'whisper' | 'normal' | 'shout' = 'normal', channel = 0): Promise<void> {
    this.requireConnected();
    const chatTypeMap: Record<string, ChatType> = {
      whisper: ChatType.Whisper,
      normal: ChatType.Normal,
      shout: ChatType.Shout,
    };
    await this.bot!.clientCommands.comms.nearbyChat(message, chatTypeMap[type], channel);
  }

  async sendIM(avatarId: string, message: string): Promise<void> {
    this.requireConnected();
    await this.bot!.clientCommands.comms.sendInstantMessage(avatarId, message);
  }

  async sendGroupMessage(groupId: string, message: string): Promise<void> {
    this.requireConnected();
    await this.bot!.clientCommands.comms.sendGroupMessage(groupId, message);
  }

  // ============ Navigation ============

  async teleport(regionName: string, x = 128, y = 128, z = 30): Promise<string> {
    this.requireConnected();
    const position = new Vector3([x, y, z]);
    const lookAt = new Vector3([0, 1, 0]);
    await this.bot!.clientCommands.teleport.teleportTo(regionName, position, lookAt);
    return `Teleported to ${regionName} (${x}, ${y}, ${z})`;
  }

  /**
   * Get nearby avatars with display names resolved via the GetDisplayNames capability.
   *
   * Note on UUID Map keys: getDisplayNames() returns a Map keyed by UUID objects,
   * not strings. We must convert keys with .toString() before looking up our
   * string-based avatar IDs. See class-level doc for full explanation.
   */
  async getNearbyAvatars(): Promise<NearbyAvatar[]> {
    this.requireConnected();
    const avatars = Array.from(this.nearbyAvatars.values());

    const uuidsToResolve = avatars.map(a => new UUID(a.id));
    if (uuidsToResolve.length > 0) {
      try {
        const displayNames = await this.bot!.clientCommands.grid.getDisplayNames(uuidsToResolve);

        // IMPORTANT: displayNames Map is keyed by UUID objects, not strings.
        // Map.get(stringId) will never match a UUID object key, so we must
        // rebuild as a string-keyed map first.
        const dnLookup = new Map<string, string>();
        for (const [key, val] of displayNames) {
          dnLookup.set(key.toString(), val.displayName);
        }

        for (const avatar of avatars) {
          avatar.displayName = dnLookup.get(avatar.id);
        }
      } catch {
        // GetDisplayNames cap may be unavailable (e.g. OpenSim) — continue with legacy names
      }
    }
    return avatars;
  }

  /**
   * Walk the bot to a target position using avatar control flags.
   *
   * How it works:
   * 1. Calculate yaw angle from current position to target
   * 2. Set the agent's bodyRotation quaternion to face the target
   *    (bodyRotation is private but we access it via (agent as any) since
   *    TypeScript private is compile-time only)
   * 3. Set AGENT_CONTROL_AT_POS flag (walk forward)
   * 4. The agent's built-in 1-second agentUpdateTimer sends these to the server
   * 5. We poll position every 250ms and update rotation to track the target
   * 6. When within stopDistance, clear the walk flag and resolve
   *
   * SL coordinate system: X = East, Y = North, Z = Up.
   * Identity rotation faces +X. Yaw is rotation around Z axis.
   * Quaternion for yaw: (0, 0, sin(yaw/2), cos(yaw/2))
   */
  async walkTo(
    targetX: number, targetY: number, targetZ: number,
    stopDistance = 3.0, timeout = 30000
  ): Promise<string> {
    this.requireConnected();

    const agent = this.bot!.agent;
    const region = this.bot!.currentRegion;

    const getMyPos = (): { x: number; y: number; z: number } | null => {
      const self = region?.agents?.get(this.bot!.agentID().toString());
      return self ? { x: self.position.x, y: self.position.y, z: self.position.z } : null;
    };

    const startPos = getMyPos();
    if (!startPos) throw new Error('Cannot determine current position');

    const setFacing = (fromX: number, fromY: number, toX: number, toY: number) => {
      const dx = toX - fromX;
      const dy = toY - fromY;
      // atan2(dy, dx) gives angle from +X axis, which matches SL's identity forward
      const yaw = Math.atan2(dy, dx);
      const bodyRot = (agent as any).bodyRotation as Quaternion;
      bodyRot.x = 0;
      bodyRot.y = 0;
      bodyRot.z = Math.sin(yaw / 2);
      bodyRot.w = Math.cos(yaw / 2);
    };

    const cleanup = () => {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_AT_POS);
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_FLY);
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
      agent.sendAgentUpdate();
    };

    // Face the target and start walking forward
    setFacing(startPos.x, startPos.y, targetX, targetY);
    agent.setControlFlag(ControlFlags.AGENT_CONTROL_AT_POS);
    agent.sendAgentUpdate();

    return new Promise((resolve) => {
      const startTime = Date.now();
      let flying = false;
      let bestDist = Infinity;
      let noProgressCount = 0;
      let prevDist = Infinity;
      let overshootCount = 0;

      const poll = setInterval(() => {
        const pos = getMyPos();
        if (!pos) return;

        const dx = targetX - pos.x;
        const dy = targetY - pos.y;
        const dz = targetZ - pos.z;
        const dist2d = Math.sqrt(dx * dx + dy * dy);
        const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const dist = flying ? dist3d : dist2d;

        // Arrived?
        if (dist <= stopDistance) {
          clearInterval(poll);
          cleanup();
          resolve(`Arrived at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), ${dist.toFixed(1)}m from target`);
          return;
        }

        // Deceleration zone: stop walking when close, let momentum coast us in
        if (dist < stopDistance + 2) {
          agent.clearControlFlag(ControlFlags.AGENT_CONTROL_AT_POS);
          agent.sendAgentUpdate();
        } else {
          agent.setControlFlag(ControlFlags.AGENT_CONTROL_AT_POS);
        }

        // Overshoot detection: distance increasing means we passed the target
        if (dist > prevDist + 0.2) {
          overshootCount++;
          if (overshootCount >= 2) {
            // We overshot — stop and report current position
            clearInterval(poll);
            cleanup();
            resolve(`Arrived at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), ${dist.toFixed(1)}m from target`);
            return;
          }
        } else {
          overshootCount = 0;
        }
        prevDist = dist;

        // Timeout?
        if (Date.now() - startTime > timeout) {
          clearInterval(poll);
          cleanup();
          resolve(`Timed out after ${(timeout / 1000).toFixed(0)}s, ${dist.toFixed(1)}m from target at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
          return;
        }

        // Re-face target each tick to course-correct
        setFacing(pos.x, pos.y, targetX, targetY);
        agent.sendAgentUpdate();

        // Stuck detection
        if (dist < bestDist - 0.3) {
          bestDist = dist;
          noProgressCount = 0;
        } else {
          noProgressCount++;
        }

        // 4 seconds without getting closer → stuck
        if (noProgressCount > 16) {
          if (!flying && Math.abs(dz) > 1.5) {
            flying = true;
            noProgressCount = 0;
            bestDist = dist3d;
            agent.setControlFlag(ControlFlags.AGENT_CONTROL_FLY);
            if (dz > 0) {
              agent.setControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
            } else {
              agent.setControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
            }
            agent.sendAgentUpdate();
          } else {
            clearInterval(poll);
            cleanup();
            resolve(`Got stuck at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), ${dist.toFixed(1)}m from target`);
            return;
          }
        }

        // While flying, manage altitude
        if (flying) {
          if (Math.abs(dz) < 1.0) {
            agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
            agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
          } else if (dz > 0) {
            agent.setControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
            agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
          } else {
            agent.setControlFlag(ControlFlags.AGENT_CONTROL_UP_NEG);
            agent.clearControlFlag(ControlFlags.AGENT_CONTROL_UP_POS);
          }
        }
      }, 250);
    });
  }

  /** Enable or disable flight mode. */
  setFlying(enabled: boolean): void {
    this.requireConnected();
    const agent = this.bot!.agent;
    if (enabled) {
      agent.setControlFlag(ControlFlags.AGENT_CONTROL_FLY);
    } else {
      agent.clearControlFlag(ControlFlags.AGENT_CONTROL_FLY);
    }
    agent.sendAgentUpdate();
  }

  getRegionInfo(): Record<string, unknown> | null {
    if (!this.bot?.currentRegion) return null;
    const region = this.bot.currentRegion;
    let agentPosition: { x: number; y: number; z: number } | undefined;
    const selfAvatar = region.agents?.get(this.bot.agentID().toString());
    if (selfAvatar) {
      const pos = selfAvatar.position;
      agentPosition = { x: pos.x, y: pos.y, z: pos.z };
    }
    return {
      name: region.regionName,
      x: region.xCoordinate,
      y: region.yCoordinate,
      agentPosition,
    };
  }

  // ============ Social ============

  getFriends(): Friend[] {
    return Array.from(this.friends.values());
  }

  getGroups(): Group[] {
    return Array.from(this.groups.values());
  }

  /**
   * Resolve avatar name → UUID. Accepts "First Last" or "first.last" format.
   */
  async avatarName2Key(name: string): Promise<string> {
    this.requireConnected();
    const uuid = await this.bot!.clientCommands.grid.avatarName2Key(name);
    return uuid.toString();
  }

  /**
   * Resolve UUID → avatar name.
   * avatarKey2Name can return a single result or an array — handle both.
   */
  async avatarKey2Name(uuid: string): Promise<string> {
    this.requireConnected();
    const uuidObj = new UUID(uuid);
    const result = await this.bot!.clientCommands.grid.avatarKey2Name(uuidObj);
    const info = Array.isArray(result) ? result[0] : result;
    return info?.getName() || 'Unknown';
  }

  async getBalance(): Promise<number> {
    this.requireConnected();
    return await this.bot!.clientCommands.grid.getBalance();
  }

  getRecentIMs(): IncomingIM[] {
    return [...this.recentIMs];
  }

  getRecentChat(): NearbyChatMessage[] {
    return [...this.recentChat];
  }

  // ============ Objects ============

  /**
   * Rez new prims near the bot. They appear ~2m above the avatar.
   * Returns local IDs (for subsequent manipulation) and UUIDs.
   *
   * GameObject properties: .ID = local ID (number), .FullID = UUID object,
   * .Position = Vector3. The .name property holds the object name after resolve.
   */
  async rezPrims(count = 1): Promise<Array<{ localId: number; uuid: string; position: { x: number; y: number; z: number } }>> {
    this.requireConnected();
    const objects = await this.bot!.clientCommands.region.rezPrims(count);
    return objects.map(o => ({
      localId: o.ID,
      uuid: o.FullID.toString(),
      position: o.Position ? { x: o.Position.x, y: o.Position.y, z: o.Position.z } : { x: 0, y: 0, z: 0 },
    }));
  }

  async setObjectName(localId: number, name: string): Promise<void> {
    this.requireConnected();
    const obj = await this.bot!.clientCommands.region.getObjectByLocalID(localId, true);
    await obj.setName(name);
  }

  async setObjectDescription(localId: number, description: string): Promise<void> {
    this.requireConnected();
    const obj = await this.bot!.clientCommands.region.getObjectByLocalID(localId, true);
    await obj.setDescription(description);
  }

  /** Move object. Uses setGeometry with position only (preserves rotation/scale). */
  async setObjectPosition(localId: number, x: number, y: number, z: number): Promise<void> {
    this.requireConnected();
    const obj = await this.bot!.clientCommands.region.getObjectByLocalID(localId, true);
    await obj.setGeometry(new Vector3([x, y, z]));
  }

  /** Resize object. Uses setGeometry with scale only (preserves position/rotation). */
  async setObjectScale(localId: number, x: number, y: number, z: number): Promise<void> {
    this.requireConnected();
    const obj = await this.bot!.clientCommands.region.getObjectByLocalID(localId, true);
    await obj.setGeometry(undefined, undefined, new Vector3([x, y, z]));
  }

  /**
   * Find objects by name pattern (supports glob via micromatch internally).
   * Uses getAllObjects with resolve:true which scans the full region — can be slow.
   * Retries once after 2s if no results (objects may still be loading after login).
   *
   * Object name is on `.name` property (not NameValue — that's avatar-specific).
   */
  async findObjectsByName(pattern: string): Promise<Array<{ localId: number; uuid: string; name: string; position: { x: number; y: number; z: number } }>> {
    this.requireConnected();
    let objects = await this.bot!.clientCommands.region.findObjectsByName(pattern);
    // Retry after delay — region may still be loading objects after a fresh login
    if (objects.length === 0) {
      await new Promise(r => setTimeout(r, 2000));
      objects = await this.bot!.clientCommands.region.findObjectsByName(pattern);
    }
    return objects.map(o => ({
      localId: o.ID,
      uuid: o.FullID.toString(),
      name: (o as any).name || '(unknown)',
      position: o.Position ? { x: o.Position.x, y: o.Position.y, z: o.Position.z } : { x: 0, y: 0, z: 0 },
    }));
  }

  /**
   * Get child prims of a linkset. Resolves the root object which populates
   * obj.children via populateChildren in the object store.
   * Returns each child's localId, name, and position (relative to root).
   */
  async getObjectChildren(localId: number): Promise<Array<{
    localId: number; uuid: string; name: string;
    position: { x: number; y: number; z: number };
  }>> {
    this.requireConnected();
    const obj = await this.bot!.clientCommands.region.getObjectByLocalID(localId, true);
    if (!obj.children || obj.children.length === 0) {
      return [];
    }
    return obj.children.map(c => ({
      localId: c.ID,
      uuid: c.FullID.toString(),
      name: (c as any).name || '(unknown)',
      position: c.Position
        ? { x: c.Position.x, y: c.Position.y, z: c.Position.z }
        : { x: 0, y: 0, z: 0 },
    }));
  }

  /**
   * Get texture information for each face of a prim.
   * Returns the texture UUID, offset, repeat, and rotation per face.
   * Also includes the defaultTexture if present.
   */
  async getObjectTextures(localId: number): Promise<{
    defaultTexture?: { textureId: string; offsetU: number; offsetV: number; repeatU: number; repeatV: number; rotation: number };
    faces: Array<{ face: number; textureId: string; offsetU: number; offsetV: number; repeatU: number; repeatV: number; rotation: number }>;
  }> {
    this.requireConnected();
    const obj = await this.bot!.clientCommands.region.getObjectByLocalID(localId, true);
    const te = obj.TextureEntry;
    if (!te) {
      return { faces: [] };
    }

    const faceData = (face: any) => ({
      textureId: face.textureID?.toString() || '',
      offsetU: face.offsetU ?? 0,
      offsetV: face.offsetV ?? 0,
      repeatU: face.repeatU ?? 1,
      repeatV: face.repeatV ?? 1,
      rotation: face.rotation ?? 0,
    });

    return {
      defaultTexture: te.defaultTexture ? faceData(te.defaultTexture) : undefined,
      faces: te.faces.map((f: any, i: number) => ({
        face: i,
        ...faceData(f),
      })),
    };
  }

  /**
   * Read all child prims of a linkset and return every face's texture offset.
   * Designed for reading game boards (like Minesweeper) where each face on each
   * prim represents a cell, and the UV offset selects which sprite is displayed.
   *
   * Returns an array of { name, localId, faces: [{face, offsetU, offsetV}] }
   * where faces includes ALL faces (explicit + default-inherited).
   */
  async readBoardState(rootLocalId: number): Promise<{
    root: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } };
    cells: Array<{
      name: string;
      localId: number;
      position: { x: number; y: number; z: number };
      faces: Array<{ face: number; offsetU: number; offsetV: number }>;
    }>;
  }> {
    this.requireConnected();
    const root = await this.bot!.clientCommands.region.getObjectByLocalID(rootLocalId, true);
    const rootPos = root.Position || { x: 0, y: 0, z: 0 };
    const rootRot = root.Rotation || { x: 0, y: 0, z: 0, w: 1 };
    if (!root.children || root.children.length === 0) {
      return { root: { position: rootPos, rotation: rootRot }, cells: [] };
    }

    const results: Array<{
      name: string;
      localId: number;
      position: { x: number; y: number; z: number };
      faces: Array<{ face: number; offsetU: number; offsetV: number }>;
    }> = [];

    for (const child of root.children) {
      const name = (child as any).name || '(unknown)';
      // Skip non-cell prims (border, reset button, etc)
      if (!name.match(/^\d+-\d+$/)) continue;

      const te = child.TextureEntry;
      if (!te) continue;

      const defaultU = te.defaultTexture?.offsetU ?? 0;
      const defaultV = te.defaultTexture?.offsetV ?? 0;

      // Build complete face list: explicit faces + fill remaining with default
      const faces: Array<{ face: number; offsetU: number; offsetV: number }> = [];
      const explicitCount = te.faces?.length ?? 0;

      for (let i = 0; i < Math.max(explicitCount, 8); i++) {
        const f = te.faces?.[i];
        if (f) {
          faces.push({
            face: i,
            offsetU: f.offsetU ?? defaultU,
            offsetV: f.offsetV ?? defaultV,
          });
        } else if (i < 8) {
          // Fill with default for faces not explicitly listed
          faces.push({ face: i, offsetU: defaultU, offsetV: defaultV });
        }
      }

      const childPos = child.Position || { x: 0, y: 0, z: 0 };
      results.push({ name, localId: child.ID, position: childPos, faces });
    }

    // Sort by name for consistent ordering (1-1, 1-2, 2-1, 2-2, ...)
    results.sort((a, b) => {
      const [aRow, aCol] = a.name.split('-').map(Number);
      const [bRow, bCol] = b.name.split('-').map(Number);
      return aRow - bRow || aCol - bCol;
    });

    return { root: { position: rootPos, rotation: rootRot }, cells: results };
  }

  /**
   * Fetch task inventory (contents) of an in-world object.
   * Must call fetchObjectInventory first to populate obj.inventory.
   */
  async getObjectInventory(localId: number): Promise<Array<{ name: string; type: string; itemId: string; description: string }>> {
    this.requireConnected();
    const obj = await this.bot!.clientCommands.region.getObjectByLocalID(localId, true);
    await this.bot!.clientCommands.region.fetchObjectInventory(obj);
    return obj.inventory.map(item => ({
      name: item.name,
      type: AssetType[item.type] || `unknown(${item.type})`,
      itemId: item.itemID.toString(),
      description: item.description,
    }));
  }

  async touchObject(localId: number): Promise<void> {
    this.requireConnected();
    await this.bot!.clientCommands.region.touchObject(localId);
  }

  /** Delete (derez to trash) an object. Must be owned by the bot. */
  async deleteObject(localId: number): Promise<void> {
    this.requireConnected();
    const obj = await this.bot!.clientCommands.region.getObjectByLocalID(localId, true);
    await obj.deRezObject(DeRezDestination.TrashFolder, UUID.zero(), UUID.zero());
  }

  // ============ Internal ============

  private requireConnected(): void {
    if (!this.bot || this._state !== 'connected') {
      throw new Error('Bot is not logged in. Call sl_login first.');
    }
  }

  /**
   * Subscribe to bot events for tracking nearby avatars, friends, groups, and IMs.
   * Called once after login, before connectToSim.
   */
  private setupEventSubscriptions(): void {
    if (!this.bot) return;

    // Track nearby avatars — store with string IDs for easy lookup
    this.bot.clientEvents.onAvatarEnteredRegion.subscribe((avatar) => {
      // avatar.getKey() returns a UUID object — always .toString() for our Maps
      const avatarId = avatar.getKey().toString();
      if (avatarId === this.bot?.agentID().toString()) return;
      const pos = avatar.position;
      this.nearbyAvatars.set(avatarId, {
        id: avatarId,
        name: avatar.getName(),
        position: { x: pos.x, y: pos.y, z: pos.z },
      });

      avatar.onMoved.subscribe(() => {
        const existing = this.nearbyAvatars.get(avatarId);
        if (existing) {
          const p = avatar.position;
          existing.position = { x: p.x, y: p.y, z: p.z };
        }
      });

      avatar.onLeftRegion.subscribe(() => {
        this.nearbyAvatars.delete(avatarId);
      });
    });

    // Track friend online status
    this.bot.clientEvents.onFriendOnline.subscribe((event) => {
      const friendId = event.friend.getKey().toString();
      const friend = this.friends.get(friendId);
      if (friend) friend.online = event.online;
    });

    // Track groups — arrives via AgentGroupDataUpdate event after login
    this.bot.clientEvents.onAgentGroupDataUpdate.subscribe((event) => {
      this.groups.clear();
      for (const g of event.groups) {
        // groupID is a UUID object — .toString() for our string-keyed Map
        this.groups.set(g.groupID.toString(), {
          id: g.groupID.toString(),
          name: g.groupName,
        });
      }
    });

    // Collect nearby chat (ring buffer of last N messages)
    this.bot.clientEvents.onNearbyChat.subscribe((event) => {
      // Skip our own messages
      if (event.from.toString() === this.bot?.agentID().toString()) return;
      // Only collect agent chat (not objects/system)
      if (event.sourceType !== ChatSourceType.Agent) return;
      // Skip typing indicators
      if (event.chatType === ChatType.StartTyping || event.chatType === ChatType.StopTyping) return;
      const chatTypeNames: Record<number, string> = {
        [ChatType.Whisper]: 'whisper',
        [ChatType.Normal]: 'normal',
        [ChatType.Shout]: 'shout',
      };
      this.recentChat.push({
        fromName: event.fromName,
        fromId: event.from.toString(),
        message: event.message,
        chatType: chatTypeNames[event.chatType] || 'unknown',
        timestamp: Date.now(),
      });
      if (this.recentChat.length > this.maxRecentChat) {
        this.recentChat.shift();
      }
    });

    // Collect incoming IMs (ring buffer of last N messages)
    this.bot.clientEvents.onInstantMessage.subscribe((event) => {
      // Skip typing indicators
      if (event.flags & InstantMessageEventFlags.startTyping ||
        event.flags & InstantMessageEventFlags.finishTyping) return;
      this.recentIMs.push({
        fromName: event.fromName,
        fromId: event.from.toString(),
        message: event.message,
        timestamp: Date.now(),
      });
      if (this.recentIMs.length > this.maxRecentIMs) {
        this.recentIMs.shift();
      }
    });
  }

  /**
   * Populate friends from the login response buddy list.
   * Names are resolved asynchronously in the background.
   */
  private populateFriendsFromLogin(): void {
    if (!this.bot) return;
    for (const buddy of this.bot.agent.buddyList) {
      // buddyID is a UUID object
      const friendId = buddy.buddyID.toString();
      this.friends.set(friendId, {
        id: friendId,
        name: '', // resolved async below
        online: false,
      });
      // Resolve legacy name in background
      this.bot.clientCommands.grid.avatarKey2Name(new UUID(friendId))
        .then((result) => {
          const info = Array.isArray(result) ? result[0] : result;
          const friend = this.friends.get(friendId);
          if (friend && info) friend.name = info.getName();
        })
        .catch(() => { });
    }
  }
}
