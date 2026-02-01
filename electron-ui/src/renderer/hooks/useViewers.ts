import { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { ViewerInstance, IPC_CHANNELS } from '../../shared/types';

export function useViewers() {
  const [instances, setInstances] = useState<ViewerInstance[]>([]);

  // Load initial instances
  useEffect(() => {
    const load = async () => {
      const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_INSTANCES);
      setInstances(data);
    };
    load();
  }, []);

  // Listen for status updates
  useEffect(() => {
    const handleStatusUpdate = (_: any, instance: ViewerInstance) => {
      setInstances((prev) => {
        const index = prev.findIndex((i) => i.id === instance.id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = instance;
          return updated;
        }
        return [...prev, instance];
      });
    };

    ipcRenderer.on(IPC_CHANNELS.VIEWER_STATUS_UPDATE, handleStatusUpdate);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.VIEWER_STATUS_UPDATE, handleStatusUpdate);
    };
  }, []);

  // Refresh instances periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_INSTANCES);
      setInstances(data);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const launchViewer = async (accountId: string, password?: string): Promise<ViewerInstance> => {
    const instance = await ipcRenderer.invoke(IPC_CHANNELS.LAUNCH_VIEWER, {
      accountId,
      password,
    });
    setInstances((prev) => [...prev, instance]);
    return instance;
  };

  const stopViewer = async (instanceId: string): Promise<void> => {
    await ipcRenderer.invoke(IPC_CHANNELS.STOP_VIEWER, instanceId);
  };

  const getInstanceForAccount = (accountId: string) =>
    instances.find((i) => i.accountId === accountId);

  const isRunning = (instance: ViewerInstance | undefined) =>
    instance && ['starting', 'running', 'connected'].includes(instance.status);

  return {
    instances,
    launchViewer,
    stopViewer,
    getInstanceForAccount,
    isRunning,
  };
}
