import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, AddAccountRequest, LaunchViewerRequest, ChatMessage } from '../shared/types';
import { gridManager } from './grid-manager';
import { accountManager } from './account-manager';
import { viewerManager } from './viewer-manager';
import { connectionManager } from './viewer-connection';
import { metaverseConnectionManager } from './metaverse-connection';

export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  // Grid handlers
  ipcMain.handle(IPC_CHANNELS.GET_GRIDS, async () => {
    return gridManager.getAllGrids();
  });

  // Account handlers
  ipcMain.handle(IPC_CHANNELS.GET_ACCOUNTS, async () => {
    return accountManager.getAllAccounts();
  });

  ipcMain.handle(IPC_CHANNELS.ADD_ACCOUNT, async (_, request: AddAccountRequest) => {
    return accountManager.addAccount(
      request.gridId,
      request.firstName,
      request.lastName,
      request.savePassword ? request.password : undefined
    );
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_ACCOUNT, async (_, accountId: string, updates: any) => {
    return accountManager.updateAccount(accountId, updates);
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_ACCOUNT, async (_, accountId: string) => {
    return accountManager.removeAccount(accountId);
  });

  // Viewer handlers
  ipcMain.handle(IPC_CHANNELS.LAUNCH_VIEWER, async (_, request: LaunchViewerRequest) => {
    return viewerManager.launchViewer(request.accountId, request.password, {
      startLocation: request.startLocation,
      launchViewer: request.launchViewer,
    });
  });

  ipcMain.handle(IPC_CHANNELS.STOP_VIEWER, async (_, instanceId: string) => {
    return viewerManager.stopViewer(instanceId);
  });

  ipcMain.handle(IPC_CHANNELS.LAUNCH_VIEWER_FOR_INSTANCE, async (_, instanceId: string) => {
    return viewerManager.launchViewerForInstance(instanceId);
  });

  ipcMain.handle(IPC_CHANNELS.GET_INSTANCES, async () => {
    return viewerManager.getInstances();
  });

  // Forward viewer status updates to renderer
  viewerManager.on('status-update', (instance) => {
    mainWindow.webContents.send(IPC_CHANNELS.VIEWER_STATUS_UPDATE, instance);
  });

  // Chat handlers - route based on connection state
  ipcMain.handle(IPC_CHANNELS.SEND_NEARBY_CHAT, async (_, instanceId: string, message: string, type?: string, channel?: number) => {
    const instance = viewerManager.getInstance(instanceId);
    const chatType = (type as 'whisper' | 'normal' | 'shout') || 'normal';

    // Route based on connection state
    if (instance?.connectionState === 'viewer_connected') {
      const connection = viewerManager.getConnection(instanceId);
      if (!connection?.isConnected) {
        throw new Error('Viewer not connected');
      }
      connection.sendNearbyChat(message, chatType, channel || 0);
      // Local echo for Electron UI
      const outMessage: ChatMessage = {
        id: `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'nearby',
        message,
        fromName: 'You',
        fromId: '',
        timestamp: Date.now(),
        chatType,
        isOutgoing: true,
      };
      mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...outMessage });
    } else if (instance?.connectionState === 'metaverse_connected') {
      const metaverse = metaverseConnectionManager.get(instanceId);
      if (!metaverse) {
        throw new Error('Metaverse connection not found');
      }
      await metaverse.sendNearbyChat(message, chatType, channel || 0);
    } else {
      throw new Error(`Cannot send chat: connection state is ${instance?.connectionState || 'unknown'}`);
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SEND_IM, async (_, instanceId: string, participantId: string, message: string) => {
    const instance = viewerManager.getInstance(instanceId);

    // Route based on connection state
    if (instance?.connectionState === 'viewer_connected') {
      const connection = viewerManager.getConnection(instanceId);
      if (!connection?.isConnected) {
        throw new Error('Viewer not connected');
      }
      connection.sendIM(participantId, message);
      // Local echo for Electron UI
      const outMessage: ChatMessage = {
        id: `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'im',
        message,
        fromName: 'You',
        fromId: '',
        timestamp: Date.now(),
        sessionId: participantId,
        isOutgoing: true,
      };
      mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...outMessage });
    } else if (instance?.connectionState === 'metaverse_connected') {
      const metaverse = metaverseConnectionManager.get(instanceId);
      if (!metaverse) {
        throw new Error('Metaverse connection not found');
      }
      await metaverse.sendIM(participantId, message);
    } else {
      throw new Error(`Cannot send IM: connection state is ${instance?.connectionState || 'unknown'}`);
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SEND_GROUP_IM, async (_, instanceId: string, groupId: string, message: string) => {
    const instance = viewerManager.getInstance(instanceId);

    // Route based on connection state
    if (instance?.connectionState === 'viewer_connected') {
      const connection = viewerManager.getConnection(instanceId);
      if (!connection?.isConnected) {
        throw new Error('Viewer not connected');
      }
      connection.sendGroupIM(groupId, message);
      // Local echo for Electron UI
      const outMessage: ChatMessage = {
        id: `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'group',
        message,
        fromName: 'You',
        fromId: '',
        timestamp: Date.now(),
        sessionId: groupId,
        isOutgoing: true,
      };
      mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...outMessage });
    } else if (instance?.connectionState === 'metaverse_connected') {
      const metaverse = metaverseConnectionManager.get(instanceId);
      if (!metaverse) {
        throw new Error('Metaverse connection not found');
      }
      await metaverse.sendGroupMessage(groupId, message);
    } else {
      throw new Error(`Cannot send group message: connection state is ${instance?.connectionState || 'unknown'}`);
    }
    return true;
  });

  // Friends handlers
  ipcMain.handle(IPC_CHANNELS.GET_FRIENDS, async (_, instanceId: string) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) {
      return [];
    }
    try {
      return metaverse.getFriends();
    } catch {
      return [];
    }
  });

  // Groups handlers
  ipcMain.handle(IPC_CHANNELS.GET_GROUPS, async (_, instanceId: string) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) {
      return [];
    }
    try {
      return metaverse.getGroups();
    } catch {
      return [];
    }
  });

  // Nearby avatars handlers
  ipcMain.handle(IPC_CHANNELS.GET_NEARBY_AVATARS, async (_, instanceId: string) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) {
      return [];
    }
    try {
      return metaverse.getNearbyAvatars();
    } catch {
      return [];
    }
  });

  // Region info handler
  ipcMain.handle(IPC_CHANNELS.GET_REGION_INFO, async (_, instanceId: string) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) {
      return null;
    }
    try {
      return metaverse.getRegionInfo();
    } catch {
      // Bot may be disconnected (viewer took over)
      return null;
    }
  });

  // Chat sessions handlers
  ipcMain.handle(IPC_CHANNELS.GET_CHAT_SESSIONS, async (_, instanceId: string) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) {
      return [];
    }
    try {
      return metaverse.getChatSessions();
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.START_IM_SESSION, async (_, instanceId: string, participantId: string, participantName: string) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) {
      throw new Error('Metaverse connection not found');
    }
    return metaverse.startIMSession(participantId, participantName);
  });

  ipcMain.handle(IPC_CHANNELS.START_GROUP_CHAT, async (_, instanceId: string, groupId: string) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) {
      throw new Error('Metaverse connection not found');
    }
    return metaverse.startGroupChatSession(groupId);
  });

  ipcMain.handle(IPC_CHANNELS.MARK_SESSION_READ, async (_, instanceId: string, sessionId: string) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (metaverse) {
      metaverse.markSessionRead(sessionId);
    }
  });

  // Forward WebSocket events to renderer
  connectionManager.on('viewer-connected', (instanceId: string, apis: any[]) => {
    mainWindow.webContents.send(IPC_CHANNELS.VIEWER_WS_CONNECTED, { instanceId, apis });
  });

  connectionManager.on('viewer-message', (instanceId: string, pump: string, data: any) => {
    console.log(`[IPC] viewer-message from ${instanceId}, pump: ${pump}, type: ${data.type}`);
    // Forward chat messages to renderer
    if (data.type === 'nearby' || data.type === 'im') {
      // Transform snake_case from viewer to camelCase for renderer
      // For IMs, use from_id as sessionId to match node-metaverse behavior
      const sessionId = data.type === 'im' ? data.from_id : data.session_id;
      const message: ChatMessage = {
        id: `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: data.type,
        message: data.message,
        fromName: data.from_name,
        fromId: data.from_id,
        timestamp: Date.now(),
        chatType: data.chat_type === 0 ? 'whisper' : data.chat_type === 2 ? 'shout' : 'normal',
        sourceType: data.source_type === 0 ? 'system' : data.source_type === 1 ? 'agent' : 'object',
        sessionId,
        isOutgoing: false,
      };
      console.log(`[IPC] Forwarding chat message to renderer:`, message);
      mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...message });
    }
  });

  // Forward MetaverseConnection events to renderer
  metaverseConnectionManager.on('state-change', (instanceId: string, state: string) => {
    mainWindow.webContents.send(IPC_CHANNELS.CONNECTION_STATE_UPDATE, { instanceId, state });
  });

  metaverseConnectionManager.on('nearby-chat', (instanceId: string, message: ChatMessage) => {
    mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...message });
  });

  metaverseConnectionManager.on('im', (instanceId: string, message: ChatMessage) => {
    mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...message });
  });

  metaverseConnectionManager.on('group-chat', (instanceId: string, message: ChatMessage) => {
    mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...message });
  });

  metaverseConnectionManager.on('friends-update', (instanceId: string, friends: any[]) => {
    mainWindow.webContents.send(IPC_CHANNELS.FRIENDS_UPDATE, { instanceId, friends });
  });

  metaverseConnectionManager.on('friend-online', (instanceId: string, friend: any, online: boolean) => {
    mainWindow.webContents.send(IPC_CHANNELS.FRIEND_ONLINE, { instanceId, friend, online });
  });

  metaverseConnectionManager.on('groups-update', (instanceId: string, groups: any[]) => {
    mainWindow.webContents.send(IPC_CHANNELS.GROUPS_UPDATE, { instanceId, groups });
  });

  metaverseConnectionManager.on('nearby-avatars-update', (instanceId: string, avatars: any[]) => {
    mainWindow.webContents.send(IPC_CHANNELS.NEARBY_AVATARS_UPDATE, { instanceId, avatars });
  });

  metaverseConnectionManager.on('chat-session-update', (instanceId: string, session: any) => {
    mainWindow.webContents.send(IPC_CHANNELS.CHAT_SESSION_UPDATE, { instanceId, session });
  });
}
