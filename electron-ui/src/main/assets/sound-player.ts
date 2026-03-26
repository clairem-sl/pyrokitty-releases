/**
 * sound-player.ts — Hidden BrowserWindow for OGG Vorbis audio playback.
 * Uses Chromium's native OGG support via HTMLAudioElement.
 */

import { BrowserWindow, ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let soundWindow: BrowserWindow | null = null;
let ready = false;
let readyResolve: (() => void) | null = null;
let masterVolume = 0.5;
let onSoundEnded: ((id: number) => void) | null = null;
let handlersRegistered = false;
let endedListener: ((_: unknown, id: number) => void) | null = null;

export function setOnSoundEnded(cb: ((id: number) => void) | null): void {
  onSoundEnded = cb;
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'data', 'sound-settings.json');
}

async function loadVolume(): Promise<void> {
  try {
    const data = JSON.parse(await fs.promises.readFile(settingsPath(), 'utf-8'));
    if (typeof data.masterVolume === 'number') {
      masterVolume = Math.max(0, Math.min(1, data.masterVolume));
    }
  } catch {
    // No saved settings yet, keep default
  }
}

async function saveVolume(): Promise<void> {
  try {
    const dir = path.dirname(settingsPath());
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(settingsPath(), JSON.stringify({ masterVolume }));
  } catch (e) {
    console.warn('[SoundPlayer] Failed to save volume:', e);
  }
}

function registerHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // Load saved volume so get-volume works before sound window init
  loadVolume().catch(() => {});

  ipcMain.handle('sound:set-master-volume', async (_, volume: number) => {
    masterVolume = Math.max(0, Math.min(1, volume));
    send('sound:set-master-volume', { volume: masterVolume });
    await saveVolume();
  });

  ipcMain.handle('sound:get-master-volume', () => {
    return masterVolume;
  });
}

// Register handlers on import so renderer can query volume before sound window exists
registerHandlers();

export async function initSoundPlayer(): Promise<void> {
  if (soundWindow) return;

  // Ensure volume is loaded (in case module was imported but volume file was created later)
  await loadVolume();

  const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  soundWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const htmlPath = path.join(__dirname, '../sound-player/index.html');
  soundWindow.loadFile(htmlPath);

  soundWindow.on('closed', () => {
    soundWindow = null;
    ready = false;
  });

  // Clean up previous ended listener if any
  if (endedListener) {
    ipcMain.removeListener('sound:ended', endedListener);
  }
  endedListener = (_: unknown, id: number) => { onSoundEnded?.(id); };
  ipcMain.on('sound:ended', endedListener);

  ipcMain.once('sound:ready', () => {
    ready = true;
    readyResolve?.();
  });

  await readyPromise;

  // Sync saved master volume to the hidden window
  send('sound:set-master-volume', { volume: masterVolume });
  console.log(`[SoundPlayer] Hidden audio window ready (volume: ${Math.round(masterVolume * 100)}%)`);
}

function send(channel: string, data: object): void {
  if (!ready || !soundWindow || soundWindow.isDestroyed()) return;
  soundWindow.webContents.send(channel, data);
}

export function playOneshot(filePath: string, gain: number): void {
  if (masterVolume === 0) return;
  send('sound:play-oneshot', { path: filePath.replace(/\\/g, '/'), gain: gain * masterVolume });
}

export function playAttached(localId: number, filePath: string, gain: number, loop: boolean): void {
  if (masterVolume === 0) return;
  send('sound:play-attached', { id: localId, path: filePath.replace(/\\/g, '/'), gain: gain * masterVolume, loop });
}

export function stopAttached(localId: number): void {
  send('sound:stop-attached', { id: localId });
}

export function setAttachedGain(localId: number, gain: number): void {
  send('sound:set-gain', { id: localId, gain });
}

export function destroySoundPlayer(): void {
  if (soundWindow && !soundWindow.isDestroyed()) {
    soundWindow.close();
  }
  soundWindow = null;
  ready = false;
}
