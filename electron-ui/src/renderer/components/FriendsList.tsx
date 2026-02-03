import React from 'react';
import { Friend } from '../../shared/types';

interface FriendsListProps {
  onlineFriends: Friend[];
  offlineFriends: Friend[];
  onStartIM: (friend: Friend) => void;
}

export const FriendsList: React.FC<FriendsListProps> = ({
  onlineFriends,
  offlineFriends,
  onStartIM,
}) => {
  return (
    <div className="friends-list">
      {/* Online Friends */}
      <div className="friends-section">
        <h4 className="friends-section-header">
          Online ({onlineFriends.length})
        </h4>
        {onlineFriends.length === 0 ? (
          <div className="friends-empty">No friends online</div>
        ) : (
          <div className="friends-items">
            {onlineFriends.map((friend) => (
              <div
                key={friend.id}
                className="friend-item online"
                onClick={() => onStartIM(friend)}
              >
                <span className="friend-status-dot online" />
                <span className="friend-name">{friend.name || 'Loading...'}</span>
                <button
                  className="friend-im-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartIM(friend);
                  }}
                  title="Send IM"
                >
                  IM
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Offline Friends */}
      <div className="friends-section">
        <h4 className="friends-section-header">
          Offline ({offlineFriends.length})
        </h4>
        {offlineFriends.length === 0 ? (
          <div className="friends-empty">No offline friends</div>
        ) : (
          <div className="friends-items">
            {offlineFriends.map((friend) => (
              <div
                key={friend.id}
                className="friend-item offline"
                onClick={() => onStartIM(friend)}
              >
                <span className="friend-status-dot offline" />
                <span className="friend-name">{friend.name || 'Loading...'}</span>
                <button
                  className="friend-im-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartIM(friend);
                  }}
                  title="Send IM"
                >
                  IM
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
