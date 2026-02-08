import { ipcMain, BrowserWindow, Menu, shell } from 'electron';
import { IPC_CHANNELS, AddAccountRequest, LaunchViewerRequest, ChatMessage, SyncStatus } from '../shared/types';
import { gridManager } from './grid-manager';
import { accountManager } from './account-manager';
import { viewerManager } from './viewer-manager';
import { connectionManager } from './viewer-connection';
import { metaverseConnectionManager } from './metaverse-connection';
import { chatLogManager } from './chat-log-manager';
import { InventorySyncManager } from './inventory-sync-manager';
import { ViewerInventoryAdapter } from './viewer-inventory-adapter';

// Track sync managers per instance
const syncManagers = new Map<string, InventorySyncManager>();

function getOrCreateSyncManager(instanceId: string, mainWindow: BrowserWindow): InventorySyncManager | null {
  if (syncManagers.has(instanceId)) return syncManagers.get(instanceId)!;

  const instance = viewerManager.getInstance(instanceId);
  if (!instance) return null;

  const onProgress = (progress: SyncStatus) => {
    mainWindow.webContents.send(IPC_CHANNELS.SYNC_PROGRESS, { instanceId, ...progress });
  };

  // Try viewer connection first (takes priority when viewer is running)
  if (instance.connectionState === 'viewer_connected') {
    const connection = viewerManager.getConnection(instanceId);
    if (connection?.isConnected) {
      const adapter = new ViewerInventoryAdapter(connection);
      const manager = new InventorySyncManager(adapter, instance.accountId, onProgress);
      syncManagers.set(instanceId, manager);
      return manager;
    }
  }

  // Fall back to bot (node-metaverse)
  const metaverse = metaverseConnectionManager.get(instanceId);
  const bot = metaverse?.getBot();
  if (!bot) return null;

  const manager = new InventorySyncManager(bot, instance.accountId, onProgress);
  syncManagers.set(instanceId, manager);
  return manager;
}

