/**
 * MetaverseConnection - node-metaverse Bot wrapper
 *
 * Manages connection to Second Life via node-metaverse before handoff to the viewer.
 * Handles chat, friends, and groups during the metaverse-connected state.
 */

import { EventEmitter } from 'events';
import { Bot, BotOptionFlags, LoginParameters, Vector3 } from '../../node-metaverse/dist/lib';
import { ChatType } from '../../node-metaverse/dist/lib/enums/ChatType';
import { ChatSourceType } from '../../node-metaverse/dist/lib/enums/ChatSourceType';
import { InstantMessageEventFlags } from '../../node-metaverse/dist/lib/enums/InstantMessageEventFlags';
import { RightsFlags } from '../../node-metaverse/dist/lib/enums/RightsFlags';
import {
  ConnectionState,
  ChatMessage,
  ChatSession,
  Friend,
  Group,
  NearbyAvatar,
  RegionInfo,
} from '../shared/types';
import { DisplayNameCache } from './display-name-cache';

export interface LoginParams {
  firstName: string;
  lastName: string;
  password: string;
  gridLoginUri: string;
  startLocation?: string;
}

export interface HandoffData {
  agent_id: string;
  session_id: string;
  secure_session_id: string;
  circuit_code: number;
  sim_ip: string;
  sim_port: number;
  seed_capability: string;
  region_handle: string;
  first_name: string;
  last_name: string;
  inventory_root?: string;
  inventory_lib_root?: string;
  inventory_lib_owner?: string;
  inventory_skeleton?: Array<{
    folder_id: string;
    parent_id: string;
    name: string;
    type_default: number;
    version: number;
  }>;
  inventory_skel_lib?: Array<{
    folder_id: string;
    parent_id: string;
    name: string;
    type_default: number;
    version: number;
  }>;
  agent_appearance_service?: string;
  account_type?: string;
  account_level_benefits?: Record<string, unknown>;
  premium_packages?: Record<string, { benefits: Record<string, unknown> }>;
  // Session continuation fields - viewer reuses bot's UDP port
  session_continuation?: boolean;
  sequence_number?: number;
  local_port?: number;
}

export interface MetaverseConnectionEvents {
  'state-change': (state: ConnectionState) => void;
  'nearby-chat': (message: ChatMessage) => void;
  'im': (message: ChatMessage) => void;
  'group-chat': (message: ChatMessage) => void;
  'friends-update': (friends: Friend[]) => void;
  'friend-online': (friend: Friend, online: boolean) => void;
  'groups-update': (groups: Group[]) => void;
  'nearby-avatars-update': (avatars: NearbyAvatar[]) => void;
  'error': (error: Error) => void;
  'login-progress': (message: string) => void;
}

export class MetaverseConnection extends EventEmitter {
  private bot: Bot | null = null;
  private state: ConnectionState = 'disconnected';
  private friends: Map<string, Friend> = new Map();
  private groups: Map<string, Group> = new Map();
  private chatSessions: Map<string, ChatSession> = new Map();
  private nearbyAvatars: Map<string, NearbyAvatar> = new Map();
  private avatarLeftSubscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private loginResponse: Record<string, unknown> | null = null;
  private messageIdCounter = 0;
  private displayNameCache: DisplayNameCache | null = null;
  private accountId: string | null = null;

