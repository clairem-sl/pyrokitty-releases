import { useState, useEffect, useCallback } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS, Group } from '../../shared/types';

interface UseGroupsOptions {
  instanceId: string | null;
}

export function useGroups({ instanceId }: UseGroupsOptions) {
  const [groups, setGroups] = useState<Group[]>([]);

  // Load initial groups list
  useEffect(() => {
    if (!instanceId) {
      setGroups([]);
      return;
    }

    const load = async () => {
      try {
        const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_GROUPS, instanceId);
        setGroups(data || []);
      } catch (e) {
        console.error('Failed to load groups:', e);
      }
    };
    load();
  }, [instanceId]);

  // Listen for groups updates
  useEffect(() => {
    if (!instanceId) return;

    const handleGroupsUpdate = (_: any, data: { instanceId: string; groups: Group[] }) => {
      if (data.instanceId !== instanceId) return;
      setGroups(data.groups);
    };

    ipcRenderer.on(IPC_CHANNELS.GROUPS_UPDATE, handleGroupsUpdate);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.GROUPS_UPDATE, handleGroupsUpdate);
    };
  }, [instanceId]);

  // Get group by ID
  const getGroup = useCallback((groupId: string): Group | undefined => {
    return groups.find((g) => g.id === groupId);
  }, [groups]);

  return {
    groups,
    getGroup,
  };
}
