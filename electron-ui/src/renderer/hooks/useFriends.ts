import { useState, useEffect, useCallback, useMemo } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS, Friend } from '../../shared/types';

interface UseFriendsOptions {
  instanceId: string | null;
}

export function useFriends({ instanceId }: UseFriendsOptions) {
  const [friends, setFriends] = useState<Friend[]>([]);

  // Load initial friends list
  useEffect(() => {
    if (!instanceId) {
      setFriends([]);
      return;
    }

    const load = async () => {
      try {
        const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_FRIENDS, instanceId);
        setFriends(data || []);
      } catch (e) {
        console.error('Failed to load friends:', e);
      }
    };
    load();
  }, [instanceId]);

  // Listen for friends updates
  useEffect(() => {
    if (!instanceId) return;

    const handleFriendsUpdate = (_: any, data: { instanceId: string; friends: Friend[] }) => {
      if (data.instanceId !== instanceId) return;
      setFriends(data.friends);
    };

    const handleFriendOnline = (_: any, data: { instanceId: string; friend: Friend; online: boolean }) => {
      if (data.instanceId !== instanceId) return;
      setFriends((prev) => {
        const index = prev.findIndex((f) => f.id === data.friend.id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = { ...updated[index], online: data.online };
          return updated;
        }
        return prev;
      });
    };

    ipcRenderer.on(IPC_CHANNELS.FRIENDS_UPDATE, handleFriendsUpdate);
    ipcRenderer.on(IPC_CHANNELS.FRIEND_ONLINE, handleFriendOnline);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FRIENDS_UPDATE, handleFriendsUpdate);
      ipcRenderer.removeListener(IPC_CHANNELS.FRIEND_ONLINE, handleFriendOnline);
    };
  }, [instanceId]);

  // Derived data
  const onlineFriends = useMemo(() => {
    return friends.filter((f) => f.online).sort((a, b) => a.name.localeCompare(b.name));
  }, [friends]);

  const offlineFriends = useMemo(() => {
    return friends.filter((f) => !f.online).sort((a, b) => a.name.localeCompare(b.name));
  }, [friends]);

  // Get friend by ID
  const getFriend = useCallback((friendId: string): Friend | undefined => {
    return friends.find((f) => f.id === friendId);
  }, [friends]);

  return {
    friends,
    onlineFriends,
    offlineFriends,
    getFriend,
  };
}
