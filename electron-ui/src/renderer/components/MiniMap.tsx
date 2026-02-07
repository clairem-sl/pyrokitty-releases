import React, { useRef, useState } from 'react';
import { NearbyAvatar, RegionInfo, displayName } from '../../shared/types';

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
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  // Position tooltip to avoid edge clipping
  const tooltipStyle = (xPct: number, yPct: number): React.CSSProperties => {
    const style: React.CSSProperties = {};

    // Vertical: near top → show below, otherwise above (default CSS)
    if (yPct < 34) {
      style.bottom = 'auto';
      style.top = 'calc(100% + 4px)';
    }

    // Horizontal: near left/right edge → center tooltip over the map
    if (xPct < 34 || xPct > 66) {
      const mapWidth = mapRef.current?.offsetWidth ?? 200;
      const dotX = (xPct / 100) * mapWidth;
      const mapCenter = mapWidth / 2;
      style.left = `${mapCenter - dotX}px`;
      style.transform = 'translateX(-50%)';
    }

    return style;
  };

  if (!regionInfo) {
    return (
      <div className="mini-map">
        <div className="mini-map-loading">Loading map...</div>
      </div>
    );
  }

  return (
    <div className="mini-map" ref={mapRef} onClick={() => setSelectedAvatarId(null)}>
      <img
        src={regionInfo.mapImageUrl}
        alt={regionInfo.name}
        className="mini-map-image"
      />
      <div className="mini-map-avatars">
        {regionInfo.agentPosition && (
          <div
            className={`mini-map-avatar-dot self ${selectedAvatarId === 'self' ? 'selected' : ''}`}
            style={{
              left: `${(regionInfo.agentPosition.x / 256) * 100}%`,
              top: `${((256 - regionInfo.agentPosition.y) / 256) * 100}%`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAvatarId(selectedAvatarId === 'self' ? null : 'self');
            }}
          >
            {selectedAvatarId === 'self' && (
              <div
                className="mini-map-avatar-tooltip self-tooltip"
                style={tooltipStyle(
                  (regionInfo.agentPosition.x / 256) * 100,
                  ((256 - regionInfo.agentPosition.y) / 256) * 100
                )}
              >
                You<br />({Math.round(regionInfo.agentPosition.z)}m)
              </div>
            )}
          </div>
        )}
        {nearbyAvatars.map((avatar) => {
          if (!avatar.position) return null;
          const left = `${(avatar.position.x / 256) * 100}%`;
          const top = `${((256 - avatar.position.y) / 256) * 100}%`;
          const isSelected = selectedAvatarId === avatar.id;
          return (
            <div
              key={avatar.id}
              className={`mini-map-avatar-dot ${isSelected ? 'selected' : ''}`}
              style={{ left, top }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedAvatarId(isSelected ? null : avatar.id);
              }}
            >
              {isSelected && (
                <div
                  className="mini-map-avatar-tooltip"
                  style={tooltipStyle(
                    (avatar.position!.x / 256) * 100,
                    ((256 - avatar.position!.y) / 256) * 100
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAvatarClick?.(avatar);
                    setSelectedAvatarId(null);
                  }}
                >
                  {displayName(avatar.name)}<br />({Math.round(avatar.position!.z)}m)
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mini-map-region-name">{regionInfo.name}</div>
    </div>
  );
};
