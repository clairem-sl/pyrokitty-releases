import { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS, RegionInfo } from '../../shared/types';

interface UseRegionInfoOptions {
  instanceId: string | null;
}

export function useRegionInfo({ instanceId }: UseRegionInfoOptions) {
  const [regionInfo, setRegionInfo] = useState<RegionInfo | null>(null);

  // Load initial region info
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
  }, [instanceId]);

  // Listen for pushed updates (throttled ~500ms from server events)
  useEffect(() => {
    if (!instanceId) return;

    const handler = (_: any, data: { instanceId: string; regionInfo: RegionInfo }) => {
      if (data.instanceId !== instanceId) return;
      setRegionInfo(data.regionInfo);
    };

    ipcRenderer.on(IPC_CHANNELS.REGION_INFO_UPDATE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.REGION_INFO_UPDATE, handler);
    };
  }, [instanceId]);

  return { regionInfo };
}
