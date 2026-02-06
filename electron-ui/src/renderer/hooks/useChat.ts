import { useState, useEffect, useCallback, useRef } from 'react';
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

  // Track message IDs we've already loaded from history to avoid duplicates
  const loadedIdsRef = useRef<Set<string>>(new Set());

  // Load initial chat sessions and chat history
  useEffect(() => {
    if (!instanceId) return;

    const load = async () => {
      try {
        const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_CHAT_SESSIONS, instanceId);
        setSessions(data || []);
      } catch (e) {
        console.error('Failed to load chat sessions:', e);
      }

      // Load saved chat history
      try {
        const allLogs: { sessionId: string; messages: ChatMessage[] }[] =
          await ipcRenderer.invoke(IPC_CHANNELS.LOAD_ALL_CHAT_LOGS, instanceId);

        if (allLogs && allLogs.length > 0) {
          const ids = new Set<string>();
          const sessionMap = new Map<string, ChatMessage[]>();

          for (const { sessionId, messages: msgs } of allLogs) {
            for (const msg of msgs) {
              ids.add(msg.id);
            }
            if (sessionId === 'nearby') {
              setNearbyMessages(msgs);
            } else {
              sessionMap.set(sessionId, msgs);
            }
          }

          if (sessionMap.size > 0) {
            setMessages(sessionMap);
          }
          loadedIdsRef.current = ids;
        }
      } catch (e) {
        console.error('Failed to load chat history:', e);
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
        setNearbyMessages((prev) => {
          // Skip if already loaded from history
          if (loadedIdsRef.current.has(message.id)) return prev;
          return [...prev, message];
        });
      } else {
        // IM or group message - store by session
        const sessionId = message.sessionId || message.fromId;
        if (loadedIdsRef.current.has(message.id)) return; // Skip duplicates from history
        setMessages((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(sessionId) || [];
          updated.set(sessionId, [...existing, message]);
          return updated;
        });

        // Create session if it doesn't exist (for viewer WebSocket messages)
        // Don't update existing sessions here - CHAT_SESSION_UPDATE handles that
        setSessions((prev) => {
          const existing = prev.find((s) => s.id === sessionId);
          if (existing) {
            // Session exists - just update name if needed, don't touch unreadCount
            if (message.fromName && !existing.name) {
              return prev.map((s) =>
                s.id === sessionId ? { ...s, name: message.fromName } : s
              );
            }
            return prev;
          }
          // New session (WebSocket message with no prior CHAT_SESSION_UPDATE)
          const newSession: ChatSession = {
            id: sessionId,
            type: message.type === 'group' ? 'group' : 'im',
            name: message.fromName,
            participantId: message.fromId,
            unreadCount: 1,
            lastMessage: message.message,
            lastMessageTime: message.timestamp,
          };
          return [...prev, newSession];
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

  // Mark session as read
  const markSessionRead = useCallback(async (sessionId: string) => {
    if (!instanceId) return;
    await ipcRenderer.invoke(IPC_CHANNELS.MARK_SESSION_READ, instanceId, sessionId);
  }, [instanceId]);

  // Select session and mark as read
  const selectSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    await markSessionRead(sessionId);
  }, [markSessionRead]);

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
    selectSession,
    getSessionMessages,
    clearNearbyMessages,
  };
}
