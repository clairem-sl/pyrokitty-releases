# PyroKitty - Project Plan

## Overview

PyroKitty is a modified Firestorm viewer for Second Life paired with an Electron companion app. The Electron app (with node-metaverse) handles login, friends/groups/chat UI, and inventory sync. The viewer handles 3D rendering with custom features like per-axis object mirroring and various performance optimizations.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│              Electron App (node-metaverse + React UI)           │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Login/Chat   │  │ Inventory    │  │ Viewer Manager       │  │
│  │ (bot)        │  │ Sync         │  │ (spawn/track/relay)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                            │                                   │
│                     WebSocket Client                           │
└────────────────────────────┼───────────────────────────────────┘
                             │ ws://localhost:9001
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                   Firestorm Viewer (C++)                        │
│                                                                │
│  PKWebSocketServer ← ChatAPI, InventoryAPI, LoginHandoff       │
│  PKMirrorFlags     ← Per-axis object mirroring                 │
│  Performance mods  ← FSR, occlusion, impostors, teleport fix  │
│  Privacy mods      ← No MAC/hardware IDs, no version tracking │
└────────────────────────────────────────────────────────────────┘
```

### Login Flow

```
Electron/node-metaverse logs in → shows friends/groups/chat UI
  → user clicks "Launch Viewer"
  → Firestorm launches with --login CLI params
  → SL auto-disconnects node-metaverse
  → WebSocket connects for bidirectional chat relay
  → native chat UI hidden (setChatVisible(false))
  → user closes Firestorm
  → node-metaverse re-logs in automatically
```

---

## Feature Status

### Complete

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **Per-Axis Mirroring** | Drag-past-zero flips objects on X/Y/Z. Notecard persistence, lazy-load on relog, silhouette support. 9 bugs documented in `OBJECT_FLIP.md` | `pkmirrorflags.h/.cpp`, `llface.cpp`, `llvovolume.h/.cpp`, `llmanipscale.cpp`, `llpanelobject.h/.cpp` |
| **Inventory Sync** | Bidirectional SL texture ↔ local PNG sync with J2C conversion, subfolder support, manifest tracking | `inventory-sync-manager.ts`, `j2k-converter.ts`, `viewer-inventory-adapter.ts` |
| **Viewer Inventory API** | 8 ops over WebSocket: getRootFolder, getFolderContents, createFolder, downloadAsset, uploadAsset, deleteItem, updateItem, getUploadCost | `pkinventoryeventapi.cpp` |
| **Chat Relay** | Bidirectional chat bridge between Electron and Firestorm via WebSocket. Snake→camelCase transform, session management, unread counts | `ipc-handlers.ts`, `viewer-connection.ts`, `pkchateventapi.cpp` |
| **Display Name Cache** | LRU cache with disk persistence for UUID → display name. 24h staleness, debounced saves | `display-name-cache.ts` |
| **External Login Handoff** | Session handoff from node-metaverse to viewer via WebSocket. Benefits, inventory, appearance all working. Archived in favor of simpler CLI login approach | `pkloginhandoff.h/.cpp`, `llstartup.cpp` |
| **LEAP Plugin Support** | Re-enabled LEAP protocol for external app communication | `llappviewer.cpp`, `pkchateventapi.cpp` |
| **WebSocket Server** | C++ WebSocket server in viewer for external communication | `pkwebsocketserver.h/.cpp` |
| **Teleport Fix** | Clear mesh/texture queues on teleport to prevent progressive slowdown | `llmeshrepository.cpp`, `llviewertexturelist.cpp`, `llagent.cpp` |
| **Privacy** | Removed MAC addresses, hardware IDs, version tracking from login | `lluuid.cpp`, `llmachineid.cpp`, `llversioninfo.cpp`, `lllogininstance.cpp` |
| **FSR Upscaling** | Auto-enabled when resolution < 100%. EASU + RCAS two-pass | `pipeline.cpp`, `fsrRCASF.glsl`, `postDeferredNoDoFF.glsl` |
| **Occlusion Optimization** | Skip re-querying recently confirmed occluded groups for 30 frames | `llvieweroctree.cpp` |
| **Impostor Optimization** | Reduced resolution, update intervals, and sensitivity thresholds | `pipeline.cpp`, `llvoavatar.cpp` |
| **Permission Bypass** | God mode, export always allowed, texture UUIDs visible, all permissions pass | `llagent.cpp`, `llpermissions.cpp`, `fsexportperms.cpp` |
| **Build System** | SKIP_NSIS, SKIP_SYMBOLS, --jobs support, /MP8 parallel compilation | `viewer_manifest.py`, `configure_firestorm.sh`, `00-Common.cmake` |
| **Separate Data Dir** | APP_NAME = "PyroKitty" for isolated settings/cache directory | `indra_constants.h` |

### Not Yet Committed (Staged/Working)

| Change | Status | Files |
|--------|--------|-------|
| Display name cache integration | Staged | `display-name-cache.ts` (new) |
| GridCommands updates | Staged | `GridCommands.ts` |
| IPC handler updates | Staged + unstaged | `ipc-handlers.ts` |
| Chat panel improvements | Unstaged | `ChatPanel.tsx` |
| Shared types updates | Staged | `types.ts` |
| Metaverse connection updates | Staged | `metaverse-connection.ts` |

### Pending (from buncho-changes branch)

| Feature | Description |
|---------|-------------|
| GPU Texture Cache | DXT5 compressed texture cache with stb_dxt, LRU eviction, background write thread |
| Auto-Tune Resolution | Adjust RenderResolutionMultiplier when GPU-bound |
| Shadow Optimization | Skip objects with < N vertices in shadow passes |
| J2C Error Handling | Improved OpenJPEG decoder error handling |
| Misc Fixes | Mesh null checks, avatar partition, XUI fixes, nav bar, About Land, Chinese notifications |

---

## Electron App Structure

```
electron-ui/
├── src/
│   ├── main/
│   │   ├── index.ts                    # Main process entry
│   │   ├── viewer-manager.ts           # Viewer lifecycle, re-login logic
│   │   ├── viewer-connection.ts        # WebSocket to Firestorm (reqid matching)
│   │   ├── viewer-inventory-adapter.ts # Duck-types to node-metaverse inventory
│   │   ├── inventory-sync-manager.ts   # Bidirectional SL ↔ local sync
│   │   ├── j2k-converter.ts           # J2C ↔ PNG via OpenJPEG CLI
│   │   ├── display-name-cache.ts      # UUID → display name LRU cache
│   │   ├── ipc-handlers.ts            # Routes chat based on connection state
│   │   ├── metaverse-connection.ts    # Bot login/reconnection
│   │   ├── grid-manager.ts            # Grid configuration
│   │   └── account-manager.ts         # Credential storage
│   ├── renderer/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx           # Message display, input, context menu
│   │   │   ├── GridSelector.tsx
│   │   │   ├── AccountList.tsx
│   │   │   └── ...
│   │   └── hooks/
│   │       └── useChat.ts             # Chat state, sessions, unread counts
│   └── shared/
│       └── types.ts                   # Shared TypeScript types
├── node-metaverse/                    # Forked @caspertech/node-metaverse
│   └── lib/
│       ├── Bot.ts                     # shutdownForHandoff(), teleportHandoffMode
│       └── classes/
│           ├── Circuit.ts             # getLocalPort(), getSequenceNumber()
│           ├── LoginResponse.ts       # Benefits parsing
│           └── commands/
│               ├── TeleportCommands.ts # Handoff mode support
│               └── GridCommands.ts     # Grid-specific commands
└── data/
    ├── inventory-sync/<accountId>/    # Synced textures as PNG
    └── display-names/<accountId>.json # Cached display names
