import React, { useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { MiniMap } from './MiniMap';
import { ChatMessage, ChatSession, Friend, Group, ConnectionState, NearbyAvatar, RegionInfo, SyncStatus, displayName } from '../../shared/types';
import { useUserContextMenu } from '../hooks/useUserContextMenu';
import { useGroupContextMenu } from '../hooks/useGroupContextMenu';

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
  // Session management
  onDismissSession: (sessionId: string) => void;
  onClearSessionHistory: (sessionId: string) => void;
  // Groups
  groups: Group[];
  onOpenGroupChat: (group: Group) => void;
  // Region info for mini-map
  regionInfo: RegionInfo | null;
  // Inventory sync
  syncStatus: SyncStatus;
  onSyncNow: () => void;
  onOpenSyncFolder: () => void;
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
  onDismissSession,
  onClearSessionHistory,
  groups,
  onOpenGroupChat,
  regionInfo,
  syncStatus,
  onSyncNow,
  onOpenSyncFolder,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('nearby');

  const handleUserContextMenu = useUserContextMenu();
  const handleGroupContextMenu = useGroupContextMenu();
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

  // Resolve session display name: prefer friend name by UUID, then session name
  const allFriends = [...onlineFriends, ...offlineFriends];
  const friendById = new Map(allFriends.map((f) => [f.id, f]));
  const sessionDisplayName = (s: ChatSession): string => {
    const friend = s.participantId ? friendById.get(s.participantId) : undefined;
    return displayName(friend?.name || s.name);
  };

  // IM sessions with non-friends (recent chats from nearby avatars, etc.)
  const friendIds = new Set(allFriends.map((f) => f.id));
  const nonFriendSessions = imSessions
    .filter((s) => s.participantId && !friendIds.has(s.participantId))
    .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));

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

      {/* Inventory sync bar */}
      <div className="sync-bar">
        <span className="sync-status">
          {syncStatus.phase === 'idle' && 'Sync: idle'}
          {syncStatus.phase === 'preparing' && 'Sync: preparing...'}
          {syncStatus.phase === 'downloading' && `Downloading ${syncStatus.current}/${syncStatus.total}`}
          {syncStatus.phase === 'uploading' && `Uploading ${syncStatus.current}/${syncStatus.total}`}
          {syncStatus.phase === 'done' && 'Sync: complete'}
          {syncStatus.phase === 'error' && `Sync error: ${syncStatus.error}`}
        </span>
        {syncStatus.uploadCost === 0 && <span className="sync-uploads-free">uploads free</span>}
        {syncStatus.uploadCost > 0 && <span className="sync-uploads-paid">uploads L${syncStatus.uploadCost}</span>}
        <button
          className="sync-btn"
          onClick={onSyncNow}
          disabled={syncStatus.phase === 'downloading' || syncStatus.phase === 'uploading' || syncStatus.phase === 'preparing'}
        >
          Sync Now
        </button>
        <button className="sync-btn" onClick={onOpenSyncFolder}>
          Open Folder
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
                      onClick={() => {
                        onStartIMWithAvatar(avatar);
                        setActiveTab('messages');
                      }}
                    >
                      <span className="avatar-status-dot" />
                      <span className="split-sidebar-name" onContextMenu={(e) => handleUserContextMenu(e, avatar.id, avatar.name)}>{displayName(avatar.name)}</span>
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
                onClear={() => onClearSessionHistory('nearby')}
              />
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="split-panel">
            {/* Friends sidebar */}
            <div className="split-sidebar">
              <div className="split-sidebar-section">
                <div className="split-sidebar-header">Friends Online ({onlineFriends.length})</div>
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
                        <span className="split-sidebar-name" onContextMenu={(e) => handleUserContextMenu(e, friend.id, friend.name)}>{displayName(friend.name) || friend.id}</span>
                        {session && session.unreadCount > 0 && (
                          <span className="split-sidebar-badge">{session.unreadCount}</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="split-sidebar-section">
                <div className="split-sidebar-header">Friends Offline ({offlineFriends.length})</div>
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
                      <span className="split-sidebar-name" onContextMenu={(e) => handleUserContextMenu(e, friend.id, friend.name)}>{displayName(friend.name) || friend.id}</span>
                      {session && session.unreadCount > 0 && (
                        <span className="split-sidebar-badge">{session.unreadCount}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {nonFriendSessions.length > 0 && (
                <div className="split-sidebar-section">
                  <div className="split-sidebar-header">Recent ({nonFriendSessions.length})</div>
                  {nonFriendSessions.map((s) => {
                    const isActive = s.id === activeSessionId;
                    return (
                      <div
                        key={s.id}
                        className={`split-sidebar-item ${isActive ? 'active' : ''} has-session`}
                        onClick={() => onSelectSession(s.id)}
                      >
                        <span className="avatar-status-dot" />
                        <span className="split-sidebar-name" onContextMenu={(e) => s.participantId && handleUserContextMenu(e, s.participantId, s.name)}>{sessionDisplayName(s)}</span>
                        {s.unreadCount > 0 && (
                          <span className="split-sidebar-badge">{s.unreadCount}</span>
                        )}
                        <span
                          className="split-sidebar-dismiss"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismissSession(s.id);
                          }}
                        >
                          &times;
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chat area */}
            <div className="split-main" onClick={() => activeSessionId && onSelectSession(activeSessionId)}>
              {activeSession && activeSession.type === 'im' ? (
                <ChatPanel
                  messages={activeSessionMessages}
                  onSendMessage={handleSendSessionMessage}
                  title={sessionDisplayName(activeSession)}
                  placeholder={`Message ${sessionDisplayName(activeSession)}...`}
                  onClear={() => onClearSessionHistory(activeSession.id)}
                />
              ) : (
                <div className="split-main-empty">
                  Select a conversation to start chatting
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
                        <span className="split-sidebar-name" onContextMenu={(e) => handleGroupContextMenu(e, group.id, group.name)}>{group.name}</span>
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
            <div className="split-main" onClick={() => activeSessionId && onSelectSession(activeSessionId)}>
              {activeSession && activeSession.type === 'group' ? (
                <ChatPanel
                  messages={activeSessionMessages}
                  onSendMessage={handleSendSessionMessage}
                  title={sessionDisplayName(activeSession)}
                  placeholder={`Message ${sessionDisplayName(activeSession)}...`}
                  onClear={() => onClearSessionHistory(activeSession.id)}
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
