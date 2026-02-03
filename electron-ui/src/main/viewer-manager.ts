import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { ViewerInstance, ViewerStatus, ConnectionState } from '../shared/types';
import { accountManager } from './account-manager';
import { gridManager } from './grid-manager';
import { connectionManager, ViewerConnection } from './viewer-connection';
import { metaverseConnectionManager, MetaverseConnection } from './metaverse-connection';

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

  /**
   * Launch a session - logs in via node-metaverse first, then optionally hands off to viewer
   */
  async launchViewer(accountId: string, password?: string, options?: { startLocation?: string; launchViewer?: boolean }): Promise<ViewerInstance> {
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
    const shouldLaunchViewer = options?.launchViewer !== false;

    // Create instance record
    const instance: ViewerInstance = {
      id: instanceId,
      accountId,
      gridId: account.gridId,
      pid: 0,
      wsPort,
      startTime: Date.now(),
      status: 'starting',
      connectionState: 'disconnected',
    };

    this.instances.set(instanceId, instance);

    try {
      // Step 1: Create MetaverseConnection and login via node-metaverse
      console.log(`[ViewerManager] Creating metaverse connection for ${account.firstName} ${account.lastName}`);
      const metaverse = metaverseConnectionManager.create(instanceId);

      // Forward state changes to instance
      metaverse.on('state-change', (state: ConnectionState) => {
        this.updateConnectionState(instanceId, state);
      });

      this.updateConnectionState(instanceId, 'logging_in');

      await metaverse.login({
        firstName: account.firstName,
        lastName: account.lastName,
        password: loginPassword,
        gridLoginUri: grid.loginUri,
        startLocation: options?.startLocation,
      });

      console.log(`[ViewerManager] Login successful, connected to metaverse`);
      this.updateStatus(instanceId, 'running');

      // Set region name now that we're connected
      const regionName = metaverse.getRegionName();
      if (regionName) {
        this.updateRegionName(instanceId, regionName);
      }

      // Step 2: If viewer launch is requested, prepare handoff and launch viewer
      if (shouldLaunchViewer) {
        await this.launchViewerWithHandoff(instanceId, instance, metaverse, grid.nick, wsPort, loginPassword);
      }

      return instance;

    } catch (error) {
      console.error(`[ViewerManager] Launch failed:`, error);
      this.cleanup(instanceId);
      throw error;
    }
  }

  /**
   * Launch the viewer for an existing metaverse session.
   * Used when user is already logged in via node-metaverse and wants to launch the viewer.
   */
  async launchViewerForInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error('Instance not found');
    }

    if (instance.connectionState !== 'metaverse_connected') {
      throw new Error(`Cannot launch viewer: instance is ${instance.connectionState}, expected metaverse_connected`);
    }

    const metaverse = metaverseConnectionManager.get(instanceId);
    if (!metaverse) {
      throw new Error('Metaverse connection not found');
    }

    const account = accountManager.getAccount(instance.accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    const grid = gridManager.getGrid(instance.gridId);
    if (!grid) {
      throw new Error('Grid not found');
    }

    console.log(`[ViewerManager] Launching viewer for existing session ${instanceId}`);

    await this.launchViewerWithHandoff(
      instanceId,
      instance,
      metaverse,
      grid.nick,
      instance.wsPort,
      account.password || ''
    );
  }

  /**
   * Launch the viewer process and perform session handoff
   */
  private async launchViewerWithHandoff(
    instanceId: string,
    instance: ViewerInstance,
    metaverse: MetaverseConnection,
    gridNick: string,
    wsPort: number,
    password: string
  ): Promise<void> {
    // Prepare handoff data (includes teleport if needed)
    console.log(`[ViewerManager] Preparing handoff data...`);
    const handoffData = await metaverse.prepareHandoff();

    // Launch viewer in external login mode
    const viewerPath = getViewerPath();
    const args: string[] = [
      '--external-login',
      '--set', 'PKWebSocketPort', wsPort.toString(),
    ];

    console.log(`[ViewerManager] Launching viewer in external login mode`);
    console.log(`[ViewerManager] Command: ${viewerPath} ${args.join(' ')}`);

    const process = spawn(viewerPath, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    instance.pid = process.pid || 0;
    this.processes.set(instanceId, process);

    // Handle process events
    process.on('spawn', () => {
      console.log(`[ViewerManager] Viewer process spawned`);
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

    // Wait for viewer WebSocket and send handoff
    await this.connectAndHandoff(instanceId, wsPort, handoffData, metaverse);
  }

  /**
   * Connect to viewer WebSocket and send handoff data
   */
  private async connectAndHandoff(
    instanceId: string,
    wsPort: number,
    handoffData: any,
    metaverse: MetaverseConnection
  ): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[ViewerManager] WebSocket connect attempt ${attempt}/${maxAttempts}`);

        const connection = connectionManager.connect(instanceId, wsPort);

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
          }, 5000);

          connection.once('connected', () => {
            clearTimeout(timeout);
            resolve();
          });

          connection.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });

          connection.connect();
        });

        // Connection successful, send handoff
        console.log(`[ViewerManager] Connected to viewer WebSocket, sending handoff...`);

        connection.send('PKLoginHandoff', {
          op: 'session_handoff',
          ...handoffData,
        });

        console.log(`[ViewerManager] Handoff sent successfully`);

        // Complete handoff - viewer takes over (stops bot's UDP without logout)
        metaverse.completeHandoff();
        this.updateStatus(instanceId, 'connected');

        // Subscribe to chat events
        connection.subscribeToChat('all');

        return;

      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(`Failed to connect to viewer after ${maxAttempts} attempts`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Legacy launch method - directly launches viewer without metaverse pre-login
   * Kept for backward compatibility
   */
  async launchViewerDirect(accountId: string, password?: string): Promise<ViewerInstance> {
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
      connectionState: 'disconnected',
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

  async stopViewer(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return false;
    }

    console.log(`[ViewerManager] Stopping viewer ${instanceId}`);

    // Show disconnecting state in UI
    this.updateConnectionState(instanceId, 'disconnecting');

    const process = this.processes.get(instanceId);
    if (process) {
      // Try graceful shutdown first
      process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (this.processes.has(instanceId)) {
          process.kill('SIGKILL');
        }
      }, 5000);
    } else {
      await this.cleanup(instanceId);
    }

    return true;
  }

  private updateStatus(instanceId: string, status: ViewerStatus): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.status = status;
      this.emit('status-update', instance);
    }
  }

  private updateConnectionState(instanceId: string, state: ConnectionState): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.connectionState = state;
      this.emit('status-update', instance);
    }
  }

  private updateRegionName(instanceId: string, regionName: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.regionName = regionName;
      this.emit('status-update', instance);
    }
  }

  private async cleanup(instanceId: string): Promise<void> {
    connectionManager.disconnect(instanceId);
    await metaverseConnectionManager.remove(instanceId);

    // Emit final disconnected state before removing
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.connectionState = 'disconnected';
      instance.status = 'disconnected';
      this.emit('status-update', instance);
    }

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

  async stopAll(): Promise<void> {
    connectionManager.disconnectAll();
    await metaverseConnectionManager.removeAll();
    for (const [instanceId] of this.instances) {
      this.stopViewer(instanceId);
    }
  }

  /**
   * Get the MetaverseConnection for an instance
   */
  getMetaverseConnection(instanceId: string): MetaverseConnection | undefined {
    return metaverseConnectionManager.get(instanceId);
  }
}

export const viewerManager = new ViewerManager();