  constructor(public readonly instanceId: string) {
    super();
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('state-change', newState);
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${++this.messageIdCounter}`;
  }

  /**
   * Login to Second Life via node-metaverse
   */
  async login(params: LoginParams): Promise<void> {
    if (this.state !== 'disconnected') {
      throw new Error(`Cannot login: connection is ${this.state}`);
    }

    this.setState('logging_in');
    this.emit('login-progress', 'Initializing...');

    try {
      const loginParams = new LoginParameters();
      loginParams.firstName = params.firstName;
      loginParams.lastName = params.lastName;
      loginParams.password = params.password;
      loginParams.url = params.gridLoginUri;
      loginParams.start = params.startLocation || 'last';

      this.bot = new Bot(loginParams, BotOptionFlags.None);

      // Enable teleport handoff mode for later viewer handoff
      this.bot.teleportHandoffMode = true;

      // Create display name cache keyed by account
      this.accountId = `${params.firstName}.${params.lastName}`.toLowerCase();
      this.displayNameCache = new DisplayNameCache(this.accountId);

      this.emit('login-progress', 'Logging in...');
      this.loginResponse = await this.bot.login() as unknown as Record<string, unknown>;

      // Set up event subscriptions BEFORE connecting so we catch early events
      this.setupEventSubscriptions();

      // Populate friends list from login response BEFORE connecting
      // so friend online events have friends to update
      this.populateFriendsFromLogin();

      this.emit('login-progress', 'Connecting to simulator...');
      await this.bot.connectToSim();

      // Groups will be populated from AgentGroupDataUpdate event
      // For now, initialize empty - groups arrive via event queue

      this.setState('metaverse_connected');
      this.emit('login-progress', `Connected to ${this.bot.currentRegion?.regionName || 'region'}`);

      // Resolve display names for all friends in background
      this.resolveDisplayNamesForFriends().catch((err) => {
        console.error('[MetaverseConnection] Error resolving friend display names:', err);
      });

    } catch (error) {
      this.setState('disconnected');
      this.bot = null;
      throw error;
    }
  }

  /**
   * Disconnect from Second Life
   */
  async logout(): Promise<void> {
    if (this.displayNameCache) {
      this.displayNameCache.flush();
    }
    if (this.bot) {
      try {
        await this.bot.close();
      } catch (e) {
        // Ignore close errors
      }
      this.bot = null;
    }
    this.friends.clear();
    this.groups.clear();
    this.chatSessions.clear();
    this.nearbyAvatars.clear();
    // Clean up avatar subscriptions
    for (const sub of this.avatarLeftSubscriptions.values()) {
      sub.unsubscribe();
    }
    this.avatarLeftSubscriptions.clear();
    this.setState('disconnected');
  }

  /**
   * Set up event subscriptions for chat, friends, and groups
   */
  private setupEventSubscriptions(): void {
    if (!this.bot) return;

    // Nearby chat
    this.bot.clientEvents.onNearbyChat.subscribe((event) => {
      const chatTypeMap: Record<number, 'whisper' | 'normal' | 'shout'> = {
        0: 'whisper',
        1: 'normal',
        2: 'shout',
      };

      const sourceTypeMap: Record<number, 'agent' | 'object' | 'system'> = {
        [ChatSourceType.Agent]: 'agent',
        [ChatSourceType.Object]: 'object',
        [ChatSourceType.System]: 'system',
      };

      // Skip our own messages - we already emit them locally in sendNearbyChat()
      // This avoids duplicates while still allowing server confirmation
      const fromId = event.from.toString();
      if (fromId === this.bot?.agentID().toString()) {
        // TODO: Could emit a 'message-confirmed' event here for UI feedback
        return;
      }

      // Use cached display name if available
      const displayName = this.displayNameCache?.getBestName(fromId);

      const message: ChatMessage = {
        id: this.generateMessageId(),
        type: 'nearby',
        message: event.message,
        fromName: displayName || event.fromName,
        fromId,
        timestamp: Date.now(),
        chatType: chatTypeMap[event.chatType] || 'normal',
        sourceType: sourceTypeMap[event.sourceType] || 'agent',
      };

      this.emit('nearby-chat', message);
    });

    // Instant messages
    this.bot.clientEvents.onInstantMessage.subscribe((event) => {
      // Skip typing indicators
      if (event.flags & InstantMessageEventFlags.startTyping ||
        event.flags & InstantMessageEventFlags.finishTyping) {
        return;
      }

      const fromId = event.from.toString();
      const sessionId = fromId; // IM sessions use participant ID as session ID
      const displayName = this.displayNameCache?.getBestName(fromId);
      const nameToUse = displayName || event.fromName;

      // Create or update chat session
      if (!this.chatSessions.has(sessionId)) {
        const session: ChatSession = {
          id: sessionId,
          type: 'im',
          name: nameToUse,
          participantId: fromId,
          unreadCount: 1,
          lastMessage: event.message,
          lastMessageTime: Date.now(),
        };
        this.chatSessions.set(sessionId, session);
        this.emit('chat-session-update', session);
      } else {
        const session = this.chatSessions.get(sessionId)!;
        session.unreadCount++;
        session.lastMessage = event.message;
        session.lastMessageTime = Date.now();
        // Update session name if we now have a display name
        if (displayName) {
          session.name = displayName;
        }
        this.emit('chat-session-update', session);
      }

      const message: ChatMessage = {
        id: this.generateMessageId(),
        type: 'im',
        message: event.message,
        fromName: nameToUse,
        fromId: fromId,
        timestamp: Date.now(),
        sessionId: sessionId,
        isOutgoing: false,
      };

      this.emit('im', message);
    });

    // Group chat
    this.bot.clientEvents.onGroupChat.subscribe((event) => {
      const groupId = event.groupID.toString();
      const group = this.groups.get(groupId);

      // Create or update chat session
      if (!this.chatSessions.has(groupId)) {
        const session: ChatSession = {
          id: groupId,
          type: 'group',
          name: group?.name || 'Group',
          groupId: groupId,
          unreadCount: 1,
          lastMessage: event.message,
          lastMessageTime: Date.now(),
        };
        this.chatSessions.set(groupId, session);
        this.emit('chat-session-update', session);
      } else {
        const session = this.chatSessions.get(groupId)!;
        session.unreadCount++;
        session.lastMessage = event.message;
        session.lastMessageTime = Date.now();
        this.emit('chat-session-update', session);
      }

      const groupFromId = event.from.toString();
      const groupDisplayName = this.displayNameCache?.getBestName(groupFromId);

      const message: ChatMessage = {
        id: this.generateMessageId(),
        type: 'group',
        message: event.message,
        fromName: groupDisplayName || event.fromName,
        fromId: groupFromId,
        timestamp: Date.now(),
        sessionId: groupId,
        isOutgoing: groupFromId === this.bot?.agentID().toString(),
      };

      this.emit('group-chat', message);
    });

    // Friend online status
    this.bot.clientEvents.onFriendOnline.subscribe((event) => {
      const friendId = event.friend.getKey().toString();
      console.log(`[MetaverseConnection] onFriendOnline: ${friendId} online=${event.online}`);
      console.log(`[MetaverseConnection] Friends map has ${this.friends.size} entries`);
      const friend = this.friends.get(friendId);
      if (friend) {
        console.log(`[MetaverseConnection] Found friend ${friend.name}, setting online=${event.online}`);
        friend.online = event.online;
        this.emit('friend-online', friend, event.online);
        this.emit('friends-update', Array.from(this.friends.values()));
      } else {
        console.log(`[MetaverseConnection] Friend ${friendId} not found in map`);
      }
    });

    // Friend rights changes
    this.bot.clientEvents.onFriendRights.subscribe((event) => {
      const friendId = event.friend.getKey().toString();
      const friend = this.friends.get(friendId);
      if (friend) {
        friend.canSeeOnline = (event.theirRights & RightsFlags.CanSeeOnline) !== 0;
        friend.canSeeOnMap = (event.theirRights & RightsFlags.CanSeeOnMap) !== 0;
        friend.canModifyObjects = (event.theirRights & RightsFlags.CanModifyObjects) !== 0;
        this.emit('friends-update', Array.from(this.friends.values()));
      }
    });

    // Friend removed
    this.bot.clientEvents.onFriendRemoved.subscribe((event) => {
      const friendId = event.friend.getKey().toString();
      this.friends.delete(friendId);
      this.emit('friends-update', Array.from(this.friends.values()));
    });

    // Group data update (received from event queue after login)
    this.bot.clientEvents.onAgentGroupDataUpdate.subscribe((event) => {
      console.log(`[MetaverseConnection] onAgentGroupDataUpdate received with ${event.groups.length} groups`);
      // Clear and rebuild groups map from event data
      this.groups.clear();
      for (const groupData of event.groups) {
        const group: Group = {
          id: groupData.groupID.toString(),
          name: groupData.groupName,
          insigniaId: groupData.groupInsigniaID.toString(),
          contribution: groupData.contribution,
          powers: groupData.groupPowers,
        };
        this.groups.set(group.id, group);
        console.log(`[MetaverseConnection] Added group: ${group.name} (${group.id})`);
      }
      console.log(`[MetaverseConnection] Emitting groups-update with ${this.groups.size} groups`);
      this.emit('groups-update', Array.from(this.groups.values()));
    });

    // Avatar entered region
    this.bot.clientEvents.onAvatarEnteredRegion.subscribe((avatar) => {
      const avatarId = avatar.getKey().toString();
      // Skip our own avatar
      if (avatarId === this.bot?.agentID().toString()) {
        return;
      }

      const pos = avatar.position;
      // Use cached display name if available, fall back to legacy name
      const cachedName = this.displayNameCache?.getBestName(avatarId);
      const nearbyAvatar: NearbyAvatar = {
        id: avatarId,
        name: cachedName || avatar.getName(),
        title: avatar.getTitle() || undefined,
        position: { x: pos.x, y: pos.y, z: pos.z },
      };
      this.nearbyAvatars.set(avatarId, nearbyAvatar);

      // Resolve display name in background if not cached
      if (!cachedName || this.displayNameCache?.isStale(avatarId)) {
        this.resolveDisplayNames([avatarId]).then(() => {
          const updated = this.nearbyAvatars.get(avatarId);
          const newName = this.displayNameCache?.getBestName(avatarId);
          if (updated && newName && updated.name !== newName) {
            updated.name = newName;
            this.emit('nearby-avatars-update', Array.from(this.nearbyAvatars.values()));
          }
        }).catch(() => {});
      }

      // Subscribe to avatar movement to update position
      const moveSubscription = avatar.onMoved.subscribe(() => {
        const existing = this.nearbyAvatars.get(avatarId);
        if (existing) {
          const newPos = avatar.position;
          existing.position = { x: newPos.x, y: newPos.y, z: newPos.z };
          this.emit('nearby-avatars-update', Array.from(this.nearbyAvatars.values()));
        }
      });

      // Subscribe to avatar leaving
      const leftSubscription = avatar.onLeftRegion.subscribe(() => {
        this.nearbyAvatars.delete(avatarId);
        const sub = this.avatarLeftSubscriptions.get(avatarId);
        if (sub) {
          sub.unsubscribe();
          this.avatarLeftSubscriptions.delete(avatarId);
        }
        this.emit('nearby-avatars-update', Array.from(this.nearbyAvatars.values()));
      });

      // Store both subscriptions
      this.avatarLeftSubscriptions.set(avatarId, {
        unsubscribe: () => {
          moveSubscription.unsubscribe();
          leftSubscription.unsubscribe();
        }
      });

      this.emit('nearby-avatars-update', Array.from(this.nearbyAvatars.values()));
    });
  }

  /**
   * Populate friends list from login response buddy list
   */
  private populateFriendsFromLogin(): void {
    if (!this.bot) return;

    console.log(`[MetaverseConnection] populateFriendsFromLogin: ${this.bot.agent.buddyList.length} buddies`);
    for (const buddy of this.bot.agent.buddyList) {
      const friendId = buddy.buddyID.toString();
      console.log(`[MetaverseConnection] Adding friend: ${friendId}`);
      const friend: Friend = {
        id: friendId,
        name: '', // Will be resolved later via name lookup
        online: false, // Will be updated via online notification
        canSeeOnline: buddy.buddyRightsHas,
        canSeeOnMap: false,
        canModifyObjects: false,
      };
      this.friends.set(friend.id, friend);

      // Resolve name asynchronously
      this.resolveFriendName(buddy.buddyID.toString()).catch(() => {
        // Ignore name resolution errors
      });
    }

    this.emit('friends-update', Array.from(this.friends.values()));
  }

  /**
   * Resolve a friend's name from their UUID
   */
  private async resolveFriendName(friendId: string): Promise<void> {
    if (!this.bot) return;

    try {
      // Check display name cache first
      const cachedName = this.displayNameCache?.getBestName(friendId);
      if (cachedName) {
        const friend = this.friends.get(friendId);
        if (friend) {
          friend.name = cachedName;
          return; // Will emit friends-update in bulk after all resolves
        }
      }

      const { UUID } = await import('../../node-metaverse/dist/lib/classes/UUID');
      const uuid = new UUID(friendId);
      const nameResult = await this.bot.clientCommands.grid.avatarKey2Name(uuid);
      const friend = this.friends.get(friendId);
      if (friend && nameResult) {
        // avatarKey2Name can return single result or array
        const nameInfo = Array.isArray(nameResult) ? nameResult[0] : nameResult;
        if (nameInfo) {
          friend.name = nameInfo.getName();
          this.emit('friends-update', Array.from(this.friends.values()));
        }
      }
    } catch (e) {
      // Name resolution failed, keep empty name
    }
  }

  // ============ Display Name Resolution ============

  /**
   * Batch-resolve display names for a list of UUIDs.
   * Filters out already-cached (non-stale) entries before calling the server.
   */
  private async resolveDisplayNames(uuids: string[]): Promise<void> {
    if (!this.bot || !this.displayNameCache) {
      console.log(`[MetaverseConnection] resolveDisplayNames: skipped (bot=${!!this.bot}, cache=${!!this.displayNameCache})`);
      return;
    }

    // Filter to only uncached or stale UUIDs
    const toResolve = uuids.filter(uuid => !this.displayNameCache!.get(uuid) || this.displayNameCache!.isStale(uuid));
    console.log(`[MetaverseConnection] resolveDisplayNames: ${uuids.length} total, ${toResolve.length} to resolve`);
    if (toResolve.length === 0) return;

    try {
      const { UUID } = await import('../../node-metaverse/dist/lib/classes/UUID');
      const uuidObjects = toResolve.map(id => new UUID(id));
      const results = await this.bot.clientCommands.grid.getDisplayNames(uuidObjects);
      console.log(`[MetaverseConnection] resolveDisplayNames: got ${results.size} results`);
      if (results.size > 0) {
        this.displayNameCache.bulkSet(results);
        console.log(`[DisplayNameCache] Resolved ${results.size} display names`);
      }
    } catch (err) {
      console.error('[MetaverseConnection] Error resolving display names:', err);
    }
  }

  /**
   * Resolve display names for all friends after login.
   * Updates friend names with display names and re-emits friends-update.
   */
  private async resolveDisplayNamesForFriends(): Promise<void> {
    const friendIds = Array.from(this.friends.keys());
    if (friendIds.length === 0) return;

    await this.resolveDisplayNames(friendIds);

    // Update friend names with resolved display names
    let updated = false;
    for (const [friendId, friend] of this.friends) {
      const displayName = this.displayNameCache?.getBestName(friendId);
      if (displayName && friend.name !== displayName) {
        friend.name = displayName;
        updated = true;
      }
    }
    if (updated) {
      this.emit('friends-update', Array.from(this.friends.values()));
    }
  }

  /**
   * Get the display name cache (for use by IPC handlers)
   */
  getDisplayNameCache(): DisplayNameCache | null {
    return this.displayNameCache;
  }

  // ============ Chat Methods ============

  /**
   * Send nearby chat message
   */
  async sendNearbyChat(message: string, type: 'whisper' | 'normal' | 'shout' = 'normal', channel = 0): Promise<void> {
    if (!this.bot || this.state !== 'metaverse_connected') {
      throw new Error('Not connected to metaverse');
    }

    const chatTypeMap: Record<string, ChatType> = {
      'whisper': ChatType.Whisper,
      'normal': ChatType.Normal,
      'shout': ChatType.Shout,
    };

    await this.bot.clientCommands.comms.nearbyChat(message, chatTypeMap[type], channel);

    // Emit our own message for UI echo
    const outMessage: ChatMessage = {
      id: this.generateMessageId(),
      type: 'nearby',
      message,
      fromName: `${this.bot.agent.firstName} ${this.bot.agent.lastName}`,
      fromId: this.bot.agentID().toString(),
      timestamp: Date.now(),
      chatType: type,
      sourceType: 'agent',
      isOutgoing: true,
    };
    this.emit('nearby-chat', outMessage);
  }

  /**
   * Send instant message to another avatar
   */
  async sendIM(toId: string, message: string): Promise<void> {
    if (!this.bot || this.state !== 'metaverse_connected') {
      throw new Error('Not connected to metaverse');
    }

    await this.bot.clientCommands.comms.sendInstantMessage(toId, message);

    // Emit our own message for UI echo
    const session = this.chatSessions.get(toId);
    const outMessage: ChatMessage = {
      id: this.generateMessageId(),
      type: 'im',
      message,
      fromName: `${this.bot.agent.firstName} ${this.bot.agent.lastName}`,
      fromId: this.bot.agentID().toString(),
      timestamp: Date.now(),
      sessionId: toId,
      isOutgoing: true,
    };
    this.emit('im', outMessage);
  }

  /**
   * Send group chat message
   */
  async sendGroupMessage(groupId: string, message: string): Promise<void> {
    if (!this.bot || this.state !== 'metaverse_connected') {
      throw new Error('Not connected to metaverse');
    }

    await this.bot.clientCommands.comms.sendGroupMessage(groupId, message);

    // Note: Group messages echo back via onGroupChat event, so no manual emit needed
  }

  /**
   * Start an IM session (create it in sessions map)
   */
  startIMSession(participantId: string, participantName: string): ChatSession {
    if (this.chatSessions.has(participantId)) {
      return this.chatSessions.get(participantId)!;
    }

    const session: ChatSession = {
      id: participantId,
      type: 'im',
      name: participantName,
      participantId,
      unreadCount: 0,
    };
    this.chatSessions.set(participantId, session);
    this.emit('chat-session-update', session);
    return session;
  }

  /**
   * Start a group chat session
   */
  async startGroupChatSession(groupId: string): Promise<ChatSession> {
    console.log(`[MetaverseConnection] startGroupChatSession called for group ${groupId}, state: ${this.state}`);
    if (!this.bot || this.state !== 'metaverse_connected') {
      throw new Error('Not connected to metaverse');
    }

    try {
      console.log(`[MetaverseConnection] Calling bot.clientCommands.comms.startGroupChatSession`);
      await this.bot.clientCommands.comms.startGroupChatSession(groupId, '');
      console.log(`[MetaverseConnection] Group chat session started successfully`);
    } catch (err) {
      console.error(`[MetaverseConnection] Error starting group chat session:`, err);
      throw err;
    }

    const group = this.groups.get(groupId);
    const session: ChatSession = {
      id: groupId,
      type: 'group',
      name: group?.name || 'Group',
      groupId,
      unreadCount: 0,
    };
    this.chatSessions.set(groupId, session);
    console.log(`[MetaverseConnection] Emitting chat-session-update for group: ${session.name}`);
    this.emit('chat-session-update', session);
    return session;
  }

  // ============ Data Access ============

  getFriends(): Friend[] {
    return Array.from(this.friends.values());
  }

  getGroups(): Group[] {
    return Array.from(this.groups.values());
  }

  getNearbyAvatars(): NearbyAvatar[] {
    return Array.from(this.nearbyAvatars.values());
  }

  getRegionInfo(): RegionInfo | null {
    if (!this.bot?.currentRegion) return null;
    const region = this.bot.currentRegion;
    const x = region.xCoordinate;
    const y = region.yCoordinate;
    // Get our own avatar position from the region's avatar list
    let agentPosition: { x: number; y: number; z: number } | undefined;
    const selfAvatar = region.agents.get(this.bot.agentID().toString());
    if (selfAvatar) {
      const pos = selfAvatar.position;
      agentPosition = { x: pos.x, y: pos.y, z: pos.z };
    }
    return {
      name: region.regionName,
      x,
      y,
      mapImageUrl: `https://secondlife-maps-cdn.akamaized.net/map-1-${x}-${y}-objects.jpg`,
      agentPosition,
    };
  }

  getChatSessions(): ChatSession[] {
    return Array.from(this.chatSessions.values());
  }

  getChatSession(sessionId: string): ChatSession | undefined {
    return this.chatSessions.get(sessionId);
  }

  markSessionRead(sessionId: string): void {
    const session = this.chatSessions.get(sessionId);
    if (session) {
      session.unreadCount = 0;
      this.emit('chat-session-update', session);
    }
  }

  /**
   * Get the underlying bot instance (for advanced operations)
   */
  getBot(): Bot | null {
    return this.bot;
  }

  /**
   * Get the current region name (if connected and in a region)
   */
  getRegionName(): string | undefined {
    return this.bot?.currentRegion?.regionName;
  }
}

