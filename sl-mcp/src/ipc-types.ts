/**
 * IPC message types for wrapper <-> backend communication.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema object
}

// Messages from wrapper to backend
export type WrapperMessage =
  | { type: 'list-tools' }
  | { type: 'call'; reqId: string; tool: string; args: Record<string, unknown> };

// Messages from backend to wrapper
export type BackendMessage =
  | { type: 'ready' }
  | { type: 'tools'; tools: ToolDefinition[] }
  | { type: 'result'; reqId: string; content: Array<{ type: string; text: string }>; isError?: boolean };
