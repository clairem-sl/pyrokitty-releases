import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ipcRenderer } from 'electron';
import L from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import { createLayerComponent } from '@react-leaflet/core';
import { IPC_CHANNELS } from '../shared/types';

// ── Types ──────────────────────────────────────────────────

interface AvatarPosition {
  accountName: string;
  regionName: string;
  gridX: number;
  gridY: number;
  localX: number;
  localY: number;
  localZ: number;
}

// ── SL Tile Layer ──────────────────────────────────────────
// Tile URL: https://map.secondlife.com/map-{z}-{regionX}-{regionY}-objects.jpg
// Coordinate mapping from LindenHomeMap.tsx reference (mapbot-website).

class LTileLayerSL extends L.TileLayer {
  getTileUrl(coords: L.Coords) {
    const z = 9 - coords.z;
    const regionsPerTileEdge = Math.pow(2, z - 1);
    const x = coords.x * regionsPerTileEdge;
    const y = (Math.abs(coords.y) - 1) * regionsPerTileEdge;
    return `https://map.secondlife.com/map-${z}-${x}-${y}-objects.jpg`;
  }
}

const TileLayerSL = createLayerComponent(
  function createTileLayer(props: any, context: any) {
    const instance = new LTileLayerSL('', { ...props });
    return { instance, context };
  },
  function updateTileLayer() {},
);

// ── Avatar Markers Layer ───────────────────────────────────

interface AvatarMarkersProps {
  positions: AvatarPosition[];
}

const MARKER_COLORS = [
  '#ff6b6b', // red
  '#51cf66', // green
  '#339af0', // blue
  '#fcc419', // yellow
  '#cc5de8', // purple
  '#20c997', // teal
];

const AvatarMarkersLayer = createLayerComponent(
  function createMarkers(props: { positions: AvatarPosition[] }, context: any) {
    const group = L.layerGroup();
    updateMarkerGroup(group, props.positions);
    return { instance: group, context: { ...context, layerContainer: group } };
  },
  function updateMarkers(instance: L.LayerGroup, props: { positions: AvatarPosition[] }, _prevProps: any) {
    updateMarkerGroup(instance, props.positions);
  },
);

function updateMarkerGroup(group: L.LayerGroup, positions: AvatarPosition[]) {
  group.clearLayers();
  positions.forEach((pos, i) => {
    // Map position: gridX + localX/256 gives fractional grid coordinate
    const mapX = pos.gridX + pos.localX / 256;
    const mapY = pos.gridY + pos.localY / 256;

    const color = MARKER_COLORS[i % MARKER_COLORS.length];

    const marker = L.circleMarker([mapY, mapX], {
      radius: 7,
      color: color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2,
    });

    marker.bindTooltip(
      `<strong>${pos.accountName}</strong><br><span class="region-name">${pos.regionName} (${Math.round(pos.localX)}, ${Math.round(pos.localY)}, ${Math.round(pos.localZ)})</span>`,
      {
        className: 'avatar-tooltip',
        direction: 'top',
        offset: [0, -8],
        permanent: false,
      }
    );

    group.addLayer(marker);
  });
}

// ── Auto-center on first position ──────────────────────────

function AutoCenter({ positions }: { positions: AvatarPosition[] }) {
  const map = useMap();
  const hasCentered = useRef(false);

  useEffect(() => {
    if (!hasCentered.current && positions.length > 0) {
      const pos = positions[0];
      const mapX = pos.gridX + pos.localX / 256;
      const mapY = pos.gridY + pos.localY / 256;
      map.setView([mapY, mapX], 6);
      hasCentered.current = true;
    }
  }, [positions, map]);

  return null;
}

// ── MapApp ─────────────────────────────────────────────────

export const MapApp: React.FC = () => {
  const [positions, setPositions] = useState<AvatarPosition[]>([]);

  useEffect(() => {
    const handler = (_event: any, data: AvatarPosition[]) => {
      setPositions(data);
    };
    ipcRenderer.on(IPC_CHANNELS.MAP_POSITION_UPDATE, handler);

    // Request initial positions
    ipcRenderer.invoke(IPC_CHANNELS.MAP_GET_POSITIONS).catch(() => {});

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MAP_POSITION_UPDATE, handler);
    };
  }, []);

  // SL grid center is roughly (1000, 1000) — mainland is around there
  const center = useMemo<L.LatLngExpression>(() => [1000, 1000], []);

  return (
    <MapContainer
      className="map-container"
      center={center}
      zoom={0}
      minZoom={-1}
      maxZoom={10}
      maxBounds={[[0, 0], [2048, 2048]]}
      maxBoundsViscosity={1}
      crs={L.CRS.Simple}
      zoomControl={true}
      attributionControl={false}
    >
      <TileLayerSL minZoom={-1} maxZoom={10} maxNativeZoom={8} minNativeZoom={1} />
      <AvatarMarkersLayer positions={positions} />
      <AutoCenter positions={positions} />
    </MapContainer>
  );
};
