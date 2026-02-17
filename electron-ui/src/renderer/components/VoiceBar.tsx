import React from 'react';

interface VoiceBarProps {
  connected: boolean;
  connecting: boolean;
  micMuted: boolean;
  speakerMuted: boolean;
  volume: number;
  micLevel: number;
  pttDown: () => void;
  pttUp: () => void;
  setVolume: (v: number) => void;
  toggleSpeakerMute: () => void;
}

export const VoiceBar: React.FC<VoiceBarProps> = ({
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
}) => {
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

      <div className="voice-mic-level" title={`Mic level: ${Math.round(micLevel * 100)}%`}>
        <div
          className="voice-mic-level-fill"
          style={{ width: `${micMuted ? 0 : Math.round(micLevel * 100)}%` }}
        />
      </div>

      <button
        className={`voice-ptt-btn ${!micMuted ? 'active' : ''}`}
        onMouseDown={pttDown}
        onMouseUp={pttUp}
        onMouseLeave={pttUp}
        title="Push to talk (hold ` key)"
      >
        TALK
      </button>
    </div>
  );
};
