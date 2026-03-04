import { ipcMain, BrowserWindow, Menu, shell } from 'electron';
import { IPC_CHANNELS, AddAccountRequest, LaunchViewerRequest, ChatMessage, SyncStatus, VoiceState, MapMarker } from '../shared/types';
import { gridManager } from './grid-manager';
import { accountManager } from './account-manager';
import { viewerManager } from './viewer-manager';
import { connectionManager } from './viewer-connection';
import { metaverseConnectionManager } from './metaverse-connection';
import { Vector3 } from '../../node-metaverse/dist/lib';
import { chatLogManager } from './chat-log-manager';
import { InventorySyncManager } from './inventory-sync-manager';
import { ViewerInventoryAdapter } from './viewer-inventory-adapter';
import { voiceManager } from './voice-manager';
import { getMapWindow } from './map-window';

// Track sync managers per instance
const syncManagers = new Map<string, InventorySyncManager>();

function getOrCreateSyncManager(instanceId: string, mainWindow: BrowserWindow): InventorySyncManager | null {
  const cached = syncManagers.get(instanceId);
  if (cached?.isBackendValid()) return cached;
  if (cached) { cached.stopWatching(); syncManagers.delete(instanceId); }

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

  // Fall back to bot (node-metaverse) — only if actually connected
  const metaverse = metaverseConnectionManager.get(instanceId);
  const bot = metaverse?.getBot();
  if (!bot) return null;
  try { bot.clientCommands; } catch { return null; }

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

  ipcMain.handle(IPC_CHANNELS.LAUNCH_GODOT_VIEWER_FOR_INSTANCE, async (_, instanceId: string, vrMode = false) => {
    return viewerManager.launchGodotViewerForInstance(instanceId, vrMode);
  });

  // MFA handlers
  ipcMain.handle(IPC_CHANNELS.MFA_SUBMIT, async (_, instanceId: string, token: string) => {
    return viewerManager.submitMfaToken(instanceId, token);
  });

  ipcMain.handle(IPC_CHANNELS.GET_INSTANCES, async () => {
    return viewerManager.getInstances();
  });

  // Forward viewer status updates to renderer
  viewerManager.on('status-update', (instance) => {
    mainWindow.webContents.send(IPC_CHANNELS.VIEWER_STATUS_UPDATE, instance);
  });

  // Chat handlers - route based on connection state
  async function routeChatSend(
    instanceId: string,
    label: string,
    viewerAction: (conn: any) => void,
    metaverseAction: (meta: any) => Promise<void>,
    echoFields: Partial<ChatMessage>,
    message: string,
  ) {
    const instance = viewerManager.getInstance(instanceId);
    if (instance?.connectionState === 'viewer_connected') {
      const connection = viewerManager.getConnection(instanceId);
      if (!connection?.isConnected) throw new Error('Viewer not connected');
      viewerAction(connection);
      const outMessage: ChatMessage = {
        id: `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        message, fromName: 'You', fromId: '', timestamp: Date.now(), isOutgoing: true,
        ...echoFields,
      } as ChatMessage;
      mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...outMessage });
      saveChatMessage(instanceId, outMessage);
    } else if (instance?.connectionState === 'metaverse_connected') {
      const metaverse = metaverseConnectionManager.get(instanceId);
      if (!metaverse) throw new Error('Metaverse connection not found');
      await metaverseAction(metaverse);
    } else {
      throw new Error(`Cannot send ${label}: connection state is ${instance?.connectionState || 'unknown'}`);
    }
    return true;
  }

  ipcMain.handle(IPC_CHANNELS.SEND_NEARBY_CHAT, async (_, instanceId: string, message: string, type?: string, channel?: number) => {
    const chatType = (type as 'whisper' | 'normal' | 'shout') || 'normal';
    return routeChatSend(instanceId, 'chat',
      (conn) => conn.sendNearbyChat(message, chatType, channel || 0),
      (meta) => meta.sendNearbyChat(message, chatType, channel || 0),
      { type: 'nearby', chatType }, message,
    );
  });

  ipcMain.handle(IPC_CHANNELS.SEND_IM, async (_, instanceId: string, participantId: string, message: string) => {
    return routeChatSend(instanceId, 'IM',
      (conn) => conn.sendIM(participantId, message),
      (meta) => meta.sendIM(participantId, message),
      { type: 'im', sessionId: participantId }, message,
    );
  });

  ipcMain.handle(IPC_CHANNELS.SEND_GROUP_IM, async (_, instanceId: string, groupId: string, message: string) => {
    return routeChatSend(instanceId, 'group message',
      (conn) => conn.sendGroupIM(groupId, message),
      (meta) => meta.sendGroupMessage(groupId, message),
      { type: 'group', sessionId: groupId }, message,
    );
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

  // Teleport to local coordinates (within current region)
  ipcMain.handle(IPC_CHANNELS.TELEPORT_LOCAL, async (_, instanceId: string, x: number, y: number, z: number = 30) => {
    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) return { error: 'Not connected' };
    const bot = metaverse.getBot();
    if (!bot) return { error: 'Not connected' };
    try {
      const regionName = bot.currentRegion?.regionName;
      if (!regionName) return { error: 'No region' };
      const pos = new Vector3([x, y, z]);
      const lookAt = new Vector3([0, 1, 0]);
      await bot.clientCommands.teleport.teleportTo(regionName, pos, lookAt);
      return { ok: true };
    } catch (err: any) {
      console.error('[Teleport] Failed:', err.message);
      return { error: err.message };
    }
  });

  // Teleport to region by grid coordinates (cross-region)
  // teleportToRegionCoordinates expects global coords (grid * 256).
  // Callers pass grid coords (e.g. 1007, 1194). Detect and convert.
  ipcMain.handle(IPC_CHANNELS.TELEPORT_REGION, async (_, gridX: number, gridY: number, x: number, y: number, z: number) => {
    // Pick first connected metaverse instance
    const instances = viewerManager.getInstances();
    let bot: any = null;
    let instanceId: string | undefined;
    for (const inst of instances) {
      if (inst.connectionState !== 'metaverse_connected' && inst.connectionState !== 'viewer_connected') continue;
      const metaverse = metaverseConnectionManager.get(inst.id);
      if (!metaverse) continue;
      bot = metaverse.getBot();
      if (bot) { instanceId = inst.id; break; }
    }
    if (!bot) return { error: 'Not connected — no active metaverse instance found' };
    try {
      // Detect coordinate type: values < 256 are invalid (no SL regions at grid 0,0),
      // values 256..65535 are grid coords, values >= 65536 (256*256) are already global
      let globalX: number, globalY: number;
      if (gridX < 256 || gridY < 256) {
        return { error: `Invalid region coordinates (${gridX}, ${gridY}) — too small to be grid or global coords` };
      } else if (gridX < 65536 && gridY < 65536) {
        // Grid coords — multiply to get global
        globalX = gridX * 256;
        globalY = gridY * 256;
        console.log(`[Teleport] Grid coords (${gridX},${gridY}) → global (${globalX},${globalY}), local=(${x},${y},${z})`);
      } else {
        // Already global coords
        globalX = gridX;
        globalY = gridY;
        console.log(`[Teleport] Global coords (${globalX},${globalY}), local=(${x},${y},${z})`);
      }
      const pos = new Vector3([x, y, z]);
      const lookAt = new Vector3([0, 1, 0]);
      await bot.clientCommands.teleport.teleportToRegionCoordinates(globalX, globalY, pos, lookAt);
      return { ok: true };
    } catch (err: any) {
      const msg = err.teleportEvent?.message || err.message || 'Unknown error';
      console.error(`[Teleport] Region teleport failed: input=(${gridX},${gridY}) local=(${x},${y},${z}) error=${msg}`);
      return { error: msg };
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
    manager.sync().then(() => manager.startWatching()).catch(err => console.error('[IPC] Sync error:', err));
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
        // Check state hasn't changed (e.g. viewer launched and kicked the bot)
        const instance = viewerManager.getInstance(instanceId);
        if (!instance || instance.connectionState !== 'metaverse_connected') {
          console.log(`[IPC] Skipping auto-sync: state is now ${instance?.connectionState ?? 'gone'}`);
          return;
        }
        const manager = getOrCreateSyncManager(instanceId, mainWindow);
        if (manager) {
          console.log(`[IPC] Auto-starting inventory sync for ${instanceId}`);
          manager.sync().then(() => manager.startWatching()).catch(err => console.error('[IPC] Auto-sync error:', err));
        }
      }, 2000);
    } else if (state === 'disconnected' || state === 'logging_in' || state === 'viewer_connected') {
      // Stop watching and clear stale sync manager so a fresh one is created with the appropriate backend
      const oldManager = syncManagers.get(instanceId);
      if (oldManager) oldManager.stopWatching();
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

  metaverseConnectionManager.on('region-info-update', (instanceId: string, regionInfo: any) => {
    mainWindow.webContents.send(IPC_CHANNELS.REGION_INFO_UPDATE, { instanceId, regionInfo });
    // Also push to map window so world map account marker stays in sync
    const mw = getMapWindow();
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send(IPC_CHANNELS.REGION_INFO_UPDATE, { instanceId, regionInfo });
    }
  });

  metaverseConnectionManager.on('mfa-required', (instanceId: string) => {
    mainWindow.webContents.send(IPC_CHANNELS.MFA_REQUIRED, { instanceId });
  });

  metaverseConnectionManager.on('chat-session-update', (instanceId: string, session: any) => {
    mainWindow.webContents.send(IPC_CHANNELS.CHAT_SESSION_UPDATE, { instanceId, session });
    // Persist session metadata for history reconstruction
    const instance = viewerManager.getInstance(instanceId);
    if (instance && session.name) {
      chatLogManager.saveSessionMeta(instance.accountId, session);
    }
  });

  // ── Voice controls ──────────────────────────────────
  const voiceState: VoiceState = {
    connected: false,
    connecting: false,
    micMuted: true, // PTT mode: mic starts muted
    speakerMuted: false,
    volume: 1.0,
    micLevel: 0,
    participants: [],
  };

  let savedVolume = 1.0; // For speaker mute/unmute toggle

  function broadcastVoiceState(): void {
    mainWindow.webContents.send(IPC_CHANNELS.VOICE_STATE_UPDATE, { ...voiceState });
  }

  // Renderer -> main voice commands
  ipcMain.handle(IPC_CHANNELS.VOICE_PTT_DOWN, async () => {
    console.log('[Voice] PTT DOWN');
    if (voiceState.micMuted) {
      voiceState.micMuted = false;
      voiceManager.setMicMute(false);
      broadcastVoiceState();
    }
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_PTT_UP, async () => {
    console.log('[Voice] PTT UP');
    if (!voiceState.micMuted) {
      voiceState.micMuted = true;
      voiceManager.setMicMute(true);
      broadcastVoiceState();
    }
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_SET_VOLUME, async (_, volume: number) => {
    voiceState.volume = Math.max(0, Math.min(1, volume));
    voiceState.speakerMuted = voiceState.volume === 0;
    savedVolume = voiceState.volume > 0 ? voiceState.volume : savedVolume;
    voiceManager.setVolume(voiceState.volume);
    broadcastVoiceState();
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_TOGGLE_SPEAKER_MUTE, async () => {
    voiceState.speakerMuted = !voiceState.speakerMuted;
    if (voiceState.speakerMuted) {
      savedVolume = voiceState.volume > 0 ? voiceState.volume : savedVolume;
      voiceState.volume = 0;
    } else {
      voiceState.volume = savedVolume || 0.5;
    }
    voiceManager.setVolume(voiceState.volume);
    broadcastVoiceState();
  });

  // VoiceManager events -> renderer
  voiceManager.on('connected', () => {
    voiceState.connected = true;
    voiceState.connecting = false;
    // Enforce PTT default: mic starts muted
    voiceManager.setMicMute(true);
    voiceState.micMuted = true;
    broadcastVoiceState();
  });

  voiceManager.on('disconnected', () => {
    voiceState.connected = false;
    voiceState.connecting = false;
    voiceState.micLevel = 0;
    voiceState.participants = [];
    broadcastVoiceState();
  });

  voiceManager.on('ready', () => {
    voiceState.connecting = true;
    broadcastVoiceState();
  });

  voiceManager.on('participantJoined', (agentId: string) => {
    if (!voiceState.participants.includes(agentId)) {
      voiceState.participants.push(agentId);
      broadcastVoiceState();
    }
  });

  voiceManager.on('participantLeft', (agentId: string) => {
    voiceState.participants = voiceState.participants.filter(id => id !== agentId);
    broadcastVoiceState();
  });

  // micLevel events from sidecar (forwarded through voiceManager)
  voiceManager.on('micLevel', (level: number) => {
    voiceState.micLevel = level;
    // Don't broadcast on every micLevel - renderer polls via state update
    mainWindow.webContents.send(IPC_CHANNELS.VOICE_STATE_UPDATE, { ...voiceState });
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

  // ── World map position updates ───────────────────────────

  function pushNearbyMarkers(
    markers: MapMarker[],
    seen: Set<string>,
    avatars: { id: string; name: string; regionName: string; gridX: number; gridY: number; x: number; y: number; z: number }[],
  ) {
    for (const av of avatars) {
      if (seen.has(av.id)) continue;
      seen.add(av.id);
      markers.push({
        type: 'nearby', name: av.name, regionName: av.regionName,
        gridX: av.gridX, gridY: av.gridY, localX: av.x, localY: av.y, localZ: av.z,
      });
    }
  }

  async function gatherMapPositions(): Promise<MapMarker[]> {
    const markers: MapMarker[] = [];
    const seenAvatarIds = new Set<string>();

    for (const instance of viewerManager.getInstances()) {
      if (instance.connectionState !== 'metaverse_connected' && instance.connectionState !== 'viewer_connected') continue;

      const account = accountManager.getAccount(instance.accountId);
      const accountName = account ? `${account.firstName} ${account.lastName}` : instance.accountId;

      // Try viewer connection first (live data from the running viewer)
      if (instance.connectionState === 'viewer_connected') {
        const viewerConn = viewerManager.getConnection(instance.id);
        if (viewerConn?.isConnected) {
          try {
            const mapData = await viewerConn.getMapData();
            if (mapData.grid_x === 0 && mapData.grid_y === 0) continue;

            markers.push({
              type: 'account', name: accountName, regionName: mapData.region_name,
              gridX: mapData.grid_x, gridY: mapData.grid_y,
              localX: mapData.agent_x, localY: mapData.agent_y, localZ: mapData.agent_z,
            });

            pushNearbyMarkers(markers, seenAvatarIds, (mapData.nearby || []).map((av: any) => ({
              id: av.id, name: av.name, regionName: av.region_name || mapData.region_name,
              gridX: av.grid_x, gridY: av.grid_y, x: av.local_x, y: av.local_y, z: av.local_z,
            })));
            continue;
          } catch {
            // Viewer didn't respond, fall through to metaverse cache
          }
        }
      }

      // Fall back to metaverse (bot) data
      const metaverse = metaverseConnectionManager.get(instance.id);
      if (!metaverse) continue;
      const regionInfo = metaverse.getRegionInfo();
      if (!regionInfo || (regionInfo.x === 0 && regionInfo.y === 0)) continue;

      markers.push({
        type: 'account', name: accountName, regionName: regionInfo.name,
        gridX: regionInfo.x, gridY: regionInfo.y,
        localX: regionInfo.agentPosition?.x ?? 128, localY: regionInfo.agentPosition?.y ?? 128, localZ: regionInfo.agentPosition?.z ?? 0,
      });

      try {
        const nearby = metaverse.getNearbyAvatars();
        pushNearbyMarkers(markers, seenAvatarIds, nearby.filter((av: any) => av.position).map((av: any) => ({
          id: av.id, name: av.name, regionName: regionInfo.name,
          gridX: regionInfo.x, gridY: regionInfo.y, x: av.position.x, y: av.position.y, z: av.position.z,
        })));
      } catch { /* bot may be disconnected */ }

      // Add avatars from child agent connections (neighboring regions)
      try {
        const childAvatars = metaverse.getChildAvatars();
        pushNearbyMarkers(markers, seenAvatarIds, childAvatars.map((av: any) => ({
          id: av.id, name: av.name, regionName: av.regionName,
          gridX: av.gridX, gridY: av.gridY, x: av.position.x, y: av.position.y, z: av.position.z,
        })));
      } catch { /* child agents may not be connected */ }
    }

    return markers;
  }

  async function broadcastMapPositions(): Promise<void> {
    const mw = getMapWindow();
    if (!mw || mw.isDestroyed()) return;
    const positions = await gatherMapPositions();
    mw.webContents.send(IPC_CHANNELS.MAP_POSITION_UPDATE, positions);
  }

  // Respond to explicit position request from map window
  ipcMain.handle(IPC_CHANNELS.MAP_GET_POSITIONS, async () => {
    return await gatherMapPositions();
  });

  // Periodically send positions to map window (every 3 seconds)
  setInterval(broadcastMapPositions, 3000);
}
