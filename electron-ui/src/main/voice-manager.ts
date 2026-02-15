/**
 * VoiceManager - manages the C# voice sidecar child process.
 *
 * Spawns VoiceSidecar.exe, sends JSON commands over stdin,
 * receives JSON events from stdout.
 *
 * Coordinates voice caps from either:
 * - node-metaverse (bot.currentRegion.caps) during metaverse phase
 * - Firestorm viewer (PKVoiceEventAPI) during viewer phase
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { ViewerConnection } from './viewer-connection';

export interface VoiceEvent {
  event: string;
  [key: string]: unknown;
}

export interface VoiceCaps {
  ProvisionVoiceAccountRequest?: string;
  VoiceSignalingRequest?: string;
  ParcelVoiceInfoRequest?: string;
}

function getSidecarPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'voice', 'VoiceSidecar.exe');
  } else {
    const appRoot = app.getAppPath();
    // dotnet build defaults to Debug; dotnet publish uses Release
    const releasePath = path.join(appRoot, 'voice', 'bin', 'Release', 'net8.0', 'VoiceSidecar.exe');
    const debugPath = path.join(appRoot, 'voice', 'bin', 'Debug', 'net8.0', 'VoiceSidecar.exe');
    try {
      require('fs').accessSync(releasePath);
      return releasePath;
    } catch {
      return debugPath;
    }
  }
}

export class VoiceManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private connected = false;
  private lineBuffer = '';
  private positionInterval: NodeJS.Timeout | null = null;
  private viewerPositionUnsubscribed = false;

  get isConnected(): boolean {
    return this.connected;
  }

  get isRunning(): boolean {
    return this.process != null;
  }

  /**
   * Start the sidecar process.
   */
  start(): void {
    if (this.process) return;

    const sidecarPath = getSidecarPath();
    console.log(`[VoiceManager] Starting sidecar: ${sidecarPath}`);

    try {
      this.process = spawn(sidecarPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleStdoutData(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        // Sidecar logs go to stderr
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(`[VoiceSidecar] ${line.trimEnd()}`);
          }
        }
      });

      this.process.on('error', (error) => {
        console.error(`[VoiceManager] Sidecar error:`, error);
        this.emit('voiceError', error.message);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[VoiceManager] Sidecar exited: code=${code}, signal=${signal}`);
        this.process = null;
        this.connected = false;
        this.emit('stopped');
      });
    } catch (error) {
      console.error(`[VoiceManager] Failed to start sidecar:`, error);
      this.process = null;
    }
  }

  /**
   * Stop the sidecar process.
   */
  stop(): void {
    this.stopPositionUpdates();
    if (this.process) {
      this.sendCommand({ cmd: 'disconnect' });
      setTimeout(() => {
        if (this.process) {
          this.process.kill();
          this.process = null;
        }
      }, 2000);
    }
    this.connected = false;
  }

  /**
   * Connect voice using caps from node-metaverse bot.
   */
  async connectWithBot(bot: any): Promise<void> {
    if (!this.process) this.start();

    const region = bot.currentRegion;
    if (!region?.caps) {
      console.warn('[VoiceManager] No caps available from bot');
      return;
    }

    const caps: VoiceCaps = {};
    try {
      caps.ProvisionVoiceAccountRequest = await region.caps.getCapability('ProvisionVoiceAccountRequest');
    } catch { /* cap not available */ }
    try {
      caps.VoiceSignalingRequest = await region.caps.getCapability('VoiceSignalingRequest');
    } catch { /* cap not available */ }
    try {
      caps.ParcelVoiceInfoRequest = await region.caps.getCapability('ParcelVoiceInfoRequest');
    } catch { /* cap not available */ }

    if (!caps.ProvisionVoiceAccountRequest) {
      console.warn('[VoiceManager] ProvisionVoiceAccountRequest cap not available');
      return;
    }

    const agentId = bot.agent?.agentID?.toString?.() || '';
    const sessionId = bot.agent?.sessionID?.toString?.() || '';
    const regionName = region.regionName || '';

    this.sendCommand({
      cmd: 'connect',
      caps,
      agentId,
      sessionId,
      regionName,
      parcelLocalId: -1,
    });

    // Start position updates from bot
    this.startBotPositionUpdates(bot);
  }

  /**
   * Switch to voice caps from viewer (PKVoiceEventAPI).
   */
  async connectWithViewer(viewerConnection: ViewerConnection): Promise<void> {
    if (!this.process) this.start();

    // Stop bot position updates
    this.stopPositionUpdates();

    try {
      // Get caps from viewer
      const capsResponse = await viewerConnection.request('VoiceAPI', { op: 'getCaps' });

      if (!capsResponse?.caps?.ProvisionVoiceAccountRequest) {
        console.warn('[VoiceManager] Viewer does not have voice caps');
        return;
      }

      this.sendCommand({
        cmd: 'connect',
        caps: capsResponse.caps,
        agentId: capsResponse.agentId,
        sessionId: capsResponse.sessionId,
        regionName: capsResponse.regionName,
        parcelLocalId: capsResponse.parcelLocalId ?? -1,
        position: capsResponse.position,
        rotation: capsResponse.rotation,
      });

      // Subscribe to position updates from viewer
      this.viewerPositionUnsubscribed = false;
      await viewerConnection.request('VoiceAPI', {
        op: 'subscribePosition',
        reply: viewerConnection.replyPumpName,
        interval: 0.1,
      });

      // Listen for position updates from viewer
      viewerConnection.on('message', this.handleViewerMessage);

    } catch (error) {
      console.error('[VoiceManager] Failed to connect with viewer:', error);
    }
  }

  /**
   * Disconnect voice (e.g., when session ends).
   */
  disconnect(): void {
    this.stopPositionUpdates();
    if (this.process) {
      this.sendCommand({ cmd: 'disconnect' });
    }
    this.connected = false;
  }

  /**
   * Remove viewer message listener (call when viewer disconnects).
   */
  detachFromViewer(viewerConnection: ViewerConnection): void {
    viewerConnection.off('message', this.handleViewerMessage);
    this.viewerPositionUnsubscribed = true;
  }

  // ── Audio controls ─────────────────────────────────────

  setMicMute(muted: boolean): void {
    this.sendCommand({ cmd: 'setMicMute', muted });
  }

  setVolume(volume: number): void {
    this.sendCommand({ cmd: 'setVolume', volume: Math.max(0, Math.min(1, volume)) });
  }

  playFile(filePath: string, loop = false): void {
    this.sendCommand({ cmd: 'playFile', path: filePath, loop });
  }

  stopFile(): void {
    this.sendCommand({ cmd: 'stopFile' });
  }

  listAudioDevices(): void {
    this.sendCommand({ cmd: 'listAudioDevices' });
  }

  setInputDevice(deviceName: string): void {
    this.sendCommand({ cmd: 'setInputDevice', deviceName });
  }

  setOutputDevice(deviceName: string): void {
    this.sendCommand({ cmd: 'setOutputDevice', deviceName });
  }

  // ── Internal ───────────────────────────────────────────

  private sendCommand(cmd: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      console.warn('[VoiceManager] Cannot send command — sidecar not running');
      return;
    }
    const line = JSON.stringify(cmd) + '\n';
    this.process.stdin.write(line);
  }

  private handleStdoutData(data: string): void {
    this.lineBuffer += data;
    const lines = this.lineBuffer.split('\n');
    // Keep incomplete last line in buffer
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as VoiceEvent;
        this.handleEvent(event);
      } catch (error) {
        console.warn(`[VoiceManager] Failed to parse event: ${line}`);
      }
    }
  }

  private handleEvent(event: VoiceEvent): void {
    console.log(`[VoiceManager] Event: ${event.event}`, event);

    switch (event.event) {
      case 'ready':
        console.log('[VoiceManager] Sidecar ready');
        this.emit('ready');
        break;
      case 'connected':
        this.connected = true;
        this.emit('connected', event.channel);
        break;
      case 'disconnected':
        this.connected = false;
        this.emit('disconnected', event.reason);
        break;
      case 'participantJoined':
        this.emit('participantJoined', event.agentId);
        break;
      case 'participantLeft':
        this.emit('participantLeft', event.agentId);
        break;
      case 'participantSpeaking':
        this.emit('participantSpeaking', event.agentId, event.power);
        break;
      case 'audioDevices':
        this.emit('audioDevices', event.inputs, event.outputs);
        break;
      case 'error':
        console.error(`[VoiceManager] Sidecar error: ${event.message}`);
        this.emit('voiceError', event.message);
        break;
      default:
        this.emit('event', event);
    }
  }

  private startBotPositionUpdates(bot: any): void {
    this.stopPositionUpdates();

    this.positionInterval = setInterval(() => {
      if (!this.process || !bot?.agent) return;

      const pos = bot.agent.position;
      const rot = bot.agent.rotation;
      const regionName = bot.currentRegion?.regionName || '';

      if (pos) {
        this.sendCommand({
          cmd: 'updatePosition',
          position: [pos.x || 0, pos.y || 0, pos.z || 0],
          rotation: [rot?.x || 0, rot?.y || 0, rot?.z || 0, rot?.w || 1],
          regionName,
          parcelLocalId: -1,
        });
      }
    }, 100);
  }

  private stopPositionUpdates(): void {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
      this.positionInterval = null;
    }
  }

  private handleViewerMessage = (pump: string, data: Record<string, unknown>): void => {
    if (this.viewerPositionUnsubscribed) return;
    if ((data as any)?.type !== 'positionUpdate') return;

    this.sendCommand({
      cmd: 'updatePosition',
      position: data.position,
      rotation: data.rotation,
      regionName: data.regionName,
      parcelLocalId: data.parcelLocalId,
    });
  };
}

export const voiceManager = new VoiceManager();
