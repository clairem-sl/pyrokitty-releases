import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { ViewerInstance, ViewerStatus } from '../shared/types';
import { accountManager } from './account-manager';
import { gridManager } from './grid-manager';
import { connectionManager, ViewerConnection } from './viewer-connection';

function getViewerPath(): string {
  const appRoot = app.getAppPath();
  return path.join(appRoot, '..', 'build-vc170-64', 'newview', 'Release', 'firestorm-bin.exe');
}

const BASE_WS_PORT = 9001;

export class ViewerManager extends EventEmitter {
  private instances: Map<string, ViewerInstance> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private nextWsPort = BASE_WS_PORT;

  getInstances(): ViewerInstance[] {
    return Array.from(this.instances.values());
  }

  getInstance(id: string): ViewerInstance | undefined {
    return this.instances.get(id);
  }

  getInstanceForAccount(accountId: string): ViewerInstance | undefined {
    return Array.from(this.instances.values()).find(i => i.accountId === accountId);
  }

  private getNextWsPort(): number {
    // Find an unused port
    const usedPorts = new Set(Array.from(this.instances.values()).map(i => i.wsPort));
    while (usedPorts.has(this.nextWsPort)) {
      this.nextWsPort++;
    }
    return this.nextWsPort++;
  }

  async launchViewer(accountId: string, password?: string): Promise<ViewerInstance> {
    // Check if already running
    const existing = this.getInstanceForAccount(accountId);
    if (existing) {
      throw new Error('Viewer already running for this account');
    }

    // Get account details
    const account = accountManager.getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    // Use provided password or saved password
    const loginPassword = password || account.password;
    if (!loginPassword) {
      throw new Error('Password required');
    }

    // Get grid details
    const grid = gridManager.getGrid(account.gridId);
    if (!grid) {
      throw new Error('Grid not found');
    }

    const wsPort = this.getNextWsPort();
    const instanceId = `viewer_${Date.now()}`;

    // Build command line arguments
    const args: string[] = [
      '--login', account.firstName, account.lastName, loginPassword,
      '--grid', grid.nick,
      '--wsport', wsPort.toString(),
    ];

    const viewerPath = getViewerPath();
    console.log(`Launching viewer for ${account.firstName} ${account.lastName} on ${grid.name}`);
    console.log(`Command: ${viewerPath} ${args.map(a => a === loginPassword ? '***' : a).join(' ')}`);

    // Spawn the viewer process
    const process = spawn(viewerPath, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const instance: ViewerInstance = {
      id: instanceId,
      accountId,
      gridId: account.gridId,
      pid: process.pid || 0,
      wsPort,
      startTime: Date.now(),
      status: 'starting',
    };

    this.instances.set(instanceId, instance);
    this.processes.set(instanceId, process);

    // Handle process events
    process.on('spawn', () => {
      this.updateStatus(instanceId, 'running');
      // Try to connect via WebSocket after viewer has time to start
      this.scheduleWebSocketConnect(instanceId, wsPort);
    });

    process.stdout?.on('data', (data) => {
      console.log(`[Viewer ${instanceId}] ${data}`);
    });

    process.stderr?.on('data', (data) => {
      console.error(`[Viewer ${instanceId}] ${data}`);
    });

    process.on('error', (error) => {
      console.error(`[Viewer ${instanceId}] Error:`, error);
      this.updateStatus(instanceId, 'crashed');
    });

    process.on('exit', (code, signal) => {
      console.log(`[Viewer ${instanceId}] Exited with code ${code}, signal ${signal}`);
      this.updateStatus(instanceId, 'disconnected');
      this.cleanup(instanceId);
    });

    return instance;
  }

  stopViewer(instanceId: string): boolean {
    const process = this.processes.get(instanceId);
    if (!process) {
      return false;
    }

    console.log(`Stopping viewer ${instanceId}`);

    // Try graceful shutdown first
    process.kill('SIGTERM');

    // Force kill after timeout
    setTimeout(() => {
      if (this.processes.has(instanceId)) {
        process.kill('SIGKILL');
      }
    }, 5000);

    return true;
  }

  private updateStatus(instanceId: string, status: ViewerStatus): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.status = status;
      this.emit('status-update', instance);
    }
  }

  private cleanup(instanceId: string): void {
    connectionManager.disconnect(instanceId);
    this.instances.delete(instanceId);
    this.processes.delete(instanceId);
  }

  private scheduleWebSocketConnect(instanceId: string, port: number, attempt = 1): void {
    const maxAttempts = 10;
    const delayMs = 3000; // 3 seconds between attempts

    setTimeout(() => {
      const instance = this.instances.get(instanceId);
      if (!instance || instance.status === 'disconnected' || instance.status === 'crashed') {
        return; // Viewer is gone, don't try to connect
      }

      console.log(`[ViewerManager] WebSocket connect attempt ${attempt}/${maxAttempts} for ${instanceId}`);

      const connection = connectionManager.connect(instanceId, port);

      connection.once('connected', () => {
        this.updateStatus(instanceId, 'connected');
        // Auto-subscribe to chat events
        connection.subscribeToChat('all');
      });

      connection.once('error', () => {
        if (attempt < maxAttempts) {
          // Retry
          this.scheduleWebSocketConnect(instanceId, port, attempt + 1);
        } else {
          console.warn(`[ViewerManager] Failed to connect to viewer ${instanceId} after ${maxAttempts} attempts`);
        }
      });

      connection.connect();
    }, delayMs);
  }

  getConnection(instanceId: string): ViewerConnection | undefined {
    return connectionManager.getConnection(instanceId);
  }

  stopAll(): void {
    connectionManager.disconnectAll();
    for (const [instanceId] of this.instances) {
      this.stopViewer(instanceId);
    }
  }
}

export const viewerManager = new ViewerManager();
