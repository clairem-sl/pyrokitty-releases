# MCP Tools: Current Implementation & Plugin Migration Plan

## Overview

The SL-MCP tools (`sl-mcp/`) provide 36 tools for interacting with Second Life from external callers (Claude, etc.). It currently runs as a standalone sidecar with its own bot instance. It is the first planned plugin migration -- validating the plugin system and becoming the integration test harness for subsequent plugins.

## Current Architecture

```
Claude Code (or other MCP client)
    ↓ spawns
wrapper.ts (parent process, STDIO MCP server)
    ↓ child_process.fork()
backend.ts (child process, tool dispatcher)
    ↓ creates
BotManager (~1100 lines, manages node-metaverse Bot)
    ↓
node-metaverse Bot (Second Life UDP/HTTP client)
    ↓
SL Servers
```

**Key design choice:** wrapper.ts uses the low-level MCP `Server` class instead of `McpServer` because `registerTool()` is static -- once registered, `tools/list` won't reflect new tools. The low-level `setRequestHandler()` returns dynamic tool lists on each call, enabling the `reload` tool to respawn the backend and expose new tools without restarting Claude Code.

### IPC Protocol (wrapper <-> backend)

```
wrapper.ts                          backend.ts

                → 'ready'           (backend spawned and initialized)
        → 'list-tools'
                ← 'tools' [...]     (ToolDefinition array)
        → 'call' { reqId, tool, args }
                ← 'result' { reqId, content, isError }
```

- **Request ID pairing**: each tool call gets a unique `reqId`. wrapper.ts stores resolve functions in a `pendingCalls` Map. Result with matching reqId resolves the promise.
- **Timeouts**: 120s per tool call, 15s for backend startup.

### Bot Lifecycle

**Login process:**
1. Create Bot with LoginParameters
2. `bot.login()` (authenticate with login server)
3. Set camera far distance to 1024m
4. Subscribe to all events (`setupEventSubscriptions()`)
5. Cache friends from login response
6. `bot.connectToSim()` (connect to region)
7. Request 360-degree interest list + 1.5 Mbps bandwidth
8. Wait for agent position in agent list (10s timeout)
9. Update camera to agent position
10. Start camera update interval (5s) to keep sim streaming objects

**Auto-login**: `ensureConnected()` loads credentials from `electron-ui/data/accounts.json` (first account). Concurrent login calls wait on the same promise.

### State Management

```
friends:        Map<string, { id, name, online }>          // from login + onFriendOnline events
groups:         Map<string, { id, name }>                  // from onAgentGroupDataUpdate
nearbyAvatars:  Map<string, { id, name, displayName?, position }>  // from onAvatarEnteredRegion + onMoved
recentChat:     NearbyChatMessage[]  (ring buffer, max 100)        // from onNearbyChat
recentIMs:      IncomingIM[]         (ring buffer, max 50)         // from onInstantMessage
```

**UUID key gotcha**: node-metaverse Maps frequently use UUID *objects* as keys despite TypeScript signatures claiming `string`. BotManager always converts to strings with `.toString()`.

---

## Complete Tool Inventory (36 tools)

### Session (3)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `sl_login` | `firstName?`, `lastName?`, `password?`, `grid?` | Login to SL. Auto-login with defaults if no args. |
| `sl_logout` | | Disconnect from SL. |
| `sl_status` | | Get state, avatar name/UUID, region, position. |

### Chat (5)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `sl_say` | `message`, `type?` (whisper/normal/shout), `channel?` | Send nearby chat. |
| `sl_send_im` | `target_id`, `message` | Send IM to avatar by UUID. |
| `sl_send_group_message` | `group_id`, `message` | Send message to group chat. |
| `sl_get_recent_ims` | | Last 50 incoming IMs from ring buffer. |
| `sl_get_recent_chat` | | Last 100 nearby chat messages from ring buffer. |

### Navigation (8)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `sl_teleport` | `region`, `x?`, `y?`, `z?` | Teleport to region + coordinates. |
| `sl_walk_to` | `x`, `y`, `z?`, `avatar_name?`, `stop_distance?`, `timeout?` | Physical walk/fly to position or avatar. Stuck detection, auto-flight. |
| `sl_fly` | `enable` | Toggle flight mode. |
| `sl_sit` | `local_id` | Sit on object by local ID. |
| `sl_stand` | | Stand up. |
| `sl_sit_on_ground` | | Sit on ground. |
| `sl_get_nearby_avatars` | | List avatars with positions. Resolves display names via GetDisplayNames cap. |
| `sl_get_region_info` | | Region name, grid coords, agent position. |

### Social (6)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `sl_get_friends` | | List friends with online status. |
| `sl_get_groups` | | List groups bot is member of. |
| `sl_avatar_name_to_key` | `name` | Resolve "First Last" or "first.last" to UUID. |
| `sl_avatar_key_to_name` | `key` | Resolve UUID to legacy name. |
| `sl_get_avatar_state` | `local_id` | Sitting/standing state, what they're sitting on. |
| `sl_get_balance` | | Get L$ balance. |

