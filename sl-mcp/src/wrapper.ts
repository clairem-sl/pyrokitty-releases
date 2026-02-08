/**
 * Thin MCP wrapper — STDIO server that Claude Code spawns.
 * Forks backend.ts as a child process and proxies tool calls via IPC.
 * Built-in `reload` tool kills and respawns the backend.
 *
 * Uses the low-level Server class so tools/list always returns the
 * current backend tool set — no static registration needed.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import type { WrapperMessage, BackendMessage, ToolDefinition } from './ipc-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SL_MCP_ROOT = join(__dirname, '..');
const BACKEND_PATH = join(__dirname, 'backend.ts');
const TSX_IMPORT = pathToFileURL(join(SL_MCP_ROOT, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href;

// Current backend tool list — updated on spawn/reload
let backendTools: ToolDefinition[] = [];

let child: ChildProcess | null = null;
let reqCounter = 0;
const pendingCalls = new Map<string, {
  resolve: (value: { content: Array<{ type: string; text: string }>; isError?: boolean }) => void;
}>();

function sendToChild(msg: WrapperMessage): void {
  if (child?.connected) {
    child.send(msg);
  }
}

function spawnBackend(): Promise<ToolDefinition[]> {
  return new Promise((resolve, reject) => {
    if (child) {
      child.removeAllListeners();
      child.kill('SIGTERM');
      child = null;
    }

    child = fork(BACKEND_PATH, [], {
      execArgv: ['--import', TSX_IMPORT],
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      cwd: SL_MCP_ROOT,
    });

    let resolved = false;

    child.stdout?.on('data', (data: Buffer) => {
      process.stderr.write(`[backend] ${data}`);
    });

    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(`[backend] ${data}`);
    });

    child.on('message', (msg: BackendMessage) => {
      if (msg.type === 'ready') {
        sendToChild({ type: 'list-tools' });
      } else if (msg.type === 'tools') {
        backendTools = msg.tools;
        resolved = true;
        resolve(msg.tools);
      } else if (msg.type === 'result') {
        const pending = pendingCalls.get(msg.reqId);
        if (pending) {
          pendingCalls.delete(msg.reqId);
          pending.resolve({ content: msg.content, isError: msg.isError });
        }
      }
    });

    child.on('error', (err) => {
      console.error(`[wrapper] Backend process error: ${err.message}`);
      if (!resolved) reject(err);
    });

    child.on('exit', (code) => {
      console.error(`[wrapper] Backend exited with code ${code}`);
      child = null;
      for (const [reqId, pending] of pendingCalls) {
        pending.resolve({
          content: [{ type: 'text', text: `Backend process exited (code ${code})` }],
          isError: true,
        });
        pendingCalls.delete(reqId);
      }
      if (!resolved) reject(new Error(`Backend exited with code ${code}`));
    });

    setTimeout(() => {
      if (!resolved) reject(new Error('Backend startup timed out'));
    }, 15000);
  });
}

function callBackendTool(toolName: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const reqId = `req_${++reqCounter}`;
  return new Promise((resolve) => {
    pendingCalls.set(reqId, { resolve });
    sendToChild({ type: 'call', reqId, tool: toolName, args });

    setTimeout(() => {
      if (pendingCalls.has(reqId)) {
        pendingCalls.delete(reqId);
        resolve({
          content: [{ type: 'text', text: 'Tool call timed out (60s)' }],
          isError: true,
        });
      }
    }, 60000);
  });
}

// Reload tool definition (always present)
const reloadTool: ToolDefinition = {
  name: 'reload',
  description: 'Kill and respawn the SL backend process to pick up code changes. Bot connection will drop — call sl_login again after.',
  inputSchema: { type: 'object', properties: {} },
};

const server = new Server(
  { name: 'second-life', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
);

// Dynamic tools/list — always returns current backend tools + reload
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      reloadTool,
      ...backendTools,
    ].map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
});

// Dynamic tools/call — dispatches to reload or backend
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === 'reload') {
    try {
      const tools = await spawnBackend();
      server.sendToolListChanged();
      return {
        content: [{ type: 'text', text: `Backend reloaded. ${tools.length} tools available. Call sl_login to reconnect.` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Reload failed: ${err.message}` }],
        isError: true,
      };
    }
  }

  // Proxy to backend
  const result = await callBackendTool(name, args as Record<string, unknown>);
  return result;
});

async function main() {
  try {
    const tools = await spawnBackend();
    console.error(`[wrapper] Backend ready with ${tools.length} tools`);
  } catch (err: any) {
    console.error(`[wrapper] Initial backend spawn failed: ${err.message}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[wrapper] MCP server running on stdio');
}

main().catch((err) => {
  console.error(`[wrapper] Fatal: ${err.message}`);
  process.exit(1);
});