function saveChatMessage(instanceId: string, message: ChatMessage): void {
  const instance = viewerManager.getInstance(instanceId);
  if (!instance) return;
  const accountId = instance.accountId;
  const sessionId = message.type === 'nearby' ? 'nearby' : (message.sessionId || message.fromId);
  if (!sessionId) return;
  chatLogManager.appendMessage(accountId, sessionId, message);
}

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
      saveChatMessage(instanceId, outMessage);
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
      saveChatMessage(instanceId, outMessage);
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
      saveChatMessage(instanceId, outMessage);
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

  // Chat log persistence handlers
  ipcMain.handle(IPC_CHANNELS.LOAD_CHAT_LOG, async (_, instanceId: string, sessionId: string) => {
    const instance = viewerManager.getInstance(instanceId);
    if (!instance) return [];
    return chatLogManager.loadMessages(instance.accountId, sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.LOAD_ALL_CHAT_LOGS, async (_, instanceId: string) => {
    const instance = viewerManager.getInstance(instanceId);
    if (!instance) return [];
    return chatLogManager.loadAllSessions(instance.accountId);
  });

  ipcMain.handle(IPC_CHANNELS.LOAD_SESSION_META, async (_, instanceId: string) => {
    const instance = viewerManager.getInstance(instanceId);
    if (!instance) return [];
    return chatLogManager.loadAllSessionMeta(instance.accountId);
  });

  // Session dismiss persistence
  ipcMain.handle(IPC_CHANNELS.DISMISS_SESSION, async (_, instanceId: string, sessionId: string) => {
    const instance = viewerManager.getInstance(instanceId);
    if (!instance) return;
    chatLogManager.dismissSession(instance.accountId, sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.GET_DISMISSED_SESSIONS, async (_, instanceId: string) => {
    const instance = viewerManager.getInstance(instanceId);
    if (!instance) return [];
    return chatLogManager.loadDismissedSessions(instance.accountId);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_CHAT_LOG, async (_, instanceId: string, sessionId: string) => {
    const instance = viewerManager.getInstance(instanceId);
    if (!instance) return;
    chatLogManager.deleteLog(instance.accountId, sessionId);
  });

  // Inventory sync handlers
  ipcMain.handle(IPC_CHANNELS.SYNC_START, async (_, instanceId: string) => {
    const manager = getOrCreateSyncManager(instanceId, mainWindow);
    if (!manager) throw new Error('Cannot sync: not connected');
    // Run sync in background (don't await — progress updates via SYNC_PROGRESS events)
    manager.sync().catch(err => console.error('[IPC] Sync error:', err));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_GET_STATUS, async (_, instanceId: string) => {
    const manager = syncManagers.get(instanceId);
    if (!manager) {
      return { phase: 'idle', current: 0, total: 0, uploadCost: -1 } as SyncStatus;
    }
    return manager.getProgress();
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_OPEN_FOLDER, async (_, instanceId: string) => {
    const manager = syncManagers.get(instanceId);
    if (manager) {
      shell.openPath(manager.getLocalDir());
    }
  });

  // Auto-start sync when metaverse connects
  metaverseConnectionManager.on('state-change', (instanceId: string, state: string) => {
    if (state === 'metaverse_connected') {
      // Small delay to let everything settle
      setTimeout(() => {
        const manager = getOrCreateSyncManager(instanceId, mainWindow);
        if (manager) {
          console.log(`[IPC] Auto-starting inventory sync for ${instanceId}`);
          manager.sync().catch(err => console.error('[IPC] Auto-sync error:', err));
        }
      }, 2000);
    } else if (state === 'disconnected' || state === 'logging_in' || state === 'viewer_connected') {
      // Clear stale sync manager so a fresh one is created with the appropriate backend
      syncManagers.delete(instanceId);
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
      // Skip system messages with no sender (e.g. "is online." / "is offline." friend notifications)
      if (data.source_type === 0 && !data.from_name) {
        return;
      }

      // Skip Firestorm LSL Bridge messages
      if (data.from_name && data.from_name.startsWith('#Firestorm LSL Bridge')) {
        return;
      }

      // Cache display name from viewer for cross-reference when node-metaverse reconnects
      if (data.from_id && data.from_name) {
        const metaverse = metaverseConnectionManager.get(instanceId);
        const cache = metaverse?.getDisplayNameCache();
        if (cache && !cache.get(data.from_id)) {
          cache.set(data.from_id, {
            displayName: data.from_name,
            legacyName: data.from_name, // Viewer already resolved; best we have
            username: '',
            isDefault: false,
            fetchedAt: Date.now(),
          });
        }
      }

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
      saveChatMessage(instanceId, message);
    }
  });

  // Forward MetaverseConnection events to renderer
  metaverseConnectionManager.on('state-change', (instanceId: string, state: string) => {
    mainWindow.webContents.send(IPC_CHANNELS.CONNECTION_STATE_UPDATE, { instanceId, state });
  });

  metaverseConnectionManager.on('nearby-chat', (instanceId: string, message: ChatMessage) => {
    if (message.fromName?.startsWith('#Firestorm LSL Bridge')) return;
    mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...message });
    saveChatMessage(instanceId, message);
  });

  metaverseConnectionManager.on('im', (instanceId: string, message: ChatMessage) => {
    mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...message });
    saveChatMessage(instanceId, message);
  });

  metaverseConnectionManager.on('group-chat', (instanceId: string, message: ChatMessage) => {
    mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...message });
    saveChatMessage(instanceId, message);
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
    // Persist session metadata for history reconstruction
    const instance = viewerManager.getInstance(instanceId);
    if (instance && session.name) {
      chatLogManager.saveSessionMeta(instance.accountId, session);
    }
  });

  // Context menu: right-click on user names
  ipcMain.on(IPC_CHANNELS.SHOW_USER_CONTEXT_MENU, (_event, { userId, userName, x, y }) => {
    const menu = Menu.buildFromTemplate([
      {
        label: `View Profile: ${userName}`,
        click: () => {
          shell.openExternal(`https://world.secondlife.com/resident/${userId}`);
        },
      },
    ]);
    menu.popup({ window: mainWindow, x, y });
  });

  // Context menu: right-click on group names
  ipcMain.on(IPC_CHANNELS.SHOW_GROUP_CONTEXT_MENU, (_event, { groupId, groupName, x, y }) => {
    const menu = Menu.buildFromTemplate([
      {
        label: `View Group Profile: ${groupName}`,
        click: () => {
          shell.openExternal(`https://world.secondlife.com/group/${groupId}`);
        },
      },
    ]);
    menu.popup({ window: mainWindow, x, y });
  });
}
