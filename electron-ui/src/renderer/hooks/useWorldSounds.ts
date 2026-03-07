import { useState, useEffect, useCallback, useRef } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';

export function useWorldSounds() {
  const [volume, setVolumeState] = useState(0.5);
  const prevVolume = useRef(0.5); // remember volume before mute

  useEffect(() => {
    ipcRenderer.invoke(IPC_CHANNELS.SOUND_GET_VOLUME).then((v: number) => {
      if (typeof v === 'number') {
        setVolumeState(v);
        if (v > 0) prevVolume.current = v;
      }
    });
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (clamped > 0) prevVolume.current = clamped;
    ipcRenderer.invoke(IPC_CHANNELS.SOUND_SET_VOLUME, clamped);
  }, []);

  const toggleMute = useCallback(() => {
    setVolumeState(prev => {
      const next = prev > 0 ? 0 : prevVolume.current;
      ipcRenderer.invoke(IPC_CHANNELS.SOUND_SET_VOLUME, next);
      return next;
    });
  }, []);

  return { volume, setVolume, muted: volume === 0, toggleMute };
}
