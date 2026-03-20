import { BrowserWindow } from 'electron';

let mapWindow: BrowserWindow | null = null;

export function getMapWindow(): BrowserWindow | null {
  return mapWindow;
}

export function setMapWindow(win: BrowserWindow | null): void {
  mapWindow = win;
}
