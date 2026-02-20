# SL-MCP: Second Life MCP Server

MCP server that gives Claude Code direct control of a Second Life bot via node-metaverse. Provides 36 tools across 6 categories: session, chat, navigation, social, objects, and minesweeper.

## Building & Running

```bash
cd sl-mcp
npm run build     # TypeScript → dist/
npm run start     # Run via tsx (used by .mcp.json)
```

The root `.mcp.json` configures Claude Code to launch this server:

```json
{ "command": "cmd", "args": ["/c", "npx", "tsx", "sl-mcp/src/wrapper.ts"] }
```

On Windows, `cmd /c` wrapper is required for `npx` in `.mcp.json`.

After code changes, use the `reload` tool (kills and respawns backend) — no need to restart Claude Code.

Credentials are shared with electron-ui, ./electron-ui/data/accounts.json

## Architecture

**Wrapper + Backend** model via `child_process.fork()` + IPC:

```
Claude Code ↔ STDIO ↔ wrapper.ts (parent)
                          ↕ IPC (fork)
                       backend.ts (child) → BotManager → node-metaverse → SL
```

- **wrapper.ts** — STDIO MCP entry point. Uses low-level `Server` class (not `McpServer`) for dynamic tool registration. Spawns/kills backend, proxies tool calls via reqId pairing. Has built-in `reload` tool.
- **backend.ts** — Child process. Creates `BotManager`, builds tool map, handles `call`/`list-tools` IPC messages.
- **bot-manager.ts** — Core bot class (~850 lines, 25+ methods). Manages login/logout, event subscriptions, chat ring buffers, avatar tracking, object manipulation.
- **ipc-types.ts** — Shared message types (`WrapperMessage`, `BackendMessage`, `ToolDefinition`).

### Why low-level `Server` instead of `McpServer`?

`McpServer.registerTool()` is static — `tools/list` won't reflect new tools after a reload. The low-level `Server` with `setRequestHandler()` returns the current backend tool list dynamically.

## File Structure

```
src/
├── wrapper.ts           # STDIO server, forks backend, reload tool
├── backend.ts           # Child process, IPC handler, creates BotManager
├── bot-manager.ts       # Bot lifecycle & all SL operations
├── ipc-types.ts         # WrapperMessage / BackendMessage types
└── tools/
    ├── index.ts         # Exports allTools[] (36 tools)
    ├── session.ts       # sl_login, sl_logout, sl_status
    ├── chat.ts          # sl_say, sl_send_im, sl_send_group_message, sl_get_recent_ims, sl_get_recent_chat
    ├── navigation.ts    # sl_teleport, sl_walk_to, sl_fly, sl_sit, sl_stand, sl_sit_on_ground, sl_get_nearby_avatars, sl_get_region_info
    ├── social.ts        # sl_get_friends, sl_get_groups, sl_avatar_name_to_key, sl_avatar_key_to_name, sl_get_balance
    ├── objects.ts       # sl_rez_prim, sl_set_object_name/description/position/scale, sl_find_objects, sl_get_object_children/textures/inventory, sl_touch_object, sl_delete_object
    └── minesweeper.ts   # sl_minesweeper_read_board, sl_minesweeper_analyze, sl_minesweeper_walk_to_cell, sl_minesweeper_walk_path
```

## Tool Interface

Each tool file exports an array of `ToolDef`:

```typescript
export interface ToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>; // JSON Schema
    handler: (
        args: any,
        bot: BotManager,
    ) => Promise<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
    }>;
}
```

## Key Implementation Details

### UUID Map Gotcha

node-metaverse APIs return `Map<UUID, ...>` where keys are UUID _objects_, not strings. `Map.get(stringId)` will never match. Always rebuild as string-keyed:

```typescript
const lookup = new Map<string, V>();
for (const [key, val] of uuidKeyedMap) {
    lookup.set(key.toString(), val);
}
```

### Chat Ring Buffers

- Recent IMs: max 50, stored in `recentIMs[]`
- Recent nearby chat: max 100, stored in `recentChat[]`
- Own messages and typing indicators are filtered out

### Walk Implementation

`walkTo()` uses avatar control flags with polling every 250ms. Features stuck detection (auto-enables flight after 4s), deceleration zone within 2m, overshoot detection, and 30s timeout.

### Object Search Retry

`findObjectsByName()` retries with 2s delay if no results found (region may still be loading objects after login).

### Minesweeper Board Decoding

The board is a 16x16 grid encoded as UV texture offsets on child prims. Each of 32 child prims has 8 faces representing 8 columns. The `sl_minesweeper_analyze` tool runs constraint propagation to deduce safe cells and mines.

## Timeouts

- Backend startup: 15 seconds
- Tool call execution: 60 seconds
- Walk to target: 30 seconds (default)

## Dependencies

| Package                     | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `@modelcontextprotocol/sdk` | MCP protocol server implementation                |
| `node-metaverse`            | Second Life client library (peer dep from parent) |
| `zod`                       | Schema validation                                 |
| `tsx`                       | TypeScript execution without pre-compilation      |
