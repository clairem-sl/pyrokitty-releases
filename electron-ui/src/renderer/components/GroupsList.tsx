import React from 'react';
import { Group } from '../../shared/types';

interface GroupsListProps {
  groups: Group[];
  onOpenGroupChat: (group: Group) => void;
}

export const GroupsList: React.FC<GroupsListProps> = ({
  groups,
  onOpenGroupChat,
}) => {
  return (
    <div className="groups-list">
      {groups.length === 0 ? (
        <div className="groups-empty">
          <p>No groups found</p>
          <p className="groups-empty-hint">Groups will appear here after login</p>
        </div>
      ) : (
        <div className="groups-items">
          {groups.map((group) => (
            <div
              key={group.id}
              className="group-item"
              onClick={() => onOpenGroupChat(group)}
            >
              <div className="group-info">
                <span className="group-name">{group.name}</span>
              </div>
              <button
                className="group-chat-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenGroupChat(group);
                }}
                title="Open group chat"
              >
                Chat
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
