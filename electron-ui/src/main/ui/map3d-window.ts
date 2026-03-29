import { BrowserWindow } from 'electron';

let map3dWindow: BrowserWindow | null = null;

export function get3DMapWindow(): BrowserWindow | null {
  return map3dWindow;
}

export function set3DMapWindow(win: BrowserWindow | null): void {
  map3dWindow = win;
}
