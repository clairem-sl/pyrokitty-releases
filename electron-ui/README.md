# PyroKitty Electron UI

Multi-account Second Life/OpenSim viewer manager. Launch and manage multiple viewer instances from a single interface.

## Features

- **Grid Management**: Automatically loads grids from the viewer's `grids.xml`, supports adding custom OpenSim grids
- **Account Management**: Securely store multiple accounts per grid with encrypted credentials
- **Viewer Process Management**: Launch viewers with full UI or headless mode, track running instances
- **Multi-Instance Support**: Run multiple viewers simultaneously with separate WebSocket ports

## Setup

```bash
cd electron-ui
npm install
```

## Development

```bash
# Build and run
npm start

# Or for development with auto-rebuild
npm run dev
```

## Building

```bash
# Create distributable
npm run dist
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron App (Primary UI)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Grid Manager│  │Account List │  │  Viewer Manager     │  │
│  │ (grids.json)│  │(accounts.json)│ │ (spawn/track)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │ Process spawn
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Viewer #1     │   │ Viewer #2     │   │ Viewer #3     │
│ (Account A)   │   │ (Account B)   │   │ (Account C)   │
└───────────────┘   └───────────────┘   └───────────────┘
```

## Project Structure

```
electron-ui/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # Entry point, window creation
│   │   ├── grid-manager.ts   # Grid configuration loading
│   │   ├── account-manager.ts# Encrypted credential storage
│   │   ├── viewer-manager.ts # Process spawning and tracking
│   │   └── ipc-handlers.ts   # IPC communication setup
│   ├── renderer/             # React UI
│   │   ├── App.tsx           # Main React component
│   │   ├── components/       # UI components
│   │   └── styles/           # CSS styles
│   └── shared/
│       └── types.ts          # Shared TypeScript types
└── data/
    └── grids.json            # Custom grid configurations
```

## Future Phases

### Phase 2: WebSocket Integration
- Add WebSocket server to viewer (C++ changes)
- Bidirectional communication between Electron and viewers
- Real-time status updates

### Phase 3: Chat Integration
- Integrate PKChatEventAPI via WebSocket
- Multi-account chat view in Electron
- Cross-account messaging
