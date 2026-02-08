import { useCallback } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';

const NULL_UUID = '00000000-0000-0000-0000-000000000000';

export function useUserContextMenu() {
  return useCallback((e: React.MouseEvent, userId: string, userName: string) => {
    if (!userId || userId === NULL_UUID) return;
    e.preventDefault();
    ipcRenderer.send(IPC_CHANNELS.SHOW_USER_CONTEXT_MENU, {
      userId,
      userName,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);
}