```

## Viewer C++ Files (PyroKitty additions)

| File | Purpose |
|------|---------|
| `pkchateventapi.h/.cpp` | Chat Event API for LEAP/WebSocket |
| `pkinventoryeventapi.h/.cpp` | Inventory API for LEAP/WebSocket (8 ops) |
| `pkloginhandoff.h/.cpp` | External login session handoff API |
| `pkwebsocketserver.h/.cpp` | WebSocket server for external communication |
| `pkmirrorflags.h/.cpp` | Per-axis mirror flag cache + notecard persistence |

All changes tagged with `<FS:Pyrokitty>` comments. Search: `grep -r "FS:Pyrokitty" indra/`

---

## Build Commands

```bash
# Viewer (configure + build)
SKIP_NSIS=1 SKIP_SYMBOLS=1 autobuild configure -A 64 -c ReleaseFS_open -- \
  --chan PyroKitty --avx2 --jobs 1 --fmodstudio --package -DLL_TESTS:BOOL=FALSE

SKIP_NSIS=1 SKIP_SYMBOLS=1 autobuild build -A 64 -c ReleaseFS_open --no-configure -- \
  --chan PyroKitty --avx2 --jobs 1 --fmodstudio --package -DLL_TESTS:BOOL=FALSE

# Electron renderer
cd electron-ui && npm run build:renderer

# Electron main process
cd electron-ui && npm run build:main

# node-metaverse
cd electron-ui/node-metaverse && npm run build
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| `CLAUDE.md` | Build commands, runtime paths, dev setup |
| `PLAN.md` | This file - project overview and status |
| `COMMITS.md` | Cherry-pick plan for buncho-changes branch |
| `OBJECT_FLIP.md` | Per-axis mirroring implementation + 9 bug fixes |
| `docs/PYROKITTY-CHANGES.md` | All viewer C++ modifications documented |
| `electron-ui/INVENTORY_SYNC.md` | Inventory sync design |
| `electron-ui/LOGIN_PLAN.md` | Login handoff design and testing |
| `docs/architecture/` | Viewer subsystem documentation |
| `docs/plugin-system/` | LEAP plugin architecture + test scripts |
