import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, AddAccountRequest, LaunchViewerRequest } from '../shared/types';
import { gridManager } from './grid-manager';
import { accountManager } from './account-manager';
import { viewerManager } from './viewer-manager';

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
}
