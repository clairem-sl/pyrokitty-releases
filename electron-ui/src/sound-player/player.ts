/**
 * player.ts — Runs in a hidden BrowserWindow renderer.
 * Plays OGG Vorbis sound files using HTMLAudioElement.
 */

import { ipcRenderer } from 'electron';

let masterVolume = 0.5;
const attached = new Map<number, HTMLAudioElement>();
const attachedBaseGain = new Map<number, number>();

ipcRenderer.on('sound:play-oneshot', (_: unknown, msg: { path: string; gain: number }) => {
  const audio = new Audio('file:///' + msg.path);
  audio.volume = clamp(msg.gain);
  audio.play().catch(() => {});
});

ipcRenderer.on('sound:play-attached', (_: unknown, msg: { id: number; path: string; gain: number; loop: boolean }) => {
  // Stop any existing sound on this object
  const existing = attached.get(msg.id);
  if (existing) {
    existing.pause();
    existing.src = '';
  }

  const audio = new Audio('file:///' + msg.path);
  const baseGain = msg.gain / masterVolume || msg.gain; // recover base gain before master was applied
  attachedBaseGain.set(msg.id, baseGain);
  audio.volume = clamp(msg.gain);
  audio.loop = !!msg.loop;
  audio.play().catch(() => {});
  attached.set(msg.id, audio);

  if (!msg.loop) {
    audio.addEventListener('ended', () => {
      if (attached.get(msg.id) === audio) {
        attached.delete(msg.id);
        attachedBaseGain.delete(msg.id);
        ipcRenderer.send('sound:ended', msg.id);
      }
    });
  }
});

ipcRenderer.on('sound:stop-attached', (_: unknown, msg: { id: number }) => {
  const audio = attached.get(msg.id);
  if (audio) {
    audio.pause();
    audio.src = '';
    attached.delete(msg.id);
    attachedBaseGain.delete(msg.id);
  }
});

ipcRenderer.on('sound:set-gain', (_: unknown, msg: { id: number; gain: number }) => {
  const audio = attached.get(msg.id);
  if (audio) {
    attachedBaseGain.set(msg.id, msg.gain);
    audio.volume = clamp(msg.gain * masterVolume);
  }
});

// Master volume — scales all active attached sounds immediately
ipcRenderer.on('sound:set-master-volume', (_: unknown, msg: { volume: number }) => {
  masterVolume = msg.volume;
  for (const [id, audio] of attached) {
    const base = attachedBaseGain.get(id) ?? 1;
    audio.volume = clamp(base * masterVolume);
  }
});

function clamp(gain: number): number {
  return Math.min(Math.max(gain, 0), 1);
}

ipcRenderer.send('sound:ready');
