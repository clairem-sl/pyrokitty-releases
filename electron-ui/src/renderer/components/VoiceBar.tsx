import React from 'react';
import { useVoice } from '../hooks/useVoice';
import { useWorldSounds } from '../hooks/useWorldSounds';

interface VoiceBarProps {
  activeInstanceId: string | null;
}

export const VoiceBar: React.FC<VoiceBarProps> = ({ activeInstanceId }) => {
  const {
    connected,
    connecting,
    micMuted,
    speakerMuted,
    volume,
    micLevel,
    pttDown,
    pttUp,
    setVolume,
    toggleSpeakerMute,
  } = useVoice(activeInstanceId);

  const { volume: soundVolume, setVolume: setSoundVolume, muted: soundMuted, toggleMute: toggleSoundMute } = useWorldSounds();

  const statusText = connected ? 'Voice' : connecting ? 'Connecting...' : 'No voice';
  const dotClass = connected ? 'connected' : connecting ? 'connecting' : 'disconnected';

  return (
    <div className="voice-bar">
      <span className={`voice-status-dot ${dotClass}`} />
      <span className="voice-status-text">{statusText}</span>

      <button
        className={`voice-btn ${speakerMuted ? 'muted' : ''}`}
        onClick={toggleSpeakerMute}
        title={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
      >
        {speakerMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
      </button>

      <input
        type="range"
        className="voice-volume-slider"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
        title={`Volume: ${Math.round(volume * 100)}%`}
      />

      <button
        className={`voice-ptt-btn ${!micMuted ? 'active' : ''}`}
        onMouseDown={pttDown}
        onMouseUp={pttUp}
        onMouseLeave={pttUp}
        title="Push to talk (hold ` key)"
      >
        TALK
      </button>

      {!micMuted && (
        <div className="voice-mic-level" title={`Mic level: ${Math.round(micLevel * 100)}%`}>
          <div
            className="voice-mic-level-fill"
            style={{ width: `${Math.round(micLevel * 100)}%` }}
          />
        </div>
      )}

      {/* World sounds — right-aligned */}
      <span className="voice-sounds-spacer" />
      <span className="voice-status-text">Sounds</span>
      <button
        className={`voice-btn ${soundMuted ? 'muted' : ''}`}
        onClick={toggleSoundMute}
        title={soundMuted ? 'Unmute sounds' : 'Mute sounds'}
      >
        {soundMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
      </button>
      <input
        type="range"
        className="voice-volume-slider"
        min={0}
        max={100}
        value={Math.round(soundVolume * 100)}
        onChange={(e) => setSoundVolume(parseInt(e.target.value) / 100)}
        title={`Sound volume: ${Math.round(soundVolume * 100)}%`}
      />
    </div>
  );
};
