import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ipcRenderer } from 'electron';
import L from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import { createLayerComponent } from '@react-leaflet/core';
import { IPC_CHANNELS, MapMarker } from '../shared/types';

// ── SL Tile Layer ──────────────────────────────────────────

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

// ── Colors ───────────────────────────────────────────────

const ACCOUNT_COLORS = [
  '#ff6b6b', '#51cf66', '#339af0', '#fcc419', '#cc5de8', '#20c997',
];
const NEARBY_COLOR = '#51cf66';

// ── Avatar Markers Layer ──────────────────────────────────

const AvatarMarkersLayer = createLayerComponent(
  function createMarkers(props: { markers: MapMarker[] }, context: any) {
    const group = L.layerGroup();
    updateMarkerGroup(group, props.markers);
    return { instance: group, context: { ...context, layerContainer: group } };
  },
  function updateMarkers(instance: L.LayerGroup, props: { markers: MapMarker[] }, _prevProps: any) {
    updateMarkerGroup(instance, props.markers);
  },
);

function updateMarkerGroup(group: L.LayerGroup, markers: MapMarker[]) {
  group.clearLayers();

  let accountIdx = 0;
  for (const pos of markers) {
    const mapX = pos.gridX + pos.localX / 256;
    const mapY = pos.gridY + pos.localY / 256;
    const isAccount = pos.type === 'account';
    const color = isAccount ? ACCOUNT_COLORS[accountIdx++ % ACCOUNT_COLORS.length] : NEARBY_COLOR;
    const marker = L.circleMarker([mapY, mapX], {
      radius: isAccount ? 7 : 4, color, fillColor: color, fillOpacity: 0.85, weight: isAccount ? 2 : 1,
    });
    const nameTag = isAccount ? `<strong>${pos.name}</strong>` : `<span>${pos.name}</span>`;
    marker.bindTooltip(
      `${nameTag}<br><span class="region-name">${pos.regionName} (${Math.round(pos.localX)}, ${Math.round(pos.localY)}, ${Math.round(pos.localZ)})</span>`,
      { className: 'avatar-tooltip', direction: 'top', offset: [0, isAccount ? -8 : -6] }
    );
    group.addLayer(marker);
  }
}

// ── Auto-center on first position ──────────────────────────

function AutoCenter({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  const hasCentered = useRef(false);

  useEffect(() => {
    if (hasCentered.current) return;
    const accountPos = markers.find(m => m.type === 'account');
    if (!accountPos) return;
    if (accountPos.gridX === 0 && accountPos.gridY === 0) return;
    const mapX = accountPos.gridX + accountPos.localX / 256;
    const mapY = accountPos.gridY + accountPos.localY / 256;
    map.setView([mapY, mapX], 6);
    hasCentered.current = true;
  }, [markers, map]);

  return null;
}

// ── MapApp ─────────────────────────────────────────────────

export const MapApp: React.FC = () => {
  const [markers, setMarkers] = useState<MapMarker[]>([]);

  useEffect(() => {
    const handler = (_event: any, data: MapMarker[]) => {
      setMarkers(data);
    };
    ipcRenderer.on(IPC_CHANNELS.MAP_POSITION_UPDATE, handler);

    ipcRenderer.invoke(IPC_CHANNELS.MAP_GET_POSITIONS).then((data: MapMarker[]) => {
      if (data?.length) setMarkers(data);
    }).catch(() => {});

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MAP_POSITION_UPDATE, handler);
    };
  }, []);

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
      <AvatarMarkersLayer markers={markers} />
      <AutoCenter markers={markers} />
    </MapContainer>
  );
};
