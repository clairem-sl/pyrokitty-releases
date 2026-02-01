import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, AddAccountRequest, LaunchViewerRequest } from '../shared/types';
import { gridManager } from './grid-manager';
import { accountManager } from './account-manager';
import { viewerManager } from './viewer-manager';
import { connectionManager } from './viewer-connection';

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
    return viewerManager.launchViewer(request.accountId, request.password);
  });

  ipcMain.handle(IPC_CHANNELS.STOP_VIEWER, async (_, instanceId: string) => {
    return viewerManager.stopViewer(instanceId);
  });

  ipcMain.handle(IPC_CHANNELS.GET_INSTANCES, async () => {
    return viewerManager.getInstances();
  });

  // Forward viewer status updates to renderer
  viewerManager.on('status-update', (instance) => {
    mainWindow.webContents.send(IPC_CHANNELS.VIEWER_STATUS_UPDATE, instance);
  });

  // Chat handlers
  ipcMain.handle(IPC_CHANNELS.SEND_NEARBY_CHAT, async (_, instanceId: string, message: string, type?: string, channel?: number) => {
    const connection = viewerManager.getConnection(instanceId);
    if (!connection?.isConnected) {
      throw new Error('Viewer not connected');
    }
    connection.sendNearbyChat(message, (type as 'whisper' | 'normal' | 'shout') || 'normal', channel || 0);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SEND_IM, async (_, instanceId: string, participantId: string, message: string) => {
    const connection = viewerManager.getConnection(instanceId);
    if (!connection?.isConnected) {
      throw new Error('Viewer not connected');
    }
    connection.sendIM(participantId, message);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SEND_GROUP_IM, async (_, instanceId: string, groupId: string, message: string) => {
    const connection = viewerManager.getConnection(instanceId);
    if (!connection?.isConnected) {
      throw new Error('Viewer not connected');
    }
    connection.sendGroupIM(groupId, message);
    return true;
  });

  // Forward WebSocket events to renderer
  connectionManager.on('viewer-connected', (instanceId: string, apis: any[]) => {
    mainWindow.webContents.send(IPC_CHANNELS.VIEWER_WS_CONNECTED, { instanceId, apis });
  });

  connectionManager.on('viewer-message', (instanceId: string, pump: string, data: any) => {
    // Forward chat messages to renderer
    if (data.type === 'nearby' || data.type === 'im') {
      mainWindow.webContents.send(IPC_CHANNELS.CHAT_MESSAGE, { instanceId, ...data });
    }
  });
}
