import { useState, useEffect, useCallback } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS, SyncStatus } from '../../shared/types';

interface UseInventorySyncOptions {
  instanceId: string | null;
}

export function useInventorySync({ instanceId }: UseInventorySyncOptions) {
  const [status, setStatus] = useState<SyncStatus>({
    phase: 'idle',
    current: 0,
    total: 0,
    uploadCost: -1,
  });

  // Listen for progress updates from main process
  useEffect(() => {
    if (!instanceId) return;

    const handleProgress = (_: any, data: SyncStatus & { instanceId: string }) => {
      if (data.instanceId !== instanceId) return;
      setStatus({
        phase: data.phase,
        current: data.current,
        total: data.total,
        currentFile: data.currentFile,
        error: data.error,
        uploadCost: data.uploadCost,
      });
    };

    // Get initial status
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_STATUS, instanceId).then(setStatus).catch(() => {});

    ipcRenderer.on(IPC_CHANNELS.SYNC_PROGRESS, handleProgress);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SYNC_PROGRESS, handleProgress);
    };
  }, [instanceId]);

  const startSync = useCallback(async () => {
    if (!instanceId) return;
    await ipcRenderer.invoke(IPC_CHANNELS.SYNC_START, instanceId);
  }, [instanceId]);

  const openFolder = useCallback(async () => {
    if (!instanceId) return;
    await ipcRenderer.invoke(IPC_CHANNELS.SYNC_OPEN_FOLDER, instanceId);
  }, [instanceId]);

  return {
    status,
    startSync,
    openFolder,
  };
}
