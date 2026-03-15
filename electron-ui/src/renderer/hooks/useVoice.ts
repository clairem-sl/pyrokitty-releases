import { useState, useEffect, useCallback, useRef } from 'react';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS, VoiceState } from '../../shared/types';

const DEFAULT_STATE: VoiceState = {
  connected: false,
  connecting: false,
  micMuted: true,
  speakerMuted: false,
  volume: 1.0,
  micLevel: 0,
  participants: [],
};

export function useVoice(activeInstanceId: string | null) {
  const [states, setStates] = useState<Map<string, VoiceState>>(new Map());
  const pttActiveRef = useRef(false);

  useEffect(() => {
    const handler = (_event: any, data: VoiceState) => {
      if (data.instanceId) {
        setStates(prev => {
          const next = new Map(prev);
          next.set(data.instanceId!, data);
          return next;
        });
      }
    };
    ipcRenderer.on(IPC_CHANNELS.VOICE_STATE_UPDATE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.VOICE_STATE_UPDATE, handler);
    };
  }, []);

  const state = (activeInstanceId ? states.get(activeInstanceId) : null) || DEFAULT_STATE;

  const pttDown = useCallback(() => {
    if (!pttActiveRef.current) {
      pttActiveRef.current = true;
      ipcRenderer.invoke(IPC_CHANNELS.VOICE_PTT_DOWN);
    }
  }, []);

  const pttUp = useCallback(() => {
    if (pttActiveRef.current) {
      pttActiveRef.current = false;
      ipcRenderer.invoke(IPC_CHANNELS.VOICE_PTT_UP);
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_SET_VOLUME, v);
  }, []);

  const toggleSpeakerMute = useCallback(() => {
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_TOGGLE_SPEAKER_MUTE);
  }, []);

  // Global PTT key (backtick)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.repeat && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        pttDown();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === '`') {
        pttUp();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pttDown, pttUp]);

  return {
    ...state,
    pttDown,
    pttUp,
    setVolume,
    toggleSpeakerMute,
  };
}
