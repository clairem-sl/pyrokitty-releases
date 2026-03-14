# PyroKitty

An experimental Second Life / OpenSim viewer that replaces the traditional monolithic C++ viewer architecture with a multi-process stack: **Electron** for account management and UI, **Godot** for 3D rendering, and a heavily modified **Firestorm** as an alternative renderer. Also includes an MCP server so AI coding agents can log in and interact with the virtual world directly.

## I just want to run it

Grab a release, unzip with something like [7-Zip](https://www.7-zip.org/download.html), and run.  Currently only have a Windows build available.  Linux build coming soon!

## I want to build it

There's no one-click build yet. The project has several independent pieces that each need to be built. See `electron-ui/scripts/package.sh` for how the release packaging works, or read on for the individual components.

### Prerequisites

- Node.js 18+
- [Godot 4.7-dev2 Mono](https://godotengine.org/) (version pinned in `godot-viewer/godot-version.txt`)
- .NET 8 SDK (for the voice sidecar)

### Electron UI

```bash
cd electron-ui
npm install
npm run build
npm start           # builds and launches
```

Set `AUTO_LOGIN=1` to skip the login screen during development.

### Godot Viewer

Open `godot-viewer/` in Godot. The engine version must match `godot-viewer/godot-version.txt`.

Place the Godot executable inside `godot-viewer/` in a subdirectory matching the version name. For example:

```
godot-viewer/
  Godot_v4.7-dev2_mono_win64/
    Godot_v4.7-dev2_mono_win64.exe
    Godot_v4.7-dev2_mono_win64_console.exe
    GodotSharp/
```

Run headless tests:

```bash
cd godot-viewer
GODOT=$(cat godot-version.txt | tr -d '[:space:]')
./$GODOT/${GODOT}_console.exe --headless --quit-after 5 --scene tests/test_prim_mesh.tscn
```

### Voice Sidecar

```bash
cd electron-ui/voice
dotnet build
```

WebRTC voice chat using SIPSorcery + Concentus Opus. See `docs/architecture/voice-system.md`.

### SL-MCP Server

```bash
cd sl-mcp
npm run build
```

No separate launch needed — Claude Code starts it automatically via `.mcp.json`.

## What is in here

| Directory | What it does |
|-----------|-------------|
| `electron-ui/` | Electron app — account management, login, UI shell, and the client-side protocol backend (node-metaverse). The brains of the operation. |
| `godot-viewer/` | Godot 4.7 project — 3D rendering, avatar animation, prim meshing. Communicates with Electron over a local bridge. |
| `firestorm/` | Heavily modified Firestorm viewer. Runs in "external login" mode, handing off its session to the Electron/Godot stack. Very experimental. |
| `sl-mcp/` | MCP server that gives AI agents (like Claude) direct control of a Second Life bot — chat, navigation, object manipulation, and more. |
| `docs/` | Architecture docs, rendering notes, and research. |
| `icons/` | App icons. |

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐      WebSocket       ┌──────────────┐
│  Firestorm  │ <────────────────> │  Electron UI │ <──────────────────> │ Godot Viewer │
│  (C++ core) │                    │  (node-meta- │    (textures,        │  (3D render) │
│             │                    │    verse)    │     meshes, anims)   │              │
└─────────────┘                    └──────┬───────┘                      └──────────────┘
                                          │
                                    ┌─────┴──────┐
                                    │ Voice Side-│
                                    │ car (.NET) │
                                    └────────────┘
```

Electron handles the SL protocol via **node-metaverse** (a TypeScript SL client library, bundled with heavy modification). It decodes textures, builds mesh data, manages animations, and streams everything to Godot for rendering. Firestorm is optional — it can hand off an authenticated session so you get the benefit of its mature UDP protocol stack.

## SL-MCP: AI Bot Control

The `sl-mcp/` server exposes 36 tools across session management, chat, navigation, social, object manipulation, and even a minesweeper solver. Configure it in `.mcp.json` and any MCP-compatible agent can walk around, chat, rez prims, and interact with the world.

## License

See [LICENSE](LICENSE). (It's chill.)

