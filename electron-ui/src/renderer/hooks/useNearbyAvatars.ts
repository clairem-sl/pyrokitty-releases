import { useState, useEffect, useMemo } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS, NearbyAvatar } from '../../shared/types';

interface UseNearbyAvatarsOptions {
  instanceId: string | null;
}

export function useNearbyAvatars({ instanceId }: UseNearbyAvatarsOptions) {
  const [nearbyAvatars, setNearbyAvatars] = useState<NearbyAvatar[]>([]);

  // Load initial nearby avatars list
  useEffect(() => {
    if (!instanceId) {
      setNearbyAvatars([]);
      return;
    }

    const load = async () => {
      try {
        const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_NEARBY_AVATARS, instanceId);
        setNearbyAvatars(data || []);
      } catch (e) {
        console.error('Failed to load nearby avatars:', e);
      }
    };
    load();
  }, [instanceId]);

  // Listen for nearby avatars updates
  useEffect(() => {
    if (!instanceId) return;

    const handleNearbyAvatarsUpdate = (_: any, data: { instanceId: string; avatars: NearbyAvatar[] }) => {
      if (data.instanceId !== instanceId) return;
      setNearbyAvatars(data.avatars);
    };

    ipcRenderer.on(IPC_CHANNELS.NEARBY_AVATARS_UPDATE, handleNearbyAvatarsUpdate);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.NEARBY_AVATARS_UPDATE, handleNearbyAvatarsUpdate);
    };
  }, [instanceId]);

  // Sort avatars by name
  const sortedAvatars = useMemo(() => {
    return [...nearbyAvatars].sort((a, b) => a.name.localeCompare(b.name));
  }, [nearbyAvatars]);

  return {
    nearbyAvatars: sortedAvatars,
    count: nearbyAvatars.length,
  };
}
