import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { setupIpcHandlers } from './ipc-handlers';
import { gridManager } from './grid-manager';
import { accountManager } from './account-manager';
import { viewerManager } from './viewer-manager';
import { chatLogManager } from './chat-log-manager';

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

async function performCleanup(): Promise<void> {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log('[App] Logging out from SL and cleaning up...');
  chatLogManager.flushAll();
  await viewerManager.stopAll();
  console.log('[App] Cleanup complete');
}

async function createWindow(): Promise<void> {
  const iconsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'icons')
    : path.join(__dirname, '..', '..', '..', 'indra', 'newview', 'icons', 'release');
  const iconPath = path.join(iconsDir, 'firestorm_icon.ico');

  mainWindow = new BrowserWindow({
    width: 920,
    height: 700,
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

  // Initialize managers
  await gridManager.initialize();
  accountManager.initialize();

  // Setup IPC handlers
  setupIpcHandlers(mainWindow);

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
    path.join(iconsDir, 'firestorm_16.png')
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