/**
 * Manages MetaverseConnection instances
 */
export class MetaverseConnectionManager extends EventEmitter {
  private connections: Map<string, MetaverseConnection> = new Map();

  create(instanceId: string): MetaverseConnection {
    if (this.connections.has(instanceId)) {
      throw new Error(`Connection ${instanceId} already exists`);
    }

    const connection = new MetaverseConnection(instanceId);
    this.connections.set(instanceId, connection);

    // Forward events
    connection.on('state-change', (state) => {
      this.emit('state-change', instanceId, state);
    });
    connection.on('nearby-chat', (message) => {
      this.emit('nearby-chat', instanceId, message);
    });
    connection.on('im', (message) => {
      this.emit('im', instanceId, message);
    });
    connection.on('group-chat', (message) => {
      this.emit('group-chat', instanceId, message);
    });
    connection.on('friends-update', (friends) => {
      this.emit('friends-update', instanceId, friends);
    });
    connection.on('friend-online', (friend, online) => {
      this.emit('friend-online', instanceId, friend, online);
    });
    connection.on('groups-update', (groups) => {
      this.emit('groups-update', instanceId, groups);
    });
    connection.on('nearby-avatars-update', (avatars) => {
      this.emit('nearby-avatars-update', instanceId, avatars);
    });
    connection.on('chat-session-update', (session) => {
      this.emit('chat-session-update', instanceId, session);
    });
    connection.on('error', (error) => {
      this.emit('error', instanceId, error);
    });

    return connection;
  }

  get(instanceId: string): MetaverseConnection | undefined {
    return this.connections.get(instanceId);
  }

  async remove(instanceId: string): Promise<void> {
    const connection = this.connections.get(instanceId);
    if (connection) {
      await connection.logout();
      this.connections.delete(instanceId);
    }
  }

  async removeAll(): Promise<void> {
    for (const [instanceId] of this.connections) {
      await this.remove(instanceId);
    }
  }

  getAll(): MetaverseConnection[] {
    return Array.from(this.connections.values());
  }
}

export const metaverseConnectionManager = new MetaverseConnectionManager();
