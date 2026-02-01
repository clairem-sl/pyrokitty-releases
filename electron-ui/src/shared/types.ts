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
  STOP_VIEWER: 'viewer:stop',
  GET_INSTANCES: 'viewer:instances',
  VIEWER_STATUS_UPDATE: 'viewer:status-update',
} as const;

// IPC Request/Response types
export interface LaunchViewerRequest {
  accountId: string;
  password?: string; // Required if account doesn't have saved password
}

export interface AddAccountRequest {
  gridId: string;
  firstName: string;
  lastName: string;
  password?: string; // Only included if savePassword is true
  savePassword: boolean;
}
