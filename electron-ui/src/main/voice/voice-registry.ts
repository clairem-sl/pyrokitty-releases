/**
 * VoiceRegistry - manages per-instance VoiceManager instances.
 *
 * Each bot/viewer instance gets its own VoiceManager (and thus its own
 * VoiceSidecar.exe process + WebRTC session). PTT is routed to the
 * selected instance only; volume is global across all instances.
 */

import { EventEmitter } from 'events';
import { VoiceManager } from './voice-manager';

const FORWARDED_EVENTS = [
  'ready', 'connected', 'disconnected', 'stopped',
  'participantJoined', 'participantLeft', 'participantSpeaking',
  'micLevel', 'voiceError', 'audioDevices', 'event',
] as const;

export class VoiceRegistry extends EventEmitter {
  private instances = new Map<string, VoiceManager>();
  private selectedInstanceId: string | null = null;

  /** Create (or get existing) VoiceManager for an instance. */
  create(instanceId: string): VoiceManager {
    let vm = this.instances.get(instanceId);
    if (vm) return vm;

    vm = new VoiceManager(instanceId);
    this.instances.set(instanceId, vm);

    // Forward events with instanceId as first arg
    for (const event of FORWARDED_EVENTS) {
      vm.on(event, (...args: unknown[]) => this.emit(event, instanceId, ...args));
    }

    // Clean up on stop
    vm.on('stopped', () => {
      this.instances.delete(instanceId);
    });

    return vm;
  }

  get(instanceId: string): VoiceManager | undefined {
    return this.instances.get(instanceId);
  }

  /** Stop and remove an instance's voice. */
  remove(instanceId: string): void {
    const vm = this.instances.get(instanceId);
    if (vm) {
      vm.stop();
      this.instances.delete(instanceId);
    }
  }

  setSelectedInstance(instanceId: string | null): void {
    this.selectedInstanceId = instanceId;
  }

  getSelected(): VoiceManager | undefined {
    return this.selectedInstanceId ? this.instances.get(this.selectedInstanceId) : undefined;
  }

  getSelectedInstanceId(): string | null {
    return this.selectedInstanceId;
  }

  /** Apply a callback to every active VoiceManager. */
  forEach(fn: (vm: VoiceManager, instanceId: string) => void): void {
    this.instances.forEach(fn);
  }

  stopAll(): void {
    for (const [id, vm] of this.instances) {
      vm.stop();
    }
    this.instances.clear();
  }
}

export const voiceRegistry = new VoiceRegistry();
