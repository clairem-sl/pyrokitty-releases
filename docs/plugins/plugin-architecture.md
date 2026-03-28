# PyroKitty Plugin System Architecture

## Goal

A language-agnostic plugin/mod system where plugins like RLVa can be dropped in without modifying the core viewer. The system should:

1. Allow third-party plugins to hook into viewer subsystems (chat, movement, camera, inventory, etc.)
2. Be programming-language agnostic -- plugins can be written in Rust, Python, Go, C, whatever
3. Be easy and fun for third-party developers to engage with and test
4. Support hot-reload during development
5. Provide a permission model so users know what a plugin can do
6. Be generic enough that RLV is just one customer, not the whole design
7. Cross-platform support is the plugin maintainer's responsibility (our RLV plugin targets Windows + Linux)

---

## Architectural Decision: Sidecar Processes, Not BrowserWindows

PyroKitty already has multiple process types with different runtimes:

| Component | Runtime | Transport | Why This Runtime |
|-----------|---------|-----------|-----------------|
| Voice sidecar | .NET (C#) | JSON on stdin/stdout | Needs SIPSorcery + SDL3 for native WebRTC audio |
| Sound player | BrowserWindow (Chromium) | Electron IPC | Needs HTMLAudioElement for cross-platform OGG decoding |
| SL-MCP tools | Node.js child process | JSON IPC via fork() | Needs node-metaverse for its own bot instance |
| Godot viewer | Godot (GDScript) | WebSocket | Needs native 3D rendering |

These are **viewer infrastructure** -- core components that use whatever runtime best solves their specific technical problem. They are not plugins.

**Plugins are different.** They are third-party extensible, language agnostic, and must be easy to develop. Two runtime options were considered:

### BrowserWindow (Rejected)

Running plugins in hidden BrowserWindows would give cross-platform for free (Chromium runs everywhere) but:
- **Kills language agnosticism.** Plugins must be JavaScript/TypeScript, or compile to WASM.
- **WASM is confusing for third-party developers.** Complex toolchains, awkward string passing, harder debugging.
- **Overkill.** Plugins don't need a browser -- they need to read events and send actions.

### Sidecar Process (Chosen)

Plugins run as **separate processes** communicating over **JSON lines on stdin/stdout**:
- **Truly language agnostic.** Any language that reads/writes JSON on stdio works. Rust, Python, Go, Node.js, even bash.
- **Easy to develop.** It's a normal program. Use your normal IDE, debugger, profiler.
- **Process isolation.** A crashing plugin doesn't crash the viewer.
- **Proven pattern.** Voice sidecar already uses JSON-over-stdio successfully.
- **Hot reload.** Kill process, restart. Restriction engine state survives in the viewer.

A TypeScript developer who wants to write a plugin doesn't need a BrowserWindow -- they write a Node.js script that reads/writes JSON lines. Same simplicity, same cross-platform, no special runtime.

### Summary

```
Viewer Infrastructure (use whatever runtime fits):
  ├─ Voice        → .NET sidecar (native audio)
  ├─ Sound        → BrowserWindow (browser audio APIs)
  ├─ Godot        → Godot process (3D rendering)
  └─ Renderer     → Electron renderer (React UI)

Plugins (always sidecar processes, language agnostic):
  ├─ RLVa         → Rust binary
  ├─ MCP tools    → Node.js script (migrated from current sl-mcp/)
  ├─ Translator   → Python script
  ├─ Discord      → Go binary
  └─ Your plugin  → whatever you want
```

---

## Existing Features That Fit This Architecture

### SL-MCP Tools -- Already Almost a Plugin

The MCP tools (`sl-mcp/`) are practically a plugin already. They run as a separate sidecar process, communicate via JSON IPC, and provide 36 tools across 6 categories. The action categories map nearly 1:1 to the plugin API:

| Current MCP Tool | Plugin API Equivalent |
|---|---|
| `sl_say`, `sl_send_im`, `sl_get_recent_chat` | `chat.send`, `chat.send_im`, `chat.received` events |
| `sl_walk_to`, `sl_fly`, `sl_sit`, `sl_stand` | `movement.*` actions |
| `sl_teleport` | `teleport.force` action |
| `sl_find_objects`, `sl_touch_object`, `sl_rez_prim` | `object.*` actions |
| `sl_get_nearby_avatars`, `sl_get_friends` | `avatar.*` queries |
| `sl_get_balance`, `sl_get_region_info` | `connection.*` events |

**Key difference today:** MCP currently runs its **own bot instance** (its own login to SL) rather than sharing the viewer's connection. Migrating it to the plugin system means it would use the viewer's connection through the event/action API, eliminating the second login.

**Migration path:** MCP becomes a plugin that:
1. Subscribes to viewer events (chat, avatars, region changes)
2. Calls viewer actions (send chat, teleport, object operations)
3. Exposes the same MCP tool interface to external callers (Claude, etc.)
4. No longer needs its own bot -- uses the viewer's connection

This migration is the **proof point** for the plugin system. If MCP works as a plugin, the system is validated for any third-party plugin.

### Voice Sidecar -- Validates the Pattern

The voice sidecar (`electron-ui/voice/`) already uses the exact architecture we're proposing for plugins:
- JSON lines on stdin/stdout
- Lifecycle management (connect, disconnect, shutdown)
- Real-time event streaming (position updates, participant changes)
- The `VoiceManager` class handles spawning, restarting, and message routing

Voice stays as viewer infrastructure (not a plugin) because it needs native audio APIs, but it **proves the sidecar pattern works** and gives us a reference implementation for the Plugin Manager.

### Chat Log Manager -- Potential Future Plugin

The chat log manager (`electron-ui/src/main/ui/chat-log-manager.ts`) subscribes to chat events and persists them to disk. It's a natural event-subscriber shape: receive `chat.received` events, write to files. Could be extracted to a plugin, but the value is marginal -- it's small and tightly integrated. Noted as a future possibility.

---

## Architecture: Sidecar Process + Event/Action API + Built-in Services

```
┌──────────────────────────────────────────────────────────┐
│ PyroKitty Viewer (Electron Main)                          │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Plugin Host                                          │ │
│  │                                                      │ │
│  │  ┌────────────┐  JSON lines   ┌──────────────────┐ │ │
│  │  │ Plugin     │◄────────────►│ RLVa (Rust)       │ │ │
│  │  │ Manager    │  stdin/stdout  │                  │ │ │
│  │  │            │◄────────────►│ MCP (Node.js)     │ │ │
│  │  │ - spawn    │  stdin/stdout  │                  │ │ │
│  │  │ - restart  │◄────────────►│ Your Plugin (any) │ │ │
│  │  │ - hot reload│              │                  │ │ │
│  │  └─────┬──────┘               └──────────────────┘ │ │
│  │        │                                            │ │
│  │  ┌─────┴──────────────────────────────────────────┐ │ │
│  │  │ Built-in Services                               │ │ │
│  │  │  ├─ Event Bus      subscribe to viewer events   │ │ │
│  │  │  ├─ Action Router  send chat, TP, sit, etc.     │ │ │
│  │  │  ├─ Restrictions   set/clear/query (optional)   │ │ │
│  │  │  ├─ Storage        key-value per plugin         │ │ │
│  │  │  └─ UI Bridge      notifications, status bar    │ │ │
│  │  └────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  Viewer Infrastructure (not plugins):                     │
│  MetaverseConnection  GodotBridge  VoiceManager  SoundPlayer │
└──────────────────────────────────────────────────────────┘
```

The Plugin Host provides built-in services that plugins can optionally use:

| Service | Purpose | Used By |
|---------|---------|---------|
| **Event Bus** | Subscribe to viewer events (chat, movement, avatars, etc.) | All plugins |
| **Action Router** | Send chat, teleport, sit, touch objects, etc. | All plugins |
| **Restriction Engine** | Set/clear/query behavioural restrictions | RLV, parental controls, game modes |
| **Storage** | Per-plugin key-value persistence | RLV (#RLV cache), translator (prefs) |
| **UI Bridge** | Show notifications, set status indicators | All plugins |

A simple plugin (translator) uses only Event Bus + Action Router. A complex plugin (RLV) uses all five.

---

## The Protocol

JSON lines on stdin/stdout. One JSON object per line, newline-delimited. Follows JSON-RPC 2.0 conventions.

### Lifecycle

```
Viewer spawns plugin process
  │
  ▼
Viewer → Plugin:  {"method":"init","params":{"viewer_version":"0.1.43","avatar_uuid":"...","avatar_name":"..."}}
Plugin → Viewer:  {"method":"ready","params":{"id":"rlva","version":"1.0.0"}}
  │
  ▼
Viewer sends subscribed events, plugin sends actions
  │
  ▼  (on shutdown or hot-reload)
Viewer → Plugin:  {"method":"shutdown"}
Plugin: exits cleanly (or gets SIGTERM after timeout)
```

### Events (Viewer -> Plugin)

Events are fire-and-forget. The viewer sends them based on the plugin's manifest subscriptions.

```jsonc
// Chat received (nearby, IM, group, owner_say, etc.)
{"method":"chat.received","params":{
  "id": "msg-uuid",
  "from": "avatar-or-object-uuid",
  "from_name": "Object Name",
  "message": "@fly=n",
  "type": "owner_say",        // normal, whisper, shout, owner_say, im, group_im
  "channel": 0,
  "source_type": "object",    // agent, object, system
  "region": "Ahern",
  "position": [128, 128, 50]
}}

// Chat about to be sent (plugin can block via action)
{"method":"chat.sending","params":{
  "id": "msg-uuid",
  "message": "hello world",
  "type": "normal",
  "channel": 0
}}

// Avatar attachment changed
{"method":"avatar.attachment_changed","params":{
  "avatar_uuid": "...",
  "point": "chest",
  "action": "attached",       // attached, detached
  "object_uuid": "...",
  "object_name": "My Collar"
}}

// Teleport offer received
{"method":"teleport.offered","params":{
  "from": "avatar-uuid",
  "from_name": "SomeUser",
  "region": "Ahern",
  "position": [128, 128, 50]
}}

// Connection state changed
{"method":"connection.state_changed","params":{
  "state": "metaverse_connected",
  "region": "Ahern"
}}

// Object touched
{"method":"object.touched","params":{
  "object_uuid": "...",
  "object_name": "My Object",
  "position": [128, 128, 50]
}}

// Avatar appeared/left
{"method":"avatar.appeared","params":{"uuid":"...","name":"Foo Bar","position":[128,128,50]}}
{"method":"avatar.left","params":{"uuid":"..."}}

// Region changed
{"method":"region.changed","params":{"name":"Ahern","x":1000,"y":1000}}
```

### Actions (Plugin -> Viewer)

Actions are requests from the plugin. Some are fire-and-forget, some return responses.

```jsonc
// --- Restriction Engine (optional service) ---

// Set/clear a restriction (reference-counted per object_id)
{"method":"restriction.set","params":{
  "object_id": "object-uuid",
  "behaviour": "fly",
  "active": true
}}

// Set a numeric modifier (most restrictive wins)
{"method":"restriction.set_modifier","params":{
  "object_id": "object-uuid",
  "modifier": "cam_fov_min",
  "value": 0.8
}}

// Clear a modifier
{"method":"restriction.clear_modifier","params":{
  "object_id": "object-uuid",
  "modifier": "cam_fov_min"
}}

// Add/remove an exception to a restriction
{"method":"restriction.add_exception","params":{
  "behaviour": "recvim",
  "exception_uuid": "allowed-avatar-uuid"
}}
{"method":"restriction.remove_exception","params":{
  "behaviour": "recvim",
  "exception_uuid": "allowed-avatar-uuid"
}}

// Clear all restrictions from a specific object
{"method":"restriction.clear_object","params":{"object_id":"object-uuid"}}

// Query current restriction state (request/response)
{"method":"restriction.query","params":{"behaviour":"fly"},"id":1}
// Response: {"result":{"restricted":true,"count":2,"sources":["obj-A","obj-B"]},"id":1}

// --- Chat ---

// Send nearby chat
{"method":"chat.send","params":{"message":"hello","type":"normal","channel":0}}

// Send chat reply on a specific channel (for RLV @command=<channel> replies)
{"method":"chat.reply","params":{"channel":1234,"message":"RestrainedLove viewer v3.4.3 (PyroKitty)"}}

// Send IM
{"method":"chat.send_im","params":{"to":"avatar-uuid","message":"hello"}}

// Block an outgoing chat (in response to chat.sending event)
{"method":"chat.block","params":{"id":"msg-uuid","reason":"rlv_sendchat"}}

// --- Movement ---

// Force sit on object
{"method":"movement.force_sit","params":{"object_uuid":"..."}}

// Force stand
{"method":"movement.force_stand"}

// Force teleport
{"method":"teleport.force","params":{"region":"Ahern","x":128,"y":128,"z":50}}

// Accept/decline a teleport offer
{"method":"teleport.accept","params":{"from":"avatar-uuid"}}
{"method":"teleport.decline","params":{"from":"avatar-uuid"}}

// --- Object Interaction ---

// Touch an object
{"method":"object.touch","params":{"object_uuid":"..."}}

// Rez a prim
{"method":"object.rez","params":{"position":[128,128,50]}}

// --- Queries (request/response, need "id" field) ---

// Get worn attachments
{"method":"avatar.get_attachments","id":2}
// Response: {"result":{"attachments":[{"point":"chest","uuid":"...","name":"..."},...]},"id":2}

// Get worn clothing layers
{"method":"avatar.get_outfit","id":3}
// Response: {"result":{"layers":[{"type":"shirt","uuid":"..."},...]},"id":3}

// Get nearby avatars
{"method":"avatar.get_nearby","id":4}
// Response: {"result":{"avatars":[{"uuid":"...","name":"Foo","distance":5.2},...]},"id":4}

// Get shared inventory (#RLV folder)
{"method":"inventory.get_shared","params":{"path":"subfolder/path"},"id":5}
// Response: {"result":{"items":[{"name":"outfit1","type":"folder"},...],"id":5}}

// Get region info
{"method":"region.get_info","id":6}
// Response: {"result":{"name":"Ahern","x":1000,"y":1000,"flags":0},"id":6}

// --- UI (Layer 1: Notifications & Status) ---

// Show a notification to the user
{"method":"ui.notify","params":{"title":"RLVa","text":"@fly restricted by Object Name","level":"info"}}

// Register a status indicator (shown in viewer status bar)
{"method":"ui.set_status","params":{"key":"rlva","text":"RLVa active","icon":"lock"}}

// --- UI (Layer 2: Declarative Panels) ---

// Register a panel (appears as a tab in the viewer)
{"method":"ui.register_panel","params":{
  "id": "rlv-restrictions",
  "title": "RLVa",
  "location": "tab",
  "icon": "lock",
  "content": [
    {"type":"header","text":"Active Restrictions"},
    {"type":"list","id":"restrictions-list","items":[
      {"id":"fly","icon":"plane-off","text":"Flying disabled","secondary":"by Collar (obj-123)"},
      {"id":"chat","icon":"message-off","text":"Chat restricted","secondary":"by Collar (obj-123)"}
    ]},
    {"type":"divider"},
    {"type":"header","text":"Actions"},
    {"type":"button_group","items":[
      {"id":"clear-all","text":"Clear All","style":"danger"},
      {"id":"debug","text":"Debug Log","style":"default"}
    ]}
  ]
}}

// Update panel content dynamically (partial updates, not full re-render)
{"method":"ui.update_panel","params":{
  "panel_id": "rlv-restrictions",
  "updates": [
    {"target":"restrictions-list","action":"append","item":{"id":"tp","icon":"map-off","text":"Teleport locked","secondary":"by Cage (obj-456)"}},
    {"target":"restrictions-list","action":"remove","item_id":"chat"}
  ]
}}

// Viewer -> Plugin: user interacted with a panel element
{"method":"ui.interaction","params":{
  "panel_id":"rlv-restrictions",
  "element_id":"clear-all",
  "action":"clicked"
}}

// --- UI (Layer 3: Custom HTML Panel) ---

// Register a full custom HTML panel (loaded from plugin directory)
{"method":"ui.register_html_panel","params":{
  "id": "custom-radar",
  "title": "Radar",
  "location": "tab",
  "icon": "radar",
  "html": "panel.html",
  "width": 400,
  "height": 600
}}

// Send data to the HTML panel (viewer relays via postMessage)
{"method":"ui.html_send","params":{
  "panel_id": "custom-radar",
  "data": {"avatars":[{"name":"Foo","distance":5.2}]}
}}

// Viewer -> Plugin: HTML panel sent a message back
{"method":"ui.html_message","params":{
  "panel_id": "custom-radar",
  "data": {"action":"teleport_to","avatar":"uuid"}
}}

// --- Storage ---

// Persist a value (survives viewer restart)
{"method":"storage.set","params":{"key":"some_preference","value":"some_value"}}

// Read a value
{"method":"storage.get","params":{"key":"some_preference"},"id":7}
// Response: {"result":{"value":"some_value"},"id":7}

// --- Logging ---

// Write to viewer log
{"method":"log","params":{"level":"info","message":"RLVa: processed @fly=n from object-uuid"}}
```

---

## The Restriction Engine (In Detail)

The restriction engine is a **built-in viewer service** that plugins can optionally use. It mirrors Firestorm's `RlvHandler::m_Behaviours` array -- but generic, not RLV-specific. Any plugin that needs to restrict user actions (RLV, parental controls, game modes, AFK mode) uses this service.

### Data Model

```typescript
class RestrictionEngine {
  // Reference-counted boolean restrictions.
  // Key: behaviour string (e.g., "fly", "sendchat", "shownames")
  // Value: Map of objectId -> true (each source that set this restriction)
  private restrictions: Map<string, Map<string, boolean>>;

  // Numeric modifiers with "most restrictive wins" semantics.
  // Key: modifier string (e.g., "cam_fov_min", "cam_dist_max")
  // Value: Map of objectId -> number
  private modifiers: Map<string, Map<string, number>>;

  // Exceptions: per-behaviour set of UUIDs that bypass the restriction.
  private exceptions: Map<string, Set<string>>;

  // --- Query interface (used by viewer subsystems) ---

  isRestricted(behaviour: string): boolean {
    const sources = this.restrictions.get(behaviour);
    return sources !== undefined && sources.size > 0;
  }

  getModifier(modifier: string, mode: 'min' | 'max'): number | null {
    const values = this.modifiers.get(modifier);
    if (!values || values.size === 0) return null;
    const nums = [...values.values()];
    return mode === 'min' ? Math.min(...nums) : Math.max(...nums);
  }

  hasException(behaviour: string, uuid: string): boolean {
    return this.exceptions.get(behaviour)?.has(uuid) ?? false;
  }

  // --- Mutation interface (called by Plugin Host on behalf of plugins) ---

  setRestriction(pluginId: string, objectId: string, behaviour: string, active: boolean): void;
  setModifier(pluginId: string, objectId: string, modifier: string, value: number): void;
  clearObject(pluginId: string, objectId: string): void;
  clearPlugin(pluginId: string): void;  // on plugin unload/crash
}
```

### How Viewer Subsystems Use It

The engine is checked at natural decision points. These checks are cheap Map lookups -- no IPC, no round-trips to the plugin process.

```typescript
// godot-input-handler.ts -- movement input processing
handleInputMove(data: InputMoveData) {
  let flags = data.flags;
  if (this.restrictions.isRestricted('fly')) {
    flags &= ~AgentControlFlags.FLY;
  }
  if (this.restrictions.isRestricted('jump')) {
    flags &= ~AgentControlFlags.UP_POS;
  }
  this.bot.agent.setControlFlags(flags);
}

// metaverse-connection.ts -- outgoing chat
sendNearbyChat(message: string, type: ChatType, channel: number) {
  if (channel === 0 && this.restrictions.isRestricted('sendchat')) {
    return;  // silently blocked
  }
  // ... send normally
}

// ipc-handlers.ts -- incoming chat display
handleIncomingChat(msg: ChatMessage) {
  if (this.restrictions.isRestricted('shownames') &&
      !this.restrictions.hasException('shownames', msg.fromId)) {
    msg.fromName = 'A resident';  // anonymize
  }
  // ... forward to renderer
}

// godot bridge -- camera update
handleCameraUpdate(pos: Vector3, rot: Quaternion, fov: number) {
  const fovMin = this.restrictions.getModifier('cam_fov_min', 'max');
  const fovMax = this.restrictions.getModifier('cam_fov_max', 'min');
  if (fovMin !== null) fov = Math.max(fov, fovMin);
  if (fovMax !== null) fov = Math.min(fov, fovMax);
}
```

### Godot-Side Enforcement

Some restrictions need enforcement in Godot (camera clamping, avatar hiding, visual effects). The restriction engine pushes state to Godot over the existing WebSocket bridge:

```
Electron: restriction changes
    ↓
{"type":"restriction_update","restrictions":{"fly":true,"showself":true},"modifiers":{"cam_fov_min":0.8}}
    ↓
Godot: camera_controller.gd applies cam limits
Godot: scene_manager.gd hides self-avatar if showself restricted
Godot: (future) shader effects for setsphere/setoverlay
```

Godot caches the restriction state locally and checks it every frame where needed. No per-frame round-trip.

### Why Enforce in the Viewer, Not the Plugin?

If the plugin had to intercept every movement frame:
- 60+ JSON round-trips/sec just for movement
- Race conditions: input sent before plugin responds
- Plugin crash = all restrictions instantly vanish

With the engine in the viewer, the plugin says "fly is restricted" **once**, and the viewer enforces it at native speed forever. If the plugin crashes, restrictions **persist** until explicitly cleared -- which is actually correct RLV behavior (restrictions stay until the object is detached).

### The Engine Is Generic

Behaviour keys are **strings, not enums**. The viewer doesn't need to know all restriction types upfront. Any plugin can set any behaviour string. The viewer only needs to know about behaviours it enforces at specific code points (fly, sendchat, shownames, etc.). Unknown behaviours are stored but have no effect until viewer code checks for them -- which means new enforcement points can be added incrementally.

---

## Plugin UI System (In Detail)

The viewer's React UI uses Mantine v8 with a dark theme, tab-based layout, and split-panel structure. Plugin UI is designed in three layers so developers pick the simplest one that meets their needs.

### Layer 1: Notifications & Status (Simplest)

Already covered in the action protocol. Zero UI code from the plugin.

```jsonc
// Toast notification
{"method":"ui.notify","params":{"title":"RLVa","text":"@fly restricted","level":"info"}}

// Persistent status indicator in the viewer's status bar
{"method":"ui.set_status","params":{"key":"rlva","text":"RLVa active (3 restrictions)","icon":"lock"}}
```

**Good for:** Discord presence status, sync progress, error alerts, simple state indicators.

### Layer 2: Declarative Panels (Recommended)

Plugin describes UI as JSON. The viewer renders it using its own Mantine components, automatically matching the dark theme, accent colors, and layout conventions. Inspired by Slack's Block Kit and Telegram Bot menus.

**The plugin never ships CSS, HTML, or React code.** It sends data; the viewer decides how to render it.

#### Component Types

```jsonc
// Text and structure
{"type": "header", "text": "Active Restrictions"}
{"type": "text", "text": "No restrictions active.", "style": "muted"}  // muted, normal, bold, danger
{"type": "divider"}

// Interactive elements
{"type": "button", "id": "clear-all", "text": "Clear All", "style": "danger"}  // default, primary, danger
{"type": "button_group", "items": [
  {"id": "btn-a", "text": "Option A", "style": "default"},
  {"id": "btn-b", "text": "Option B", "style": "primary"}
]}
{"type": "toggle", "id": "auto-accept", "label": "Auto-accept teleports", "value": false}
{"type": "select", "id": "language", "label": "Language", "options": [
  {"value": "en", "label": "English"},
  {"value": "fr", "label": "French"}
], "value": "en"}
{"type": "text_input", "id": "filter", "placeholder": "Search restrictions...", "value": ""}

// Data display
{"type": "list", "id": "restrictions-list", "items": [
  {"id": "fly", "icon": "plane-off", "text": "Flying disabled", "secondary": "by Collar"},
  {"id": "chat", "icon": "message-off", "text": "Chat restricted", "secondary": "by Cage"}
]}
{"type": "key_value", "items": [
  {"label": "Active restrictions", "value": "3"},
  {"label": "Source objects", "value": "2"},
  {"label": "Exceptions", "value": "1"}
]}

// Layout
{"type": "section", "label": "Advanced", "collapsible": true, "collapsed": true, "content": [
  // ... nested components
]}
{"type": "columns", "widths": [1, 2], "content": [
  [/* left column components */],
  [/* right column components */]
]}
```

#### Panel Registration

```jsonc
{"method": "ui.register_panel", "params": {
  "id": "rlv-restrictions",
  "title": "RLVa",
  "location": "tab",           // "tab" = new tab in ChatWindow, "sidebar" = sidebar widget
  "icon": "lock",              // Mantine/Tabler icon name
  "content": [/* component tree */]
}}
```

#### Dynamic Updates

Plugins update panels incrementally -- no need to re-send the whole tree:

```jsonc
// Append an item to a list
{"method": "ui.update_panel", "params": {
  "panel_id": "rlv-restrictions",
  "updates": [
    {"target": "restrictions-list", "action": "append", "item": {"id": "tp", "text": "Teleport locked"}},
  ]
}}

// Remove an item from a list
{"method": "ui.update_panel", "params": {
  "panel_id": "rlv-restrictions",
  "updates": [
    {"target": "restrictions-list", "action": "remove", "item_id": "chat"}
  ]
}}

// Update a toggle value
{"method": "ui.update_panel", "params": {
  "panel_id": "rlv-restrictions",
  "updates": [
    {"target": "auto-accept", "action": "set_value", "value": true}
  ]
}}

// Replace entire content (for major state changes)
{"method": "ui.update_panel", "params": {
  "panel_id": "rlv-restrictions",
  "updates": [
    {"action": "replace_content", "content": [/* new component tree */]}
  ]
}}
```

#### Interaction Events

When the user interacts with a panel element, the viewer sends an event back to the plugin:

```jsonc
// Button clicked
{"method": "ui.interaction", "params": {"panel_id": "rlv-restrictions", "element_id": "clear-all", "action": "clicked"}}

// Toggle changed
{"method": "ui.interaction", "params": {"panel_id": "rlv-restrictions", "element_id": "auto-accept", "action": "changed", "value": true}}

// Select changed
{"method": "ui.interaction", "params": {"panel_id": "rlv-restrictions", "element_id": "language", "action": "changed", "value": "fr"}}

// Text input submitted
{"method": "ui.interaction", "params": {"panel_id": "rlv-restrictions", "element_id": "filter", "action": "submitted", "value": "fly"}}
```

#### Why Declarative?

- **No React/Mantine knowledge needed.** Plugin developer just describes data and layout.
- **Automatic theming.** Dark mode, accent colors, fonts -- all inherited from the viewer.
- **Consistent UX.** All plugin panels look and feel like native viewer UI.
- **Language agnostic.** It's just JSON. A Rust plugin and a Python plugin produce identical UI.
- **Easy to test.** The test harness can render panel descriptions as text or HTML for visual verification.
- **Safe.** No code injection. The viewer controls what gets rendered.

#### Example: RLV Plugin Panel

```jsonc
{"method": "ui.register_panel", "params": {
  "id": "rlv-panel",
  "title": "RLVa",
  "location": "tab",
  "icon": "lock",
  "content": [
    {"type": "key_value", "items": [
      {"label": "Status", "value": "Active"},
      {"label": "Restrictions", "value": "3"},
      {"label": "Source objects", "value": "2"}
    ]},
    {"type": "divider"},
    {"type": "header", "text": "Restrictions"},
    {"type": "list", "id": "restriction-list", "items": []},
    {"type": "text", "id": "empty-msg", "text": "No active restrictions.", "style": "muted"},
    {"type": "divider"},
    {"type": "section", "label": "Debug", "collapsible": true, "collapsed": true, "content": [
      {"type": "list", "id": "debug-log", "items": []},
      {"type": "button", "id": "clear-debug", "text": "Clear Log", "style": "default"}
    ]}
  ]
}}
```

### Layer 3: Custom HTML Panel (Escape Hatch)

For plugins that need full control over their UI -- complex visualizations, canvas rendering, custom styling -- they can ship HTML/CSS/JS files. The viewer loads them in a **sandboxed iframe** within the tab/panel layout.

```jsonc
{"method": "ui.register_html_panel", "params": {
  "id": "custom-radar",
  "title": "Radar",
  "location": "tab",
  "icon": "radar",
  "html": "panel.html"          // relative to plugin directory
}}
```

#### Communication

The HTML panel communicates with the plugin process through the viewer as a relay:

```
Plugin process  ←─ JSON stdio ─→  Viewer  ←─ postMessage ─→  iframe (HTML panel)
```

**Plugin -> HTML panel:**
```jsonc
// Plugin sends data to its HTML panel
{"method": "ui.html_send", "params": {
  "panel_id": "custom-radar",
  "data": {"avatars": [{"name": "Foo", "distance": 5.2, "bearing": 45}]}
}}
```

**HTML panel -> Plugin** (via postMessage in the iframe):
```javascript
// Inside panel.html
window.parent.postMessage({
  type: 'plugin_message',
  panel_id: 'custom-radar',
  data: { action: 'teleport_to', avatar_uuid: '...' }
}, '*');
```

**Viewer relays to plugin:**
```jsonc
{"method": "ui.html_message", "params": {
  "panel_id": "custom-radar",
  "data": {"action": "teleport_to", "avatar_uuid": "..."}
}}
```

#### Theme CSS Variables

The viewer injects its CSS variables into the iframe so HTML panels can match the theme:

```css
/* Available in the iframe automatically */
:root {
  --pk-bg-primary: #1a1a2e;
  --pk-bg-secondary: #16213e;
  --pk-bg-tertiary: #0f3460;
  --pk-accent: #ff922b;
  --pk-text-primary: #e0e0e0;
  --pk-text-secondary: #888;
  --pk-border: rgba(255,255,255,0.08);
  --pk-font-family: 'Inter', system-ui, sans-serif;
}
```

Plugins that want to match the viewer's look use these variables. Plugins that want their own look ignore them.

#### Security

- iframe is sandboxed: `sandbox="allow-scripts"` (no navigation, no forms, no popups)
- No direct DOM access to the parent viewer
- Communication only through postMessage relay
- The viewer validates messages before forwarding to the plugin process

#### When to Use Layer 3

- Custom canvas rendering (radar with a real map, waveform visualizer)
- Complex interactive layouts that don't map to the declarative components
- Porting an existing web UI into a plugin
- Plugins that want their own branding/styling

Most plugins should use Layer 2. Layer 3 is the escape hatch for embedded panels.

### Layer 4: Standalone BrowserWindow + System Tray

For plugins that want their own **independent window** -- a companion app that runs alongside the viewer. The plugin process requests the viewer to open a BrowserWindow pointing to HTML files the plugin ships. The window has its own system tray icon for persistent access even when minimized.

```jsonc
// Plugin requests a standalone window
{"method": "ui.open_window", "params": {
  "id": "rlv-browser",
  "title": "RLVa Restriction Browser",
  "html": "window.html",         // relative to plugin directory
  "width": 600,
  "height": 800,
  "resizable": true,
  "tray": {                       // optional: system tray icon
    "icon": "tray-icon.png",      // relative to plugin directory (16x16 or 32x32)
    "tooltip": "RLVa - 3 restrictions active",
    "menu": [                     // right-click context menu
      {"id": "show", "label": "Show Window"},
      {"id": "toggle", "label": "Disable RLVa"},
      {"separator": true},
      {"id": "quit", "label": "Quit"}
    ]
  }
}}

// Update tray tooltip/menu dynamically
{"method": "ui.update_tray", "params": {
  "id": "rlv-browser",
  "tooltip": "RLVa - 5 restrictions active",
  "menu": [/* updated menu */]
}}

// Close the window
{"method": "ui.close_window", "params": {"id": "rlv-browser"}}

// Viewer -> Plugin: tray menu item clicked
{"method": "ui.tray_clicked", "params": {"window_id": "rlv-browser", "item_id": "toggle"}}

// Viewer -> Plugin: window closed by user
{"method": "ui.window_closed", "params": {"id": "rlv-browser"}}
```

Communication between the plugin process and its BrowserWindow uses the same postMessage relay as Layer 3:

```
Plugin process  ←─ JSON stdio ─→  Viewer  ←─ postMessage ─→  BrowserWindow
```

**When to use Layer 4:**
- RLV restriction browser (standalone tool window)
- Plugin configuration/settings that are too complex for a tab
- Companion dashboards (analytics, monitoring)
- Any plugin that wants to feel like its own mini-application

**Key difference from Layers 2-3:** The window is independent of the main viewer UI. It can be positioned separately, minimized to tray, and persists across viewer tab changes. The viewer manages the BrowserWindow lifecycle -- if the plugin crashes, the window closes cleanly.

### Godot-Side UI (3D Overlays)

Some plugins may need UI in the 3D viewport (not the React panel). Examples: RLV sphere blur effects, game HUD overlays, distance labels on avatars.

These go through the Godot bridge, not the React renderer:

```jsonc
// Register a 3D overlay text (attached to an avatar or world position)
{"method": "godot.overlay_text", "params": {
  "id": "distance-label-123",
  "text": "5.2m",
  "position": [128, 128, 50],       // world position
  "attach_to": "avatar-uuid",       // optional: follow this avatar
  "color": [1, 0.57, 0.17, 1],     // RGBA
  "size": 14
}}

// Remove a 3D overlay
{"method": "godot.overlay_remove", "params": {"id": "distance-label-123"}}

// Set a fullscreen shader effect (RLV vision sphere, etc.)
{"method": "godot.set_effect", "params": {
  "id": "rlv-sphere",
  "type": "sphere_blur",
  "params": {"radius": 5.0, "blur_strength": 0.8, "tint": [0, 0, 0, 0.5]}
}}

// Remove a shader effect
{"method": "godot.remove_effect", "params": {"id": "rlv-sphere"}}
```

Godot-side overlays are limited to what the viewer implements (text labels, shader effects). This isn't a general-purpose Godot scripting API -- it's a small set of overlay primitives. New overlay types can be added to the viewer as plugin needs emerge.

### Layer Summary

| Layer | Complexity | What Plugin Ships | Theme Match | Use Case |
|-------|-----------|-------------------|-------------|----------|
| **1: Notify/Status** | Trivial | Nothing | Automatic | Alerts, indicators |
| **2: Declarative** | Low | JSON descriptions | Automatic | Panels, settings, lists, buttons |
| **3: Custom HTML** | Medium | HTML/CSS/JS files | Opt-in (CSS vars) | Embedded panel with full control |
| **4: Standalone Window** | Medium | HTML/CSS/JS + icon | Opt-in (CSS vars) | Independent window + tray icon |
| **Godot overlays** | Low | Nothing | N/A (3D viewport) | Distance labels, shader effects |

---

## Plugin Manifest

```json
{
  "id": "rlva",
  "name": "RLVa Support",
  "version": "1.0.0",
  "description": "Restrained Love Viewer alternate protocol support",
  "author": "PyroKitty",
  "homepage": "https://github.com/pyrokitty64/rlva-plugin",

  "entry": {
    "windows": "rlva-plugin.exe",
    "linux": "rlva-plugin"
  },

  "permissions": [
    "chat.receive",
    "chat.send",
    "chat.block",
    "restriction.write",
    "restriction.read",
    "movement.force",
    "teleport.force",
    "inventory.read",
    "inventory.shared_folder",
    "attachment.query",
    "avatar.query",
    "ui.notify",
    "ui.status",
    "ui.panel",
    "ui.html_panel",
    "ui.window",
    "ui.tray",
    "godot.overlay",
    "storage"
  ],

  "subscribes": [
    "chat.received",
    "chat.sending",
    "avatar.attachment_changed",
    "avatar.appeared",
    "avatar.left",
    "connection.state_changed",
    "region.changed",
    "teleport.offered"
  ]
}
```

**Platform entries**: `"entry"` specifies platform-specific executables. Cross-platform is the plugin maintainer's job. A Python plugin can just use `"entry": {"windows": "python translate.py", "linux": "python3 translate.py"}`.

**Permissions**: the viewer shows users what a plugin can do before enabling it. `restriction.write` is the big one -- it means the plugin can restrict your actions.

**Subscribes**: the viewer only sends events the plugin cares about, reducing noise.

---

## Developer Experience

### 1. Dead Simple Protocol

No SDK required. Any language that reads/writes JSON lines on stdio works:

```python
#!/usr/bin/env python3
"""Minimal PyroKitty plugin -- echo all chat to the log."""
import sys, json

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get('method') == 'chat.received':
        name = msg['params']['from_name']
        text = msg['params']['message']
        print(json.dumps({"method": "log", "params": {
            "level": "info",
            "message": f"[echo] {name}: {text}"
        }}), flush=True)
```

```bash
#!/bin/bash
# Even simpler -- bash plugin that logs every event
while IFS= read -r line; do
  method=$(echo "$line" | jq -r '.method // empty')
  echo "{\"method\":\"log\",\"params\":{\"level\":\"debug\",\"message\":\"event: $method\"}}"
done
```

### 2. SDK Crates/Packages (Optional, Ergonomic)

For developers who want convenience, we ship thin SDK wrappers in popular languages. These handle the JSON-RPC boilerplate and provide typed interfaces.

**Rust** (used by our RLV plugin):
```rust
use pyrokitty_plugin_sdk::{Plugin, Context, ChatMessage, ChatType};

#[derive(Default)]
struct MyPlugin;

impl Plugin for MyPlugin {
    fn on_chat_received(&mut self, ctx: &mut Context, msg: &ChatMessage) {
        if msg.chat_type == ChatType::OwnerSay && msg.message.starts_with('@') {
            ctx.log_info(&format!("RLV command: {}", msg.message));
        }
    }

    fn on_chat_sending(&mut self, ctx: &mut Context, msg: &ChatMessage) -> bool {
        if ctx.is_restricted("sendchat") && msg.channel == 0 {
            return false;  // block
        }
        true  // allow
    }
}

fn main() {
    pyrokitty_plugin_sdk::run(MyPlugin::default());
}
```

**Python**:
```python
from pyrokitty_sdk import Plugin, Context

class TranslatorPlugin(Plugin):
    def on_chat_received(self, ctx: Context, msg):
        if msg['type'] == 'normal':
            translated = my_translate(msg['message'])
            ctx.notify(f"[Translated] {msg['from_name']}: {translated}")

if __name__ == '__main__':
    TranslatorPlugin().run()
```

**TypeScript/Node**:
```typescript
import { Plugin, Context, ChatMessage } from '@pyrokitty/plugin-sdk';

class DiscordPresencePlugin extends Plugin {
  onRegionChanged(ctx: Context, region: { name: string }) {
    updateDiscordPresence(`In ${region.name}`);
  }

  onAvatarAppeared(ctx: Context, avatar: { name: string }) {
    ctx.log('info', `${avatar.name} appeared nearby`);
  }
}

new DiscordPresencePlugin().run();
```

### 3. Test Harness

A CLI tool that simulates the viewer. Developers can test without running SL:

```
$ pyrokitty-plugin-test ./my-plugin.exe

PyroKitty Plugin Test Harness v0.1
Plugin loaded: rlva v1.0.0

> event chat.received --from obj-123 --message "@fly=n" --type owner_say
  Plugin → restriction.set {behaviour: "fly", object_id: "obj-123", active: true}

> event chat.received --from obj-123 --message "@sendchat=n" --type owner_say
  Plugin → restriction.set {behaviour: "sendchat", object_id: "obj-123", active: true}

> query restriction fly
  restricted: true (1 source: obj-123)

> event chat.sending --message "hello" --channel 0
  Plugin → chat.block {reason: "rlv_sendchat"}

> event chat.received --from obj-123 --message "@clear" --type owner_say
  Plugin → restriction.clear_object {object_id: "obj-123"}

> query restriction fly
  restricted: false

> event chat.received --from obj-123 --message "@version=1234" --type owner_say
  Plugin → chat.reply {channel: 1234, message: "RestrainedLove viewer v3.4.3 (PyroKitty)"}
```

The test harness can also:
- **Replay recorded sessions** from a real SL login (record events to a file, replay them)
- **Run automated test scripts** (YAML/JSON sequences of events and expected actions)
- **Show restriction engine state** at any point

### 4. Hot Reload

During development, the Plugin Manager watches the plugin binary (or script). When it changes:

1. Send `{"method":"shutdown"}` to the running plugin
2. Wait up to 3 seconds for clean exit
3. Spawn the new version
4. Send `{"method":"init",...}` with current viewer state
5. Restriction engine state **persists** -- it's in the viewer, not the plugin

This means you can `cargo build` your Rust plugin and it picks up the new version without restarting the viewer.

### 5. Plugin Logging

Plugins write to the viewer's log file via the `log` action. Plugin output appears with a prefix:

```
[RLVa Plugin] RLV command from Collar: @fly=n
[RLVa Plugin] Set restriction: fly (source: obj-123)
[Translator Plugin] Translated message from Foo: "Bonjour" -> "Hello"
```

stderr from the plugin process is also captured and logged as warnings.

---

## Plugin Directory Structure

```
~/.pyrokitty-ui/plugins/
  rlva/
    manifest.json             # Required: metadata, permissions, subscriptions
    rlva-plugin.exe           # Windows binary
    rlva-plugin               # Linux binary
  mcp-tools/
    manifest.json
    mcp-bridge.js             # Node.js script (migrated from sl-mcp/)
    package.json
  auto-translate/
    manifest.json
    translate.py              # Python script
    requirements.txt
  discord-presence/
    manifest.json
    index.js                  # Node.js script
    node_modules/
    package.json
```

Plugins are installed by dropping a folder into the plugins directory (or via a future plugin manager UI). The viewer scans this directory at startup and shows available plugins in settings.

---

## Rust RLVa Plugin Skeleton

This is the reference plugin that demonstrates the system. Written in Rust for Windows + Linux.

```rust
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{self, BufRead, Write};

/// Per-object restriction state
struct RlvObject {
    restrictions: Vec<String>,  // active behaviour names
}

/// Global RLV state
#[derive(Default)]
struct RlvState {
    objects: HashMap<String, RlvObject>,
}

/// Parsed RLV command
struct RlvCommand {
    behaviour: String,
    option: Option<String>,
    param: RlvParam,
}

enum RlvParam {
    Add,            // =n
    Remove,         // =y
    Force,          // =force
    Reply(i32),     // =<channel>
    Clear,          // @clear
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut state = RlvState::default();

    for line in stdin.lock().lines().flatten() {
        let msg: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match msg["method"].as_str() {
            Some("init") => {
                send(&mut stdout, &json!({"method": "ready", "params": {
                    "id": "rlva", "version": "1.0.0"
                }}));
            }

            Some("chat.received") => {
                let params = &msg["params"];
                let message = params["message"].as_str().unwrap_or("");
                let from = params["from"].as_str().unwrap_or("");
                let chat_type = params["type"].as_str().unwrap_or("");

                if chat_type == "owner_say" && message.starts_with('@') {
                    for cmd in parse_rlv_commands(message) {
                        handle_command(&mut state, from, cmd, &mut stdout);
                    }
                }
            }

            Some("shutdown") => {
                break;
            }

            _ => {}
        }
    }
}

fn handle_command(state: &mut RlvState, object_id: &str, cmd: RlvCommand, out: &mut io::Stdout) {
    match cmd.param {
        RlvParam::Add => {
            state.objects
                .entry(object_id.to_string())
                .or_insert_with(|| RlvObject { restrictions: vec![] })
                .restrictions.push(cmd.behaviour.clone());

            send(out, &json!({"method": "restriction.set", "params": {
                "object_id": object_id,
                "behaviour": cmd.behaviour,
                "active": true
            }}));
        }

        RlvParam::Remove => {
            if let Some(obj) = state.objects.get_mut(object_id) {
                obj.restrictions.retain(|b| b != &cmd.behaviour);
            }
            send(out, &json!({"method": "restriction.set", "params": {
                "object_id": object_id,
                "behaviour": cmd.behaviour,
                "active": false
            }}));
        }

        RlvParam::Clear => {
            state.objects.remove(object_id);
            send(out, &json!({"method": "restriction.clear_object", "params": {
                "object_id": object_id
            }}));
        }

        RlvParam::Force => {
            match cmd.behaviour.as_str() {
                "tpto" => {
                    if let Some(option) = &cmd.option {
                        let coords: Vec<&str> = option.split('/').collect();
                        if coords.len() == 3 {
                            send(out, &json!({"method": "teleport.force", "params": {
                                "x": coords[0].parse::<f32>().unwrap_or(128.0),
                                "y": coords[1].parse::<f32>().unwrap_or(128.0),
                                "z": coords[2].parse::<f32>().unwrap_or(50.0)
                            }}));
                        }
                    }
                }
                "sit" => {
                    if let Some(uuid) = &cmd.option {
                        send(out, &json!({"method": "movement.force_sit", "params": {
                            "object_uuid": uuid
                        }}));
                    }
                }
                "unsit" => {
                    send(out, &json!({"method": "movement.force_stand"}));
                }
                _ => {
                    send(out, &json!({"method": "log", "params": {
                        "level": "warn",
                        "message": format!("Unhandled force command: @{}=force", cmd.behaviour)
                    }}));
                }
            }
        }

        RlvParam::Reply(channel) => {
            let response = match cmd.behaviour.as_str() {
                "version" => Some("RestrainedLove viewer v3.4.3 (PyroKitty)".to_string()),
                "versionnew" => Some("RestrainedLove viewer v3.4.3 (PyroKitty)".to_string()),
                "versionnum" => Some("3040300".to_string()),
                "getstatus" => {
                    let status = state.objects.get(object_id)
                        .map(|obj| obj.restrictions.join("/"))
                        .unwrap_or_default();
                    Some(status)
                }
                "getstatusall" => {
                    let all: Vec<String> = state.objects.values()
                        .flat_map(|obj| obj.restrictions.iter().cloned())
                        .collect();
                    Some(all.join("/"))
                }
                _ => {
                    send(out, &json!({"method": "log", "params": {
                        "level": "warn",
                        "message": format!("Unhandled reply command: @{}={}", cmd.behaviour, channel)
                    }}));
                    None
                }
            };

            if let Some(msg) = response {
                send(out, &json!({"method": "chat.reply", "params": {
                    "channel": channel,
                    "message": msg
                }}));
            }
        }
    }
}

fn parse_rlv_commands(message: &str) -> Vec<RlvCommand> {
    let message = message.trim_start_matches('@');
    message.split(',').filter_map(|part| {
        let part = part.trim();
        if part == "clear" {
            return Some(RlvCommand {
                behaviour: "clear".to_string(),
                option: None,
                param: RlvParam::Clear,
            });
        }

        let (behaviour_option, param_str) = part.split_once('=')?;
        let (behaviour, option) = if let Some((b, o)) = behaviour_option.split_once(':') {
            (b.to_string(), Some(o.to_string()))
        } else {
            (behaviour_option.to_string(), None)
        };

        let param = match param_str {
            "n" | "add" => RlvParam::Add,
            "y" | "rem" => RlvParam::Remove,
            "force" => RlvParam::Force,
            ch => RlvParam::Reply(ch.parse().ok()?),
        };

        Some(RlvCommand { behaviour, option, param })
    }).collect()
}

fn send(out: &mut io::Stdout, msg: &serde_json::Value) {
    let _ = writeln!(out, "{}", msg);
    let _ = out.flush();
}
```

---

## Implementation Plan

### Step 1: PluginManager Core
**Goal:** Spawn a plugin process, exchange JSON lines, manage lifecycle.

- [ ] `PluginManager` class in `electron-ui/src/main/plugins/plugin-manager.ts`
  - Scan `~/.pyrokitty-ui/plugins/` for `manifest.json` files
  - Parse manifests, validate required fields
  - Spawn child processes with correct platform entry point
  - JSON-line reader/writer on stdin/stdout (reference: `VoiceManager` pattern)
  - Send `init` on spawn, wait for `ready` response
  - Send `shutdown` on teardown, SIGTERM after 3s timeout
  - Capture stderr as log warnings
  - Restart on crash (with backoff)
- [ ] `PluginConnection` class -- per-plugin process handle, message routing, pending request tracking (for request/response with `id` fields)
- [ ] Handle `log` action (plugin -> viewer log with `[Plugin Name]` prefix)
- [ ] Integration point: call `pluginManager.start()` from `index.ts` after login

**Test:** Create a "hello world" plugin (Node.js script that logs every event it receives). Verify spawn, init/ready handshake, log output, clean shutdown.

### Step 2: Event Bus
**Goal:** Route viewer events to subscribed plugins.

- [ ] `PluginEventBus` class -- maintains subscription map from manifest `subscribes` arrays
- [ ] Wire up `chat.received` events from `MetaverseConnection.subscribeToChat()` → event bus → plugins
  - Detect `owner_say` type and include it in the event payload
  - Include source_type (agent vs object), position, region
- [ ] Wire up `connection.state_changed` from connection manager → event bus
- [ ] Wire up `region.changed` from region change handler → event bus
- [ ] Wire up `avatar.appeared` / `avatar.left` from avatar tracking → event bus
- [ ] Only send events that match each plugin's `subscribes` list

**Test:** Hello world plugin logs chat events. Send a message in-world, verify plugin receives it with correct fields.

### Step 3: Action Router
**Goal:** Handle actions from plugins.

- [ ] `PluginActionRouter` class -- dispatches plugin actions to viewer subsystems
- [ ] `chat.send` → `MetaverseConnection.sendNearbyChat()`
- [ ] `chat.reply` → send chat on specified channel (for RLV query responses)
- [ ] `chat.send_im` → send IM to avatar
- [ ] `chat.block` → intercept outgoing chat (need `chat.sending` event + block mechanism)
- [ ] `ui.notify` → forward to renderer as notification
- [ ] `ui.set_status` → forward to renderer as status indicator
- [ ] `log` → write to viewer log
- [ ] Permission checking: verify plugin has permission for each action before executing

**Test:** Plugin that echoes chat -- receives `chat.received`, sends `chat.send` with modified text.

### Step 4: MCP Migration (First Real Plugin)
**Goal:** Migrate `sl-mcp/` to use the plugin system instead of its own bot instance. This validates the entire plugin architecture with a real, complex plugin.

- [ ] Create `~/.pyrokitty-ui/plugins/mcp-tools/` with manifest
- [ ] Refactor MCP wrapper to work as a plugin process:
  - Receives viewer events via stdin (chat, avatars, region)
  - Sends viewer actions via stdout (send chat, teleport, sit, etc.)
  - No longer spawns its own bot -- uses viewer's connection
  - Still exposes MCP tool interface to external callers (Claude)
- [ ] MCP needs a **dual-protocol bridge**: plugin JSON lines on stdin/stdout for viewer communication, plus MCP stdio for external tool callers. Architecture:
  ```
  Claude/external ←─ MCP stdio ─→ MCP bridge process ←─ plugin stdio ─→ Viewer
  ```
  The bridge process handles both protocols. Or simpler: the viewer spawns MCP with two communication channels (plugin protocol on stdio, MCP protocol on a named pipe or socket).
- [ ] Migrate MCP tool implementations one by one:
  - `sl_say` → `chat.send` action
  - `sl_send_im` → `chat.send_im` action
  - `sl_get_recent_chat` → buffer `chat.received` events in plugin
  - `sl_walk_to` → `movement.walk_to` action (new action)
  - `sl_fly` → `movement.fly` action (new action)
  - `sl_sit` / `sl_stand` → `movement.force_sit` / `movement.force_stand`
  - `sl_teleport` → `teleport.force` action
  - `sl_get_nearby_avatars` → `avatar.get_nearby` query
  - `sl_get_friends` → `avatar.get_friends` query (new query)
  - `sl_get_region_info` → `region.get_info` query
  - `sl_touch_object` → `object.touch` action
  - `sl_find_objects` → `object.find` query (new query)
  - `sl_get_balance` → `account.get_balance` query (new query)
  - etc. for remaining tools
- [ ] Each migrated tool validates that the corresponding event/action works correctly
- [ ] **MCP as test tool**: Once migrated, MCP tools can exercise the plugin API from Claude. "Use sl_say to send a chat message" tests `chat.send`. "Use sl_get_nearby_avatars" tests `avatar.get_nearby`. This makes MCP a natural integration test harness for the plugin system.

**Test:** Run the migrated MCP plugin. Use Claude to call MCP tools. Verify they work identically to the old direct-bot implementation.

### Step 5: Hot Reload
**Goal:** Developer experience -- change code, see results immediately.

- [ ] File watcher on plugin directories (binary/script change → restart)
- [ ] Graceful shutdown → respawn → re-init with current viewer state
- [ ] Plugins are enabled by being present in `~/.pyrokitty-ui/plugins/` with a valid manifest
- [ ] Plugins are disabled by removing the folder (or adding `"enabled": false` to manifest)

**Test:** Edit hello world plugin while viewer is running, verify it restarts and picks up changes.

### Step 6: Restriction Engine
**Goal:** Built-in service for plugins that restrict user actions.

- [ ] `RestrictionEngine` class in `electron-ui/src/main/plugins/restriction-engine.ts`
  - Reference-counted restrictions (Map<string, Map<string, boolean>>)
  - Numeric modifiers with most-restrictive-wins semantics
  - Exceptions (per-behaviour UUID sets)
  - `clearPlugin()` on plugin crash/unload
- [ ] Wire `restriction.set`, `restriction.set_modifier`, `restriction.clear_object`, `restriction.query` actions in the action router
- [ ] Add restriction checks at key enforcement points:
  - `godot-input-handler.ts`: fly, jump, sit, unsit, alwaysrun
  - `metaverse-connection.ts`: sendchat, chatwhisper/normal/shout, sendim
  - `ipc-handlers.ts`: shownames (anonymize), showloc (hide location), recvchat filtering
- [ ] Push restriction state to Godot via `restriction_update` message on WebSocket bridge
- [ ] Godot-side: `restriction_manager.gd` caches state, `camera_controller.gd` reads camera modifiers

**Test:** Use MCP tools (Claude) to send an `@fly=n` owner_say message. Verify the skeleton RLV plugin sets the restriction and the viewer blocks fly input.

### Step 7: RLV Plugin -- Core (Rust)
**Goal:** Working RLV plugin that handles basic restrictions.

- [ ] Rust project: `plugins/rlva/` with Cargo.toml
- [ ] Cross-compile targets: `x86_64-pc-windows-msvc` + `x86_64-unknown-linux-gnu`
- [ ] Command parser: `@behaviour[:option]=param` syntax, comma-separated
- [ ] State manager: per-object restriction tracking, reference counting
- [ ] Handle `@version`, `@versionnum`, `@versionnew` replies
- [ ] Handle `@getstatus`, `@getstatusall` replies
- [ ] Restriction commands: fly, jump, sit, unsit, sendchat, recvchat, emote, tplm, tploc, shownames, showloc, alwaysrun
- [ ] Force commands: tpto, sit, unsit
- [ ] `@clear` -- clear all restrictions from sending object

**Test:** Use MCP to send RLV commands via llOwnerSay simulation. Verify restrictions take effect. Use MCP to attempt blocked actions and verify they're blocked.

### Step 8: Plugin UI -- Layers 1-2
**Goal:** Plugins can show notifications and declarative panels.

- [ ] Renderer: `PluginPanelRenderer` component that interprets JSON component descriptions
  - Support component types: header, text, divider, button, button_group, toggle, select, text_input, list, key_value, section, columns
  - Style using existing Mantine components + viewer CSS variables
- [ ] Renderer: Plugin tab integration in ChatWindow (dynamic tabs from plugin registrations)
- [ ] `ui.register_panel` / `ui.update_panel` action handling in Plugin Host
- [ ] `ui.interaction` events from renderer → main → plugin process
- [ ] IPC channel: `plugin:panel-update` (main → renderer), `plugin:interaction` (renderer → main)

**Test:** RLV plugin registers a restrictions panel. Add/remove restrictions and verify panel updates dynamically.

### Step 9: RLV Plugin -- Queries & Force Commands
**Goal:** RLV plugin handles inventory queries and forced actions.

- [ ] `avatar.get_attachments` query implementation in action router
- [ ] `avatar.get_outfit` query implementation
- [ ] `inventory.get_shared` query implementation (#RLV folder)
- [ ] RLV plugin handles: getattach, getoutfit, getinv, getinvworn, findfolder, getpath, getsitid, getgroup
- [ ] RLV plugin handles force: detachme, setgroup, attachthis/detachthis
- [ ] Attachment/wearable lock system in restriction engine
- [ ] `chat.sending` event with block mechanism for sendchat/sendim restrictions

**Test:** Use MCP to send RLV query commands. Verify correct responses on the specified channel.

### Step 10: Plugin UI -- Layers 3-4
**Goal:** Custom HTML panels and standalone windows with tray icons.

- [ ] Layer 3: Sandboxed iframe panel in ChatWindow tab area
  - Load plugin HTML files
  - Inject CSS variables for theme matching
  - postMessage relay between iframe and plugin process
- [ ] Layer 4: Standalone BrowserWindow
  - `ui.open_window` action creates a new BrowserWindow
  - Load plugin HTML files
  - System tray icon with context menu
  - `ui.update_tray` for dynamic tooltip/menu updates
  - `ui.tray_clicked` / `ui.window_closed` events back to plugin
  - Window cleanup on plugin shutdown/crash

**Test:** Create an example plugin with a standalone window and tray icon. Verify window lifecycle, tray interaction, and communication.

### Step 11: RLV Plugin -- Camera & Visual Effects
**Goal:** Camera restrictions and RLVa visual effects.

- [ ] Camera modifiers in restriction engine: fov_min, fov_max, dist_min, dist_max, eye_offset, focus_offset
- [ ] Godot-side camera clamping in `camera_controller.gd`
- [ ] `@setcam_mouselook` restriction
- [ ] Godot shader for `@setsphere` (distance-based blur/color blend)
- [ ] Godot shader for `@setoverlay` (screen overlay texture with alpha/tint)
- [ ] `@setoverlay_tween` (animated transitions)
- [ ] RLV environment control: `@setenv` / `@getenv`

**Test:** MCP sends camera restriction commands. Verify Godot enforces FOV/distance limits. Test visual effects visually.

### Step 12: Developer Tools
**Goal:** Make third-party plugin development easy and fun.

- [ ] Test harness CLI (`pyrokitty-plugin-test`)
  - Spawns plugin, simulates viewer protocol
  - Interactive mode: type events, see actions
  - Script mode: YAML/JSON event sequences with expected action assertions
  - Display restriction engine state
- [ ] Event recording: viewer can record all events to a file during a live session
- [ ] Event replay: test harness replays recorded events to a plugin
- [ ] SDK crate: `pyrokitty-plugin-sdk` (Rust) -- typed event/action structs, Plugin trait, run loop
- [ ] SDK package: `pyrokitty_sdk` (Python) -- Plugin base class, typed helpers
- [ ] SDK package: `@pyrokitty/plugin-sdk` (TypeScript/Node) -- Plugin class, typed interfaces
- [ ] Plugin developer documentation: getting started guide, API reference, example plugins
- [ ] Plugin manager UI in viewer settings:
  - List installed plugins with name, version, status (running/stopped/error)
  - Enable/disable toggle per plugin
  - Permission approval dialog on first enable
  - View plugin log output
  - "Open plugin folder" button

### Step 13: Godot-Side Overlays
**Goal:** Plugins can add text labels and shader effects in the 3D viewport.

- [ ] `godot.overlay_text` action → Godot renders floating text at world position or attached to avatar
- [ ] `godot.overlay_remove` action
- [ ] `godot.set_effect` / `godot.remove_effect` for fullscreen shader effects
- [ ] Rate limiting: cap on simultaneous overlays to prevent frame rate impact
- [ ] Cleanup on plugin shutdown/crash

---

## Open Questions

1. **Multi-plugin conflicts** -- If two plugins restrict `fly`, reference counting means both must release it. For force commands, first-to-send wins (or priority ordering in manifest). For modifiers, most restrictive wins. Need to define this clearly.

2. **Security model** -- The manifest declares permissions. On first enable, the viewer shows "This plugin wants to: read your chat, restrict your movement, control teleportation. Allow?" User must approve. Should permissions be revocable per-session?

3. **Firestorm mode** -- When running with the Firestorm renderer via session handoff, Firestorm's built-in RLVa handles everything. Our plugin system only applies in Godot-renderer mode. Need to disable plugin RLV detection when Firestorm is active.

4. **Event filtering granularity** -- Should plugins filter events more precisely in the manifest? E.g., `"chat.received:owner_say"` instead of all chat. Reduces noise for focused plugins like RLV.

5. **Plugin dependencies** -- Should plugins be able to depend on other plugins? E.g., a "RLV HUD" plugin that depends on the RLV plugin. Probably not in v1 -- keep it simple.

6. **MCP bridge architecture** -- When MCP is migrated to a plugin, it still needs to expose MCP tools to external callers (Claude, etc.). The plugin would need a secondary communication channel (MCP stdio) in addition to the viewer plugin protocol. Could solve with a wrapper process that bridges both protocols.

7. **Declarative UI component set** -- The Layer 2 component types listed here are a starting point. Need to discover what's missing as plugins are built. Easy to add new component types without breaking existing plugins.

8. **Godot overlay limits** -- How many overlay texts / shader effects should be allowed simultaneously? Need to prevent a buggy plugin from tanking frame rate. Probably a configurable cap with sensible defaults.
