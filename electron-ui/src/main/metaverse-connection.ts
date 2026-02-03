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
} from '../shared/types';

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
  agent_appearance_service?: string;
  account_type?: string;
  account_level_benefits?: Record<string, unknown>;
  premium_packages?: Record<string, { benefits: Record<string, unknown> }>;
}

export interface MetaverseConnectionEvents {
  'state-change': (state: ConnectionState) => void;
  'nearby-chat': (message: ChatMessage) => void;
  'im': (message: ChatMessage) => void;
  'group-chat': (message: ChatMessage) => void;
  'friends-update': (friends: Friend[]) => void;
  'friend-online': (friend: Friend, online: boolean) => void;
  'groups-update': (groups: Group[]) => void;
  'error': (error: Error) => void;
  'login-progress': (message: string) => void;
}

export class MetaverseConnection extends EventEmitter {
  private bot: Bot | null = null;
  private state: ConnectionState = 'disconnected';
  private friends: Map<string, Friend> = new Map();
  private groups: Map<string, Group> = new Map();
  private chatSessions: Map<string, ChatSession> = new Map();
  private loginResponse: Record<string, unknown> | null = null;
  private messageIdCounter = 0;

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

      this.emit('login-progress', 'Logging in...');
      this.loginResponse = await this.bot.login() as unknown as Record<string, unknown>;

      this.emit('login-progress', 'Connecting to simulator...');
      await this.bot.connectToSim();

      // Set up event subscriptions
      this.setupEventSubscriptions();

      // Populate friends list from login response
      this.populateFriendsFromLogin();

      // Groups will be populated from AgentGroupDataUpdate event
      // For now, initialize empty - groups arrive via event queue

      this.setState('metaverse_connected');
      this.emit('login-progress', `Connected to ${this.bot.currentRegion?.regionName || 'region'}`);

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

      const message: ChatMessage = {
        id: this.generateMessageId(),
        type: 'nearby',
        message: event.message,
        fromName: event.fromName,
        fromId: event.from.toString(),
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

      // Create or update chat session
      if (!this.chatSessions.has(sessionId)) {
        const session: ChatSession = {
          id: sessionId,
          type: 'im',
          name: event.fromName,
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
        this.emit('chat-session-update', session);
      }

      const message: ChatMessage = {
        id: this.generateMessageId(),
        type: 'im',
        message: event.message,
        fromName: event.fromName,
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

      const message: ChatMessage = {
        id: this.generateMessageId(),
        type: 'group',
        message: event.message,
        fromName: event.fromName,
        fromId: event.from.toString(),
        timestamp: Date.now(),
        sessionId: groupId,
        isOutgoing: event.from.toString() === this.bot?.agentID().toString(),
      };

      this.emit('group-chat', message);
    });

    // Friend online status
    this.bot.clientEvents.onFriendOnline.subscribe((event) => {
      const friendId = event.friend.getKey().toString();
      const friend = this.friends.get(friendId);
      if (friend) {
        friend.online = event.online;
        this.emit('friend-online', friend, event.online);
        this.emit('friends-update', Array.from(this.friends.values()));
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
  }

  /**
   * Populate friends list from login response buddy list
   */
  private populateFriendsFromLogin(): void {
    if (!this.bot) return;

    for (const buddy of this.bot.agent.buddyList) {
      const friend: Friend = {
        id: buddy.buddyID.toString(),
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
    if (!this.bot || this.state !== 'metaverse_connected') {
      throw new Error('Not connected to metaverse');
    }

    await this.bot.clientCommands.comms.startGroupChatSession(groupId, '');

    const group = this.groups.get(groupId);
    const session: ChatSession = {
      id: groupId,
      type: 'group',
      name: group?.name || 'Group',
      groupId,
      unreadCount: 0,
    };
    this.chatSessions.set(groupId, session);
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

  // ============ Handoff Methods ============

  /**
   * Prepare handoff data for viewer
   * Teleports to destination and collects all necessary session data
   * If no destination provided, uses the current region (requires teleport to same region)
   */
  async prepareHandoff(destination?: string): Promise<HandoffData> {
    if (!this.bot || this.state !== 'metaverse_connected') {
      throw new Error('Not connected to metaverse');
    }

    this.setState('handoff_in_progress');

    try {
      // Use current region name if no destination specified
      const targetRegion = destination || this.bot.currentRegion?.regionName;
      if (!targetRegion) {
        throw new Error('No destination and no current region available');
      }

      // Get region info from grid
      const destRegion = await this.bot.clientCommands.grid.getRegionByName(targetRegion);
      const position = new Vector3([128, 128, 30]);
      const lookAt = new Vector3([1, 0, 0]);

      // Teleport to get fresh connection info
      const tpEvent = await this.bot.clientCommands.teleport.teleportTo(
        targetRegion,
        position,
        lookAt
      );
      const regionHandle = destRegion.handle.toString();

      const circuit = this.bot.currentRegion.circuit;

      // Build inventory skeleton
      const inventorySkeleton: HandoffData['inventory_skeleton'] = [];
      if (this.bot.agent.inventory?.main?.skeleton) {
        for (const [, folder] of this.bot.agent.inventory.main.skeleton) {
          inventorySkeleton.push({
            folder_id: folder.folderID.toString(),
            parent_id: folder.parentID.toString(),
            name: folder.name,
            type_default: folder.typeDefault,
            version: folder.version,
          });
        }
      }

      const handoffData: HandoffData = {
        agent_id: this.bot.agent.agentID.toString(),
        session_id: circuit.sessionID.toString(),
        secure_session_id: circuit.secureSessionID.toString(),
        circuit_code: circuit.circuitCode,
        sim_ip: tpEvent.simIP,
        sim_port: tpEvent.simPort,
        seed_capability: tpEvent.seedCapability,
        region_handle: regionHandle,
        first_name: this.bot.agent.firstName,
        last_name: this.bot.agent.lastName,
        inventory_root: this.bot.agent.inventory?.main?.root?.toString(),
        inventory_lib_root: this.bot.agent.inventory?.library?.root?.toString(),
        inventory_lib_owner: this.bot.agent.inventory?.library?.owner?.toString(),
        inventory_skeleton: inventorySkeleton,
        agent_appearance_service: this.bot.agent.agentAppearanceService,
        account_type: (this.loginResponse as Record<string, unknown>)?.accountType as string | undefined,
        account_level_benefits: (this.loginResponse as Record<string, unknown>)?.accountLevelBenefits as Record<string, unknown> | undefined,
        premium_packages: (this.loginResponse as Record<string, unknown>)?.premiumPackages as Record<string, { benefits: Record<string, unknown> }> | undefined,
      };

      return handoffData;

    } catch (error) {
      this.setState('metaverse_connected');
      throw error;
    }
  }

  /**
   * Complete handoff - bot disconnects, viewer takes over
   */
  completeHandoff(): void {
    // Don't fully close the bot - just mark state as handed off
    // The viewer will take over UDP communication
    this.setState('viewer_connected');
  }

  /**
   * Get the underlying bot instance (for advanced operations)
   */
  getBot(): Bot | null {
    return this.bot;
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
