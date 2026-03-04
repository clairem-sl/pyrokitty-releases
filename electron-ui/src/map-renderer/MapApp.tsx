import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ipcRenderer } from 'electron';
import L from 'leaflet';
import { MapContainer, useMap, useMapEvents } from 'react-leaflet';
import { createLayerComponent } from '@react-leaflet/core';
import { IPC_CHANNELS, MAP_COLORS, MapMarker } from '../shared/types';

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

const ACCOUNT_COLOR = MAP_COLORS.SELF;
const NEARBY_COLOR = MAP_COLORS.NEARBY;

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

  for (const pos of markers) {
    const mapX = pos.gridX + pos.localX / 256;
    const mapY = pos.gridY + pos.localY / 256;
    const isAccount = pos.type === 'account';
    const color = isAccount ? ACCOUNT_COLOR : NEARBY_COLOR;
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

// ── Teleport Popup ────────────────────────────────────────

function TeleportPopup({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  const popupRef = useRef<L.Popup | null>(null);
  const pulseMarkerRef = useRef<L.CircleMarker | null>(null);
  const targetRef = useRef<{ lat: number; lng: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTeleportMarker = useCallback(() => {
    if (pulseMarkerRef.current) {
      pulseMarkerRef.current.remove();
      pulseMarkerRef.current = null;
    }
    targetRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Clear pulse when account marker arrives near target
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const accountPos = markers.find(m => m.type === 'account');
    if (!accountPos) return;
    const mapX = accountPos.gridX + accountPos.localX / 256;
    const mapY = accountPos.gridY + accountPos.localY / 256;
    const dx = mapX - target.lng;
    const dy = mapY - target.lat;
    if (Math.sqrt(dx * dx + dy * dy) < 0.1) {
      clearTeleportMarker();
    }
  }, [markers, clearTeleportMarker]);

  // Cleanup on unmount
  useEffect(() => clearTeleportMarker, [clearTeleportMarker]);

  const handleTeleport = useCallback((gridX: number, gridY: number) => {
    const popup = popupRef.current;
    if (!popup) return;
    const container = popup.getElement();
    if (!container) return;
    const xInput = container.querySelector<HTMLInputElement>('.tp-input-x');
    const yInput = container.querySelector<HTMLInputElement>('.tp-input-y');
    const zInput = container.querySelector<HTMLInputElement>('.tp-input-z');
    const x = xInput ? Number(xInput.value) : 128;
    const y = yInput ? Number(yInput.value) : 128;
    const z = zInput ? Number(zInput.value) : 30;

    // Place pulsing marker at target
    clearTeleportMarker();
    const targetLatLng = L.latLng(gridY + y / 256, gridX + x / 256);
    targetRef.current = targetLatLng;
    const pulse = L.circleMarker(targetLatLng, {
      radius: 8, color: MAP_COLORS.SELF, fillColor: MAP_COLORS.SELF, fillOpacity: 0.8, weight: 2,
      className: 'tp-pulse-marker',
    }).addTo(map);
    pulseMarkerRef.current = pulse;

    // Safety timeout: clear after 15s
    timeoutRef.current = setTimeout(clearTeleportMarker, 15000);

    ipcRenderer.invoke(IPC_CHANNELS.TELEPORT_REGION, gridX, gridY, x, y, z).then((result: any) => {
      if (result?.error) clearTeleportMarker();
    });
    map.closePopup();
  }, [map, clearTeleportMarker]);

  useMapEvents({
    dblclick(e) {
      if (targetRef.current) return; // already teleporting
      const latlng = e.latlng;
      const gridX = Math.floor(latlng.lng);
      const gridY = Math.floor(latlng.lat);
      const localX = Math.round((latlng.lng - gridX) * 256);
      const localY = Math.round((latlng.lat - gridY) * 256);

      const content = document.createElement('div');
      content.className = 'tp-popup-content';
      content.innerHTML = `
        <div class="tp-popup-region">Region (${gridX}, ${gridY})</div>
        <div class="tp-popup-row">
          <label>X<input type="number" class="tp-input-x" min="0" max="255" value="${localX}"></label>
          <label>Y<input type="number" class="tp-input-y" min="0" max="255" value="${localY}"></label>
          <label>Z<input type="number" class="tp-input-z" min="0" max="4096" value="30"></label>
        </div>
        <button class="tp-popup-btn">Teleport</button>
      `;

      const btn = content.querySelector('.tp-popup-btn')!;
      btn.addEventListener('click', () => handleTeleport(gridX, gridY));

      // Enter key on any input triggers teleport
      content.querySelectorAll('input').forEach(input => {
        input.addEventListener('keydown', (ev: KeyboardEvent) => {
          if (ev.key === 'Enter') handleTeleport(gridX, gridY);
        });
      });

      const popup = L.popup({ closeButton: true, className: 'tp-popup', minWidth: 160 })
        .setLatLng(latlng)
        .setContent(content)
        .openOn(map);

      popupRef.current = popup;
    },
  });

  return null;
}

// ── MapApp ─────────────────────────────────────────────────

export const MapApp: React.FC = () => {
  const [markers, setMarkers] = useState<MapMarker[]>([]);

  // Full marker refresh from 3s timer (nearby avatars, agent counts, etc.)
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

  // Fast account position updates (~500ms) — merge into existing markers
  useEffect(() => {
    const handler = (_event: any, data: { instanceId: string; regionInfo: { x: number; y: number; agentPosition?: { x: number; y: number; z: number } } }) => {
      const pos = data.regionInfo.agentPosition;
      if (!pos) return;
      setMarkers(prev => prev.map(m =>
        m.type === 'account'
          ? { ...m, gridX: data.regionInfo.x, gridY: data.regionInfo.y, localX: pos.x, localY: pos.y, localZ: pos.z }
          : m
      ));
    };
    ipcRenderer.on(IPC_CHANNELS.REGION_INFO_UPDATE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.REGION_INFO_UPDATE, handler);
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
      doubleClickZoom={false}
    >
      <TileLayerSL minZoom={-1} maxZoom={10} maxNativeZoom={8} minNativeZoom={1} />
      <AvatarMarkersLayer markers={markers} />
      <AutoCenter markers={markers} />
      <TeleportPopup markers={markers} />
    </MapContainer>
  );
};