### Objects (13)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `sl_rez_prim` | `count?`, `offset_x?`, `offset_y?`, `offset_z?` | Rez prims near bot. Returns local IDs and UUIDs. |
| `sl_set_object_name` | `local_id`, `name` | Rename object. |
| `sl_set_object_description` | `local_id`, `description` | Set object description. |
| `sl_set_object_position` | `local_id`, `x`, `y`, `z` | Move object. |
| `sl_set_object_scale` | `local_id`, `x`, `y`, `z` | Resize object. |
| `sl_find_objects` | `name_pattern`, `timeout?` | Find objects by glob pattern. Auto-retries with 10s default timeout. |
| `sl_get_object_by_uuid` | `uuid` | Full object lookup: mesh, sculpt, light, extended data. |
| `sl_get_object_children` | `local_id` | Child prims of linkset: localId, name, position. |
| `sl_get_object_textures` | `local_id` | Texture info per face: UUID, offset, repeat, rotation, glow. |
| `sl_get_object_inventory` | `local_id` | Task inventory items with type and description. |
| `sl_touch_object` | `local_id` | Touch (click) object to trigger scripts. |
| `sl_delete_object` | `local_id` | Delete object (derez to trash). Must be owner. |

### Minesweeper (4)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `sl_minesweeper_read_board` | `root_local_id` | Decode 16x16 board from texture UV offsets. Returns grid. |
| `sl_minesweeper_analyze` | `board_state` | Constraint propagation solver. Deduces mines/safe cells. Suggests walk path. |
| `sl_minesweeper_walk_to_cell` | `root_local_id`, `row`, `col` | Walk to cell. Converts grid coords to world coords. |
| `sl_minesweeper_walk_path` | `root_local_id`, `cells` | Walk sequence of cells. Re-reads board after. |

Plus **`reload`** (built into wrapper.ts) -- kills and respawns the backend process.

---

## Plugin Migration Plan

### What Changes

**Before (current):**
```
Claude ←─ MCP stdio ─→ wrapper.ts ─→ backend.ts ─→ BotManager ─→ node-metaverse Bot ─→ SL
                                                                                         ↑
PyroKitty Viewer ─→ MetaverseConnection ─→ node-metaverse Bot ──────────────────────────┘
                    (separate bot instance)
```
Two separate bots logged in. MCP has its own connection, viewer has its own.

**After (plugin):**
```
Claude ←─ MCP stdio ─→ MCP plugin process ←─ plugin stdio ─→ PyroKitty Viewer ─→ SL
                        (bridges both protocols)              (single connection)
```
One connection. MCP uses the viewer's connection through the plugin event/action API.

### Dual-Protocol Bridge

The MCP plugin process speaks two protocols simultaneously:
- **MCP protocol** on a secondary channel (for Claude / external callers)
- **Plugin protocol** on stdin/stdout (for the viewer)

Architecture options for the secondary MCP channel:

**Option A: Named pipe / Unix socket**
```
Viewer spawns MCP plugin with stdin/stdout (plugin protocol)
MCP plugin also listens on a named pipe (MCP protocol)
Claude connects to the named pipe
```

**Option B: Viewer manages both channels**
```
Viewer spawns MCP plugin with stdin/stdout (plugin protocol)
Viewer also exposes an MCP endpoint (socket) that relays to the plugin
Claude connects to the viewer's MCP endpoint
```

**Option C: Wrapper process (simplest)**
```
Claude ←─ MCP stdio ─→ wrapper process ←─ plugin stdio ─→ Viewer
                        (thin bridge,
                         translates MCP calls
                         to plugin actions)
```
The wrapper process is launched by Claude (same as today). It connects to the viewer's running MCP plugin and translates MCP tool calls into plugin protocol actions. The actual MCP plugin runs inside the viewer's plugin host.

Option C preserves the current user experience (Claude spawns MCP, gets tools) while the backend logic moves into the plugin system.

### Tool Migration Map

Each MCP tool maps to one or more plugin API actions/events:

