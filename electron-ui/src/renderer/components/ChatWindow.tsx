import React, { useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { MiniMap } from './MiniMap';
import { ChatMessage, ChatSession, Friend, Group, ConnectionState, NearbyAvatar, RegionInfo } from '../../shared/types';

type Tab = 'nearby' | 'messages' | 'groups';

interface ChatWindowProps {
  connectionState: ConnectionState;
  // Nearby chat
  nearbyMessages: ChatMessage[];
  onSendNearbyChat: (message: string, type?: 'whisper' | 'normal' | 'shout') => void;
  // Nearby avatars
  nearbyAvatars: NearbyAvatar[];
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
  // Nearby avatar IM
  onStartIMWithAvatar: (avatar: NearbyAvatar) => void;
  // Groups
  groups: Group[];
  onOpenGroupChat: (group: Group) => void;
  // Region info for mini-map
  regionInfo: RegionInfo | null;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  connectionState,
  nearbyMessages,
  onSendNearbyChat,
  nearbyAvatars,
  sessions,
  activeSessionId,
  onSelectSession,
  getSessionMessages,
  onSendIM,
  onSendGroupMessage,
  onlineFriends,
  offlineFriends,
  onStartIMWithFriend,
  onStartIMWithAvatar,
  groups,
  onOpenGroupChat,
  regionInfo,
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

  const imSessions = sessions.filter((s) => s.type === 'im');
  const groupSessions = sessions.filter((s) => s.type === 'group');

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

  // Get IM session for a friend
  const getIMSessionForFriend = (friendId: string): ChatSession | undefined => {
    return imSessions.find((s) => s.participantId === friendId);
  };

  // Get group session
  const getGroupSession = (groupId: string): ChatSession | undefined => {
    return groupSessions.find((s) => s.groupId === groupId);
  };

  // Count unread for tabs
  const imUnread = imSessions.reduce((sum, s) => sum + s.unreadCount, 0);
  const groupUnread = groupSessions.reduce((sum, s) => sum + s.unreadCount, 0);

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
          className={`chat-tab ${activeTab === 'messages' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('messages');
            // Mark active session as read when switching to Messages tab
            if (activeSessionId && activeSession?.type === 'im') {
              onSelectSession(activeSessionId);
            }
          }}
        >
          Messages
          {imUnread > 0 && <span className="chat-tab-badge">{imUnread}</span>}
        </button>
        <button
          className={`chat-tab ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('groups');
            // Mark active session as read when switching to Groups tab
            if (activeSessionId && activeSession?.type === 'group') {
              onSelectSession(activeSessionId);
            }
          }}
        >
          Groups ({groups.length})
          {groupUnread > 0 && <span className="chat-tab-badge">{groupUnread}</span>}
        </button>
      </div>

      {/* Tab content */}
      <div className="chat-content">
        {activeTab === 'nearby' && (
          <div className="split-panel">
            {/* Nearby avatars sidebar */}
            <div className="split-sidebar">
              <div className="split-sidebar-section">
                <div className="split-sidebar-header">Nearby ({nearbyAvatars.length})</div>
                {nearbyAvatars.length === 0 ? (
                  <div className="split-sidebar-empty">No avatars nearby</div>
                ) : (
                  nearbyAvatars.map((avatar) => (
                    <div
                      key={avatar.id}
                      className="split-sidebar-item"
                      title={avatar.title || undefined}
                    >
                      <span className="avatar-status-dot" />
                      <span className="split-sidebar-name">{avatar.name}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="split-sidebar-map">
                <MiniMap
                  regionInfo={regionInfo}
                  nearbyAvatars={nearbyAvatars}
                  onAvatarClick={(avatar) => {
                    onStartIMWithAvatar(avatar);
                    setActiveTab('messages');
                  }}
                />
              </div>
            </div>

            {/* Chat area */}
            <div className="split-main">
              <ChatPanel
                messages={nearbyMessages}
                onSendMessage={onSendNearbyChat}
                title="Nearby Chat"
                placeholder="Say something..."
                showChatTypes={true}
              />
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="split-panel">
            {/* Friends sidebar */}
            <div className="split-sidebar">
              <div className="split-sidebar-section">
                <div className="split-sidebar-header">Online ({onlineFriends.length})</div>
                {onlineFriends.length === 0 ? (
                  <div className="split-sidebar-empty">No friends online</div>
                ) : (
                  onlineFriends.map((friend) => {
                    const session = getIMSessionForFriend(friend.id);
                    const isActive = session?.id === activeSessionId;
                    return (
                      <div
                        key={friend.id}
                        className={`split-sidebar-item ${isActive ? 'active' : ''} ${session ? 'has-session' : ''}`}
                        onClick={() => {
                          if (session) {
                            onSelectSession(session.id);
                          } else {
                            onStartIMWithFriend(friend);
                          }
                        }}
                      >
                        <span className="friend-status-dot online" />
                        <span className="split-sidebar-name">{friend.name || friend.id}</span>
                        {session && session.unreadCount > 0 && (
                          <span className="split-sidebar-badge">{session.unreadCount}</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="split-sidebar-section">
                <div className="split-sidebar-header">Offline ({offlineFriends.length})</div>
                {offlineFriends.map((friend) => {
                  const session = getIMSessionForFriend(friend.id);
                  const isActive = session?.id === activeSessionId;
                  return (
                    <div
                      key={friend.id}
                      className={`split-sidebar-item ${isActive ? 'active' : ''} ${session ? 'has-session' : ''}`}
                      onClick={() => {
                        if (session) {
                          onSelectSession(session.id);
                        } else {
                          onStartIMWithFriend(friend);
                        }
                      }}
                    >
                      <span className="friend-status-dot offline" />
                      <span className="split-sidebar-name">{friend.name || friend.id}</span>
                      {session && session.unreadCount > 0 && (
                        <span className="split-sidebar-badge">{session.unreadCount}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chat area */}
            <div className="split-main">
              {activeSession && activeSession.type === 'im' ? (
                <ChatPanel
                  messages={activeSessionMessages}
                  onSendMessage={handleSendSessionMessage}
                  title={activeSession.name}
                  placeholder={`Message ${activeSession.name}...`}
                />
              ) : (
                <div className="split-main-empty">
                  Select a friend to start chatting
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'groups' && (
          <div className="split-panel">
            {/* Groups sidebar */}
            <div className="split-sidebar">
              <div className="split-sidebar-section">
                <div className="split-sidebar-header">My Groups</div>
                {groups.length === 0 ? (
                  <div className="split-sidebar-empty">No groups</div>
                ) : (
                  groups.map((group) => {
                    const session = getGroupSession(group.id);
                    const isActive = session?.id === activeSessionId;
                    return (
                      <div
                        key={group.id}
                        className={`split-sidebar-item ${isActive ? 'active' : ''} ${session ? 'has-session' : ''}`}
                        onClick={() => {
                          if (session) {
                            onSelectSession(session.id);
                          } else {
                            onOpenGroupChat(group);
                          }
                        }}
                      >
                        <span className="split-sidebar-name">{group.name}</span>
                        {session && session.unreadCount > 0 && (
                          <span className="split-sidebar-badge">{session.unreadCount}</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Chat area */}
            <div className="split-main">
              {activeSession && activeSession.type === 'group' ? (
                <ChatPanel
                  messages={activeSessionMessages}
                  onSendMessage={handleSendSessionMessage}
                  title={activeSession.name}
                  placeholder={`Message ${activeSession.name}...`}
                />
              ) : (
                <div className="split-main-empty">
                  Select a group to start chatting
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
