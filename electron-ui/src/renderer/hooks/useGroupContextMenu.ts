import { useCallback } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';

export function useGroupContextMenu() {
  return useCallback((e: React.MouseEvent, groupId: string, groupName: string) => {
    if (!groupId) return;
    e.preventDefault();
    ipcRenderer.send(IPC_CHANNELS.SHOW_GROUP_CONTEXT_MENU, {
      groupId,
      groupName,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);
}