| MCP Tool | Plugin API | Notes |
|----------|-----------|-------|
| `sl_login` | N/A | Plugin uses viewer's existing connection. Login handled by viewer. |
| `sl_logout` | N/A | Same -- viewer manages connection lifecycle. |
| `sl_status` | `connection.get_status` query | New query: returns state, avatar, region, position. |
| `sl_say` | `chat.send` action | Direct mapping. |
| `sl_send_im` | `chat.send_im` action | Direct mapping. |
| `sl_send_group_message` | `chat.send_group_im` action | New action. |
| `sl_get_recent_ims` | Buffer `chat.received` events in plugin | Plugin maintains its own ring buffer from events. |
| `sl_get_recent_chat` | Buffer `chat.received` events in plugin | Same -- plugin buffers events it receives. |
| `sl_teleport` | `teleport.force` action | Direct mapping. |
| `sl_walk_to` | `movement.walk_to` action | New action. Walk logic moves to viewer. |
| `sl_fly` | `movement.fly` action | New action. |
| `sl_sit` | `movement.force_sit` action | Direct mapping. |
| `sl_stand` | `movement.force_stand` action | Direct mapping. |
| `sl_sit_on_ground` | `movement.sit_ground` action | New action. |
| `sl_get_nearby_avatars` | `avatar.get_nearby` query | Direct mapping. Display name resolution stays in viewer. |
| `sl_get_region_info` | `region.get_info` query | Direct mapping. |
| `sl_get_friends` | `avatar.get_friends` query | New query. |
| `sl_get_groups` | `avatar.get_groups` query | New query. |
| `sl_avatar_name_to_key` | `avatar.name_to_key` query | New query. |
| `sl_avatar_key_to_name` | `avatar.key_to_name` query | New query. |
| `sl_get_avatar_state` | `avatar.get_state` query | New query. |
| `sl_get_balance` | `account.get_balance` query | New query. |
| `sl_rez_prim` | `object.rez` action | New action. |
| `sl_set_object_name` | `object.set_name` action | New action. |
| `sl_set_object_description` | `object.set_description` action | New action. |
| `sl_set_object_position` | `object.set_position` action | New action. |
| `sl_set_object_scale` | `object.set_scale` action | New action. |
| `sl_find_objects` | `object.find` query | New query. Glob matching + retry logic. |
| `sl_get_object_by_uuid` | `object.get_by_uuid` query | New query. |
| `sl_get_object_children` | `object.get_children` query | New query. |
| `sl_get_object_textures` | `object.get_textures` query | New query. |
| `sl_get_object_inventory` | `object.get_inventory` query | New query. |
| `sl_touch_object` | `object.touch` action | Direct mapping. |
| `sl_delete_object` | `object.delete` action | New action. |
| `sl_minesweeper_*` | Stays in plugin | Game-specific logic. Uses object queries + walk actions. |

### New Plugin API Endpoints Needed

The MCP migration reveals plugin API actions/queries that need to be implemented but aren't yet in the protocol spec:

**Actions (plugin -> viewer):**
- `movement.walk_to` -- walk to position with stuck detection, auto-flight
- `movement.fly` -- toggle flight
- `movement.sit_ground` -- sit on ground
- `chat.send_group_im` -- send group chat
- `object.rez` -- rez prim(s)
- `object.set_name` / `object.set_description` / `object.set_position` / `object.set_scale`
- `object.delete` -- derez to trash

**Queries (plugin -> viewer, request/response):**
- `connection.get_status` -- state, avatar, region, position
- `avatar.get_friends` -- friend list with online status
- `avatar.get_groups` -- group list
- `avatar.name_to_key` / `avatar.key_to_name` -- name resolution
- `avatar.get_state` -- sitting/standing
- `account.get_balance` -- L$ balance
- `object.find` -- glob search with retry/timeout
- `object.get_by_uuid` -- full object lookup
- `object.get_children` -- linkset children
- `object.get_textures` -- face texture info
- `object.get_inventory` -- task inventory

These endpoints benefit all future plugins, not just MCP.

### What Stays in the Plugin

Some logic doesn't need to move to the viewer -- it stays in the MCP plugin process:

- **Ring buffers** for recent chat/IMs (plugin buffers events it receives)
- **Minesweeper** game logic (board decoding, constraint solver, path planning)
- **MCP protocol handling** (tool definitions, parameter validation, response formatting)
- **Tool-level error handling** and user-friendly error messages

### Migration Order

Migrate tools in dependency order, testing each group before moving on:

1. **Session**: `sl_status` (read-only, simplest test)
2. **Chat**: `sl_say`, `sl_send_im`, `sl_get_recent_chat`, `sl_get_recent_ims`
3. **Navigation**: `sl_teleport`, `sl_walk_to`, `sl_fly`, `sl_sit`, `sl_stand`, `sl_get_region_info`
4. **Social**: `sl_get_nearby_avatars`, `sl_get_friends`, `sl_get_groups`, `sl_avatar_name_to_key`, `sl_avatar_key_to_name`, `sl_get_avatar_state`, `sl_get_balance`
5. **Objects**: all 13 object tools
6. **Minesweeper**: stays mostly unchanged, uses migrated object + walk tools
7. **Remove old bot**: delete `sl_login`, `sl_logout`, BotManager, direct node-metaverse dependency

### Known Challenges

1. **Walk implementation** is complex (~100 lines with stuck detection, auto-flight, overshoot prevention, camera tracking). Needs to move into the viewer's action router or become a high-level action that the viewer implements natively.

2. **Object find** retries with polling. The viewer's action router needs to support this or the plugin keeps the retry loop and calls `object.find` repeatedly.

3. **Camera updates** -- MCP's bot updates camera every 5s to keep the sim streaming objects. The viewer already does this, so this concern goes away with the migration.

4. **Display name resolution** -- MCP calls GetDisplayNames cap directly. The viewer already has `DisplayNameCache`. Plugin uses `avatar.get_nearby` which returns resolved names.

5. **Minesweeper texture reading** -- needs `object.get_textures` to return UV offset data with sufficient precision. Floating-point rounding is important (current code rounds to 3 decimal places).

6. **Dual-protocol bridge** -- the MCP plugin needs to serve MCP tools to external callers while receiving viewer events. This is the most architecturally novel part of the migration.
