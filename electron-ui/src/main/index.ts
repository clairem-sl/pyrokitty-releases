import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { setupIpcHandlers } from './ipc-handlers';
import { gridManager } from './grid-manager';
import { accountManager } from './account-manager';
import { viewerManager } from './viewer-manager';
import { chatLogManager } from './chat-log-manager';
import { IPC_CHANNELS } from '../shared/types';
import { setMapWindow, getMapWindow } from './map-window';
import { InventoryFolder } from '../../node-metaverse/dist/lib/classes/InventoryFolder';
import { initGpuCompressWindow, destroyGpuCompressWindow } from './gpu-compress-window';
import { getSavedBounds, trackWindow } from './window-state-manager';

// Ensure consistent userData path in dev mode (npx electron defaults to "Electron")
app.setName('pyrokitty-ui');
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'pyrokitty-ui'));
}

function getIconPath(filename: string): string {
  const iconsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'icons')
    : path.join(__dirname, '..', '..', '..', 'icons');
  return path.join(iconsDir, filename);
}

// Set node-metaverse inventory cache to writable location (not inside app.asar)
InventoryFolder.cacheBasePath = path.join(app.getPath('userData'), 'asset-cache', 'inventory');

// ── Global file logger ─────────────────────────────────────
// Tee console.log/warn/error to a log file in userData
{
  const logPath = path.join(app.getPath('userData'), 'pyrokitty.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  logStream.write(`=== PyroKitty started ${new Date().toISOString()} ===\n`);

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  const write = (prefix: string, args: unknown[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
    logStream.write(`${prefix}${msg}\n`);
  };

  console.log = (...args: unknown[]) => { origLog(...args); write('', args); };
  console.warn = (...args: unknown[]) => { origWarn(...args); write('[WARN] ', args); };
  console.error = (...args: unknown[]) => { origError(...args); write('[ERROR] ', args); };
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let cleanupDone = false;

function createMapWindow(): void {
  const existing = getMapWindow();
  if (existing) {
    existing.focus();
    return;
  }

  const saved = getSavedBounds('map');
  const win = new BrowserWindow({
    width: saved?.width ?? 900,
    height: saved?.height ?? 700,
    ...(saved?.x != null && saved?.y != null ? { x: saved.x, y: saved.y } : {}),
    minWidth: 400,
    minHeight: 300,
    title: 'PyroKitty - World Map',
    icon: getIconPath('pyrokitty2.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#1a1a2e',
  });
  trackWindow(win, 'map');

  const htmlPath = path.join(__dirname, '../map-renderer/map.html');
  win.loadFile(htmlPath);

  win.on('closed', () => {
    setMapWindow(null);
  });

  setMapWindow(win);
}

async function performCleanup(): Promise<void> {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log('[App] Logging out from SL and cleaning up...');
  chatLogManager.flushAll();
  destroyGpuCompressWindow();
  await viewerManager.stopAll();
  console.log('[App] Cleanup complete');
}

async function createWindow(): Promise<void> {
  const iconPath = getIconPath('pyrokitty2.ico');

  const saved = getSavedBounds('main');
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 920,
    height: saved?.height ?? 700,
    ...(saved?.x != null && saved?.y != null ? { x: saved.x, y: saved.y } : {}),
    minWidth: 600,
    minHeight: 500,
    title: 'PyroKitty',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#1a1a2e',
  });
  trackWindow(mainWindow, 'main');
  if (saved?.isMaximized) mainWindow.maximize();

  // Initialize GPU compression (hidden BrowserWindow for WebGPU)
  initGpuCompressWindow().catch((err) => {
    console.warn('[App] GPU compression init failed (will use CPU fallback):', err.message);
  });

  // Initialize managers
  await gridManager.initialize();
  accountManager.initialize();

  // Setup IPC handlers
  setupIpcHandlers(mainWindow);

  // Map window IPC
  ipcMain.handle(IPC_CHANNELS.MAP_OPEN, async () => {
    createMapWindow();
  });

  // Load the renderer
  // __dirname is dist/main/, renderer is at dist/renderer/
  const htmlPath = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(htmlPath);

  // Right-click context menu with Copy/Select All
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];
    if (params.selectionText) {
      menuItems.push({ label: 'Copy', role: 'copy' });
    }
    menuItems.push({ label: 'Select All', role: 'selectAll' });
    if (params.isEditable) {
      menuItems.push({ label: 'Cut', role: 'cut' });
      menuItems.push({ label: 'Paste', role: 'paste' });
    }
    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup({ window: mainWindow! });
    }
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Auto-login for automated testing: AUTO_LOGIN=accountId or AUTO_LOGIN=1 (first account)
  const autoLogin = process.env.AUTO_LOGIN;
  if (autoLogin) {
    setTimeout(async () => {
      try {
        const accounts = accountManager.getAllAccounts();
        const account = autoLogin === '1'
          ? accounts[0]
          : accounts.find(a => a.id === autoLogin || a.firstName.toLowerCase() === autoLogin.toLowerCase());
        if (account) {
          console.log(`[AutoLogin] Launching ${account.firstName} ${account.lastName}...`);
          await viewerManager.launchViewer(account.id, account.password, { launchViewer: false });
          console.log('[AutoLogin] Login complete');
          // Auto-launch Godot viewer after a brief delay
          const instances = viewerManager.getInstances();
          if (instances.length > 0) {
            const inst = instances[0];
            setTimeout(async () => {
              try {
                console.log('[AutoLogin] Launching Godot viewer...');
                await viewerManager.launchGodotViewerForInstance(inst.id);
                console.log('[AutoLogin] Godot viewer launched');
              } catch (e: any) {
                console.error('[AutoLogin] Godot launch failed:', e.message);
              }
            }, 5000);
          }
        } else {
          console.warn(`[AutoLogin] Account not found: ${autoLogin}`);
        }
      } catch (e: any) {
        console.error('[AutoLogin] Failed:', e.message);
      }
    }, 2000);
  }

  // Hide to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create system tray icon
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('PyroKitty');

  // Menu item icons
  const showIcon = nativeImage.createFromPath(
    getIconPath('pyrokitty2_16.png')
  );

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show PyroKitty',
      icon: showIcon,
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Quit',
      click: async () => {
        isQuitting = true;
        await performCleanup();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

app.whenReady().then(createWindow);

app.on('before-quit', (event) => {
  isQuitting = true;

  if (!cleanupDone) {
    // Prevent quit until cleanup finishes
    event.preventDefault();
    performCleanup().then(() => app.quit());
    return;
  }

  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
