// Grid configuration
export interface Grid {
  id: string;
  name: string;
  nick: string;
  loginUri: string;
  helperUri?: string;
  webProfileUrl?: string;
  slurlBase?: string;
}

// Connection states for dual-mode operation
export type ConnectionState =
  | 'disconnected'
  | 'logging_in'
  | 'metaverse_connected'
  | 'handoff_in_progress'
  | 'viewer_connected'
  | 'disconnecting';

// Chat types
export type ChatType = 'nearby' | 'im' | 'group';

export interface ChatMessage {
  id: string;
  type: ChatType;
  message: string;
  fromName: string;
  fromId: string;
  timestamp: number;
  // For nearby chat
  chatType?: 'whisper' | 'normal' | 'shout';
  sourceType?: 'agent' | 'object' | 'system';
  // For IM/group
  sessionId?: string;
  isOutgoing?: boolean;
}

export interface ChatSession {
  id: string;
  type: 'im' | 'group';
  name: string;
  participantId?: string; // For IM sessions
  groupId?: string; // For group sessions
  unreadCount: number;
  lastMessage?: string;
  lastMessageTime?: number;
}

// Friend types
export interface Friend {
  id: string;
  name: string;
  online: boolean;
  canSeeOnline: boolean;
  canSeeOnMap: boolean;
  canModifyObjects: boolean;
}

// Group types
export interface Group {
  id: string;
  name: string;
  insigniaId?: string;
  contribution?: number;
  powers?: string;
}

// Account stored in accounts.json
export interface Account {
  id: string;
  gridId: string;
  firstName: string;
  lastName: string;
  password?: string; // Only saved if user opted in
}

// Running viewer instance
export interface ViewerInstance {
  id: string;
  accountId: string;
  gridId: string;
  pid: number;
  wsPort: number;
  startTime: number;
  status: ViewerStatus;
  connectionState: ConnectionState;
}

export type ViewerStatus = 'starting' | 'running' | 'connected' | 'disconnected' | 'crashed';

// IPC Channel names
export const IPC_CHANNELS = {
  // Grid operations
  GET_GRIDS: 'grids:get',

  // Account operations
  GET_ACCOUNTS: 'accounts:get',
  ADD_ACCOUNT: 'accounts:add',
  UPDATE_ACCOUNT: 'accounts:update',
  REMOVE_ACCOUNT: 'accounts:remove',

  // Viewer operations
  LAUNCH_VIEWER: 'viewer:launch',
  LAUNCH_VIEWER_FOR_INSTANCE: 'viewer:launch-for-instance',
  STOP_VIEWER: 'viewer:stop',
  GET_INSTANCES: 'viewer:instances',
  VIEWER_STATUS_UPDATE: 'viewer:status-update',

  // Chat operations (renderer -> main)
  SEND_NEARBY_CHAT: 'chat:send-nearby',
  SEND_IM: 'chat:send-im',
  SEND_GROUP_IM: 'chat:send-group-im',

  // Chat events (main -> renderer)
  CHAT_MESSAGE: 'chat:message',
  VIEWER_WS_CONNECTED: 'viewer:ws-connected',

  // Friends operations
  GET_FRIENDS: 'friends:get',
  FRIENDS_UPDATE: 'friends:update',
  FRIEND_ONLINE: 'friends:online',

  // Groups operations
  GET_GROUPS: 'groups:get',
  GROUPS_UPDATE: 'groups:update',

  // Connection state
  CONNECTION_STATE_UPDATE: 'connection:state-update',

  // Chat sessions
  GET_CHAT_SESSIONS: 'chat:get-sessions',
  CHAT_SESSION_UPDATE: 'chat:session-update',
  START_IM_SESSION: 'chat:start-im',
  START_GROUP_CHAT: 'chat:start-group',
} as const;

// IPC Request/Response types
export interface LaunchViewerRequest {
  accountId: string;
  password?: string; // Required if account doesn't have saved password
  startLocation?: string; // 'home', 'last', or 'uri:RegionName&x&y&z'
  launchViewer?: boolean; // Default true - set to false to stay in metaverse-only mode
}

export interface AddAccountRequest {
  gridId: string;
  firstName: string;
  lastName: string;
  password?: string; // Only included if savePassword is true
  savePassword: boolean;
}

// WebSocket protocol types
export interface WSMessage {
  pump: string;
  data: Record<string, unknown>;
}

export interface WSConnectedMessage {
  type: 'connected';
  reply_pump: string;
  apis: Array<{ name: string; desc: string }>;
}

export interface ChatEvent {
  type: 'nearby' | 'im';
  message: string;
  from_name: string;
  from_id: string;
  time?: string;
  // Nearby-specific
  source_type?: number;
  chat_type?: number;
  // IM-specific
  session_id?: string;
  session_type?: string;
}

export interface ViewerAPI {
  name: string;
  desc: string;
}
