import { useState, useEffect, useCallback } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS, ChatMessage, ChatSession, ChatType } from '../../shared/types';

interface UseChatOptions {
  instanceId: string | null;
}

export function useChat({ instanceId }: UseChatOptions) {
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  const [nearbyMessages, setNearbyMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Load initial chat sessions
  useEffect(() => {
    if (!instanceId) return;

    const load = async () => {
      try {
        const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_CHAT_SESSIONS, instanceId);
        setSessions(data || []);
      } catch (e) {
        console.error('Failed to load chat sessions:', e);
      }
    };
    load();
  }, [instanceId]);

  // Listen for incoming chat messages
  useEffect(() => {
    if (!instanceId) return;

    const handleChatMessage = (_: any, data: ChatMessage & { instanceId: string }) => {
      if (data.instanceId !== instanceId) return;

      const message: ChatMessage = {
        id: data.id,
        type: data.type,
        message: data.message,
        fromName: data.fromName,
        fromId: data.fromId,
        timestamp: data.timestamp,
        chatType: data.chatType,
        sourceType: data.sourceType,
        sessionId: data.sessionId,
        isOutgoing: data.isOutgoing,
      };

      if (message.type === 'nearby') {
        setNearbyMessages((prev) => [...prev, message]);
      } else {
        // IM or group message - store by session
        const sessionId = message.sessionId || message.fromId;
        setMessages((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(sessionId) || [];
          updated.set(sessionId, [...existing, message]);
          return updated;
        });
      }
    };

    ipcRenderer.on(IPC_CHANNELS.CHAT_MESSAGE, handleChatMessage);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CHAT_MESSAGE, handleChatMessage);
    };
  }, [instanceId]);

  // Listen for session updates
  useEffect(() => {
    if (!instanceId) return;

    const handleSessionUpdate = (_: any, data: { instanceId: string; session: ChatSession }) => {
      if (data.instanceId !== instanceId) return;

      setSessions((prev) => {
        const index = prev.findIndex((s) => s.id === data.session.id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = data.session;
          return updated;
        }
        return [...prev, data.session];
      });
    };

    ipcRenderer.on(IPC_CHANNELS.CHAT_SESSION_UPDATE, handleSessionUpdate);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CHAT_SESSION_UPDATE, handleSessionUpdate);
    };
  }, [instanceId]);

  // Send nearby chat
  const sendNearbyChat = useCallback(async (
    message: string,
    type: 'whisper' | 'normal' | 'shout' = 'normal',
    channel = 0
  ) => {
    if (!instanceId) return;
    await ipcRenderer.invoke(IPC_CHANNELS.SEND_NEARBY_CHAT, instanceId, message, type, channel);
  }, [instanceId]);

  // Send IM
  const sendIM = useCallback(async (participantId: string, message: string) => {
    if (!instanceId) return;
    await ipcRenderer.invoke(IPC_CHANNELS.SEND_IM, instanceId, participantId, message);
  }, [instanceId]);

  // Send group message
  const sendGroupMessage = useCallback(async (groupId: string, message: string) => {
    if (!instanceId) return;
    await ipcRenderer.invoke(IPC_CHANNELS.SEND_GROUP_IM, instanceId, groupId, message);
  }, [instanceId]);

  // Start IM session
  const startIMSession = useCallback(async (participantId: string, participantName: string) => {
    if (!instanceId) return null;
    const session = await ipcRenderer.invoke(IPC_CHANNELS.START_IM_SESSION, instanceId, participantId, participantName);
    setActiveSessionId(session.id);
    return session;
  }, [instanceId]);

  // Start group chat
  const startGroupChat = useCallback(async (groupId: string) => {
    if (!instanceId) return null;
    const session = await ipcRenderer.invoke(IPC_CHANNELS.START_GROUP_CHAT, instanceId, groupId);
    setActiveSessionId(session.id);
    return session;
  }, [instanceId]);

  // Get messages for a session
  const getSessionMessages = useCallback((sessionId: string): ChatMessage[] => {
    return messages.get(sessionId) || [];
  }, [messages]);

  // Clear nearby messages (for when user clears chat)
  const clearNearbyMessages = useCallback(() => {
    setNearbyMessages([]);
  }, []);

  return {
    // Data
    nearbyMessages,
    sessions,
    activeSessionId,

    // Actions
    sendNearbyChat,
    sendIM,
    sendGroupMessage,
    startIMSession,
    startGroupChat,
    setActiveSessionId,
    getSessionMessages,
    clearNearbyMessages,
  };
}
