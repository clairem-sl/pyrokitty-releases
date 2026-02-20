import React, { useRef, useState, useEffect } from 'react';
import { NearbyAvatar, RegionInfo, displayName } from '../../shared/types';

interface MiniMapProps {
  regionInfo: RegionInfo | null;
  nearbyAvatars: NearbyAvatar[];
  onAvatarClick?: (avatar: NearbyAvatar) => void;
  onTeleport?: (x: number, y: number) => void;
}

export const MiniMap: React.FC<MiniMapProps> = ({
  regionInfo,
  nearbyAvatars,
  onAvatarClick,
  onTeleport,
}) => {
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [teleportTarget, setTeleportTarget] = useState<{ x: number; y: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  // Safety timeout: clear teleporting state after 15s
  useEffect(() => {
    if (!teleportTarget) return;
    const timer = setTimeout(() => setTeleportTarget(null), 15000);
    return () => clearTimeout(timer);
  }, [teleportTarget]);

  // Clear teleport target once agent position is close to it
  if (teleportTarget && regionInfo?.agentPosition) {
    const dx = regionInfo.agentPosition.x - teleportTarget.x;
    const dy = regionInfo.agentPosition.y - teleportTarget.y;
    if (Math.sqrt(dx * dx + dy * dy) < 5) {
      setTeleportTarget(null);
    }
  }

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
    <div
      className={`mini-map ${teleportTarget ? 'teleporting' : ''}`}
      ref={mapRef}
      onClick={() => setSelectedAvatarId(null)}
      onDoubleClick={(e) => {
        if (!onTeleport || !mapRef.current || teleportTarget) return;
        const rect = mapRef.current.getBoundingClientRect();
        const x = Math.round(((e.clientX - rect.left) / rect.width) * 256);
        const y = Math.round((1 - (e.clientY - rect.top) / rect.height) * 256);
        setTeleportTarget({ x, y });
        onTeleport(x, y);
      }}
    >
      <img
        src={regionInfo.mapImageUrl}
        alt={regionInfo.name}
        className="mini-map-image"
      />
      <div className="mini-map-avatars">
        {(regionInfo.agentPosition || teleportTarget) && (
          <div
            className={`mini-map-avatar-dot self ${selectedAvatarId === 'self' ? 'selected' : ''} ${teleportTarget ? 'teleporting' : ''}`}
            style={{
              left: `${((teleportTarget?.x ?? regionInfo.agentPosition!.x) / 256) * 100}%`,
              top: `${((256 - (teleportTarget?.y ?? regionInfo.agentPosition!.y)) / 256) * 100}%`,
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
