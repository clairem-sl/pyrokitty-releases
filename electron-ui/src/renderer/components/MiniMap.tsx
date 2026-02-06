import React from 'react';
import { NearbyAvatar, RegionInfo } from '../../shared/types';

interface MiniMapProps {
  regionInfo: RegionInfo | null;
  nearbyAvatars: NearbyAvatar[];
  onAvatarClick?: (avatar: NearbyAvatar) => void;
}

export const MiniMap: React.FC<MiniMapProps> = ({
  regionInfo,
  nearbyAvatars,
  onAvatarClick,
}) => {
  if (!regionInfo) {
    return (
      <div className="mini-map">
        <div className="mini-map-loading">Loading map...</div>
      </div>
    );
  }

  return (
    <div className="mini-map">
      <img
        src={regionInfo.mapImageUrl}
        alt={regionInfo.name}
        className="mini-map-image"
      />
      <div className="mini-map-avatars">
        {nearbyAvatars.map((avatar) => {
          if (!avatar.position) return null;
          // SL coordinates: X is east, Y is north
          // CSS: left is X (east), bottom would be Y but we use top with inverted Y
          // Use percentage for responsive sizing
          const left = `${(avatar.position.x / 256) * 100}%`;
          const top = `${((256 - avatar.position.y) / 256) * 100}%`;
          return (
            <div
              key={avatar.id}
              className="mini-map-avatar-dot"
              style={{ left, top }}
              title={avatar.name}
              onClick={() => onAvatarClick?.(avatar)}
            />
          );
        })}
      </div>
      <div className="mini-map-region-name">{regionInfo.name}</div>
    </div>
  );
};
