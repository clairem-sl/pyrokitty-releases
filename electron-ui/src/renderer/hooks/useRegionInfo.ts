import { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS, RegionInfo } from '../../shared/types';

interface UseRegionInfoOptions {
  instanceId: string | null;
}

export function useRegionInfo({ instanceId }: UseRegionInfoOptions) {
  const [regionInfo, setRegionInfo] = useState<RegionInfo | null>(null);

  // Load region info
  useEffect(() => {
    if (!instanceId) {
      setRegionInfo(null);
      return;
    }

    const load = async () => {
      try {
        const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_REGION_INFO, instanceId);
        setRegionInfo(data);
      } catch (e) {
        console.error('Failed to load region info:', e);
      }
    };
    load();

    // Poll for updates (region info can change on teleport)
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [instanceId]);

  return { regionInfo };
}
