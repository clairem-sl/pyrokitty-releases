import React, { useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { FriendsList } from './FriendsList';
import { GroupsList } from './GroupsList';
import { ChatMessage, ChatSession, Friend, Group, ConnectionState } from '../../shared/types';

type Tab = 'nearby' | 'ims' | 'friends' | 'groups';

interface ChatWindowProps {
  connectionState: ConnectionState;
  // Nearby chat
  nearbyMessages: ChatMessage[];
  onSendNearbyChat: (message: string, type?: 'whisper' | 'normal' | 'shout') => void;
  // IM/Group sessions
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  onSendIM: (participantId: string, message: string) => void;
  onSendGroupMessage: (groupId: string, message: string) => void;
  // Friends
  onlineFriends: Friend[];
  offlineFriends: Friend[];
  onStartIMWithFriend: (friend: Friend) => void;
  // Groups
  groups: Group[];
  onOpenGroupChat: (group: Group) => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  connectionState,
  nearbyMessages,
  onSendNearbyChat,
  sessions,
  activeSessionId,
  onSelectSession,
  getSessionMessages,
  onSendIM,
  onSendGroupMessage,
  onlineFriends,
  offlineFriends,
  onStartIMWithFriend,
  groups,
  onOpenGroupChat,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('nearby');

  const isConnected = connectionState === 'metaverse_connected' || connectionState === 'viewer_connected';

  if (!isConnected) {
    return (
      <div className="chat-window disconnected">
        <div className="chat-disconnected-message">
          {connectionState === 'logging_in' ? 'Logging in...' :
           connectionState === 'handoff_in_progress' ? 'Connecting to viewer...' :
           'Not connected'}
        </div>
      </div>
    );
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeSessionMessages = activeSessionId ? getSessionMessages(activeSessionId) : [];

  const handleSendSessionMessage = (message: string) => {
    if (!activeSession) return;
    if (activeSession.type === 'im' && activeSession.participantId) {
      onSendIM(activeSession.participantId, message);
    } else if (activeSession.type === 'group' && activeSession.groupId) {
      onSendGroupMessage(activeSession.groupId, message);
    }
  };

  const imSessions = sessions.filter((s) => s.type === 'im');
  const groupSessions = sessions.filter((s) => s.type === 'group');
  const totalUnread = sessions.reduce((sum, s) => sum + s.unreadCount, 0);

  return (
    <div className="chat-window">
      {/* Tab bar */}
      <div className="chat-tabs">
        <button
          className={`chat-tab ${activeTab === 'nearby' ? 'active' : ''}`}
          onClick={() => setActiveTab('nearby')}
        >
          Nearby
        </button>
        <button
          className={`chat-tab ${activeTab === 'ims' ? 'active' : ''}`}
          onClick={() => setActiveTab('ims')}
        >
          IMs
          {imSessions.some((s) => s.unreadCount > 0) && (
            <span className="chat-tab-badge">
              {imSessions.reduce((sum, s) => sum + s.unreadCount, 0)}
            </span>
          )}
        </button>
        <button
          className={`chat-tab ${activeTab === 'friends' ? 'active' : ''}`}
          onClick={() => setActiveTab('friends')}
        >
          Friends ({onlineFriends.length})
        </button>
        <button
          className={`chat-tab ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups')}
        >
          Groups ({groups.length})
        </button>
      </div>

      {/* Tab content */}
      <div className="chat-content">
        {activeTab === 'nearby' && (
          <ChatPanel
            messages={nearbyMessages}
            onSendMessage={onSendNearbyChat}
            title="Nearby Chat"
            placeholder="Say something..."
            showChatTypes={true}
          />
        )}

        {activeTab === 'ims' && (
          <div className="im-container">
            {/* Session list */}
            <div className="im-sessions">
              {imSessions.length === 0 ? (
                <div className="im-sessions-empty">
                  No IM conversations yet
                </div>
              ) : (
                imSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`im-session ${session.id === activeSessionId ? 'active' : ''}`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <span className="im-session-name">{session.name}</span>
                    {session.unreadCount > 0 && (
                      <span className="im-session-badge">{session.unreadCount}</span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Active IM chat */}
            {activeSession && activeSession.type === 'im' ? (
              <ChatPanel
                messages={activeSessionMessages}
                onSendMessage={handleSendSessionMessage}
                title={activeSession.name}
                placeholder={`Message ${activeSession.name}...`}
              />
            ) : (
              <div className="im-no-selection">
                Select a conversation or start a new IM from the Friends tab
              </div>
            )}
          </div>
        )}

        {activeTab === 'friends' && (
          <FriendsList
            onlineFriends={onlineFriends}
            offlineFriends={offlineFriends}
            onStartIM={(friend) => {
              onStartIMWithFriend(friend);
              setActiveTab('ims');
            }}
          />
        )}

        {activeTab === 'groups' && (
          <div className="groups-container">
            {/* Group sessions */}
            {groupSessions.length > 0 && (
              <div className="group-sessions">
                <h4>Active Group Chats</h4>
                {groupSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group-session ${session.id === activeSessionId ? 'active' : ''}`}
                    onClick={() => {
                      onSelectSession(session.id);
                      setActiveTab('ims'); // Switch to IMs to show the chat
                    }}
                  >
                    <span className="group-session-name">{session.name}</span>
                    {session.unreadCount > 0 && (
                      <span className="group-session-badge">{session.unreadCount}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* All groups */}
            <GroupsList
              groups={groups}
              onOpenGroupChat={(group) => {
                onOpenGroupChat(group);
                setActiveTab('ims');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
