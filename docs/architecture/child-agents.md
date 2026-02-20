# Child Agent System

Lightweight UDP connections to neighboring SL regions for real-time avatar position tracking. With cascading enabled and `cameraFar=1024`, coverage reaches ~7x7 regions (~41 concurrent connections). Beyond that, use map queries.

## Practical Summary

**Child agents give us real-time avatar positions in neighboring regions (~7x7 grid).** The main sim announces immediate neighbors (3x3), then cascading through child event queues extends coverage outward. The server hardcaps the interest bubble at ~3 regions (~768m) per hop, with a hard wall at 7 regions (1792m) in any direction.

For the world map, the approach is:
- **Nearby regions (~7x7):** Child agents provide CoarseLocationUpdate with per-avatar positions every few seconds. These show as green map dots automatically.
- **Beyond ~7x7:** Query the map server (MapItemRequest/MapItemReply) for avatar locations. No real-time updates, but enough for map population indicators.

## Architecture

### Classes

- **`ChildAgentConnection`** (`node-metaverse/lib/classes/ChildAgentConnection.ts`) — Single child circuit. Handles UDP connect, CoarseLocationUpdate for avatar positions, optional caps + event queue for cascading.
- **`ChildAgentManager`** (`node-metaverse/lib/classes/ChildAgentManager.ts`) — Manages all child connections for one bot. Creates/destroys children in response to EnableSimulator/DisableSimulator events. Subscribes to EstablishAgentCommunication for caps activation.
- **Integration in `Bot.ts`** — Creates ChildAgentManager after connectToSim(), subscribes to onEnableSimulator, tears down on disconnect/region change.

### Why Not Reuse Region Class

Region allocates ~70KB of terrain/parcel arrays, creates ObjectStore + Comms (which would cause duplicate chat/IM events). ChildAgentConnection is a focused ~320-line class that only does what's needed: UDP circuit, ping keepalive, CoarseLocationUpdate, and optional caps.

## Protocol

Based on Firestorm source (`llworld.cpp`):

1. **UseCircuitCode** — Reuses main login's circuitCode. NO CompleteAgentMovement (that's main agent only).
2. **RegionHandshake** → **RegionHandshakeReply** — Extracts region name, confirms connection.
3. **CoarseLocationUpdate** — Sim sends every few seconds with avatar positions (X, Y, Z*4).
4. **DisableSimulator** — Server tears down the connection when region leaves interest bubble.
5. **Ping keepalive** — 15s interval (lighter than main's 5s), 60s timeout.

## Event Flow

### EnableSimulator (region discovery)
- Source: Event Queue (HTTP caps), NOT UDP
- Main sim sends EnableSimulator for immediate 3x3 neighbors
- Decoded from base64: `Buffer.from(simInfo.Handle.toArray())` → Long, `new IPAddress(Buffer.from(simInfo.IP.toArray()), 0).toString()`
- Grid coords: `gridX = handle.high / 256`, `gridY = handle.low / 256`
- Emitted via `clientEvents.onEnableSimulator`

### EstablishAgentCommunication (caps for children)
- Separate event queue message providing seed capability URL for each child region
- Matched to child connections by `sim-ip-and-port` field
- Activates caps + event queue on the child connection
- Child's event queue uses shared `clientEvents`, so EnableSimulator events from children cascade automatically

### Cascading
- Main sim only sends EnableSimulator for immediate neighbors (3x3)
- With caps + event queue on each child, children receive EnableSimulator for THEIR neighbors
- This cascades outward: 3x3 → 5x5 → 7x7 → etc.
- Each hop takes ~2-5 seconds (connect + handshake + caps activation + event queue poll)

## Server Behavior (Empirically Determined)

### Draw Distance Cap — 768m Effective Maximum
- The server hardcaps the interest bubble at **~3 regions (~768m) in each direction**
- Draw distance (cameraFar) above ~768m makes no difference:

| Draw Distance | No Sweep | Result |
|---|---|---|
| 16m | static | 3 regions total, 1 region out — barely functional |
| 1024m | static | ~41 regions, 3 out in each direction |
| 2048m | static | 44 regions, 3 out — same as 1024 |
| 16384m | static | 41 regions, 3 out — same, got a DisableSimulator |

- **1024m is the practical setting** — comfortably past the ~768m cap, no benefit going higher
- Set from consumers (not in the library itself):
  - `electron-ui/src/main/metaverse-connection.ts` — sets to 1024
  - `sl-mcp/src/bot-manager.ts` — sets to 1024

### Draw Distance Controls Everything
- With cameraFar=16m: only 3 EnableSimulator events, max distance 1 region, NO cascading
- The server gates ALL EnableSimulator events based on the main agent's draw distance
- "Cascading" is not children discovering their own neighbors — it's the server drip-feeding EnableSimulator events through whichever event queue delivers them
- Child caps + event queues are still needed as delivery channels, but the server decides what to send

### Camera Position — Shifts Bubble, Doesn't Grow It
- AgentUpdate CameraCenter influences which regions the server announces
- Stepping camera 256m per step gains 1 region per step in that direction
- **Hard wall at 7 regions (1792m)** — server refuses EnableSimulator beyond that regardless of camera position
- But regions behind the camera get DisableSimulator when total exceeds ~80-100
- Ignoring DisableSimulator doesn't help — the 7-region limit is enforced at the EnableSimulator level (server simply stops announcing new regions)
- Net effect: camera sweep shifts coverage but doesn't expand it

### Concurrent Connection Limits
- Server enforces a **max of ~80-100 concurrent child agents** per avatar
- This limit is server-side and cannot be increased from the client
- In single-direction tests staying under ~70 connections, no DisableSimulator is sent

### Test Results Summary (at Makkeolli, mainland)

| Configuration | Concurrent Peak | Total Unique | Coverage |
|---|---|---|---|
| cameraFar=16, no sweep | 2 | 3 | 1 region out |
| cameraFar=1024, no sweep | ~40 | 41 | ~7x7 |
| cameraFar=2048, no sweep | ~40 | 44 | ~7x7 |
| cameraFar=16384, no sweep | ~40 | 41 | ~7x7 |
| cameraFar=1024, step east | 71 | 71 | 7 regions deep |
| cameraFar=1024, 8-dir sweep | ~80 | 88 | 11x11 |
| cameraFar=1024, spiral sweep | ~95 | 150/261 | 57.5% of 17x17 |

### Region Handshake Timeouts
- Some regions at the edges timeout on RegionHandshake (10s timeout)
- These are typically regions that are too far away or overloaded
- The 1022,x and 1035,x columns consistently timeout — likely at the edge of mainland

### DisableSimulator Waves
- When camera sweeps far, the server sends batches of DisableSimulator
- All connections are torn down cleanly (no crashes)
- Fixed a 404 crash in EventQueueClient.shutdown() — the final ACK request would 404 if the region already disconnected us

## Map Data Sources

### Child Agents (~7x7 with cascading)
- Real-time avatar positions via CoarseLocationUpdate
- Updated every few seconds
- Includes avatar UUID and region-local X/Y/Z coordinates
- Used for green map dots in nearby regions

### Map Queries (beyond ~7x7)
- `GridCommands.getAvatarLocationsInRange()` queries with MapItemRequest/MapItemReply
- Returns global avatar positions grouped by region, with `Extra` field for additional avatars per spot
- Refreshed every 30s via `refreshMapAgentCounts()` in the map renderer
- Use this for avatar presence indicators beyond child agent range

## Integration Points

### Electron App (metaverse-connection.ts)
- `getChildAvatars()` method returns child avatar data in NearbyAvatar format
- Sets `bot.agent.cameraFar = 1024` before connectToSim()

### IPC Handlers (ipc-handlers.ts)
- `gatherMapPositions()` collects markers from viewer, metaverse, and child agent sources
- `pushNearbyMarkers()` helper handles deduplication (seenAvatarIds set) and marker creation for all three sources
- `MapMarker` interface lives in `shared/types.ts` (shared with map renderer)

### ClientEvents
- `onEnableSimulator: Subject<EnableSimulatorEvent>` — region handle + IP + port
- `onEstablishAgentCommunication: Subject<EstablishAgentCommunicationEvent>` — simIpAndPort + seedCapability

### EventQueueClient
- EnableSimulator handler decodes Handle/IP/Port from base64 LLSD
- EstablishAgentCommunication handler extracts sim-ip-and-port and seed-capability
- shutdown() wraps final ACK in try/catch to handle 404 from already-disconnected regions

## Files

| File | Role |
|---|---|
| `node-metaverse/lib/classes/ChildAgentConnection.ts` | Single child circuit |
| `node-metaverse/lib/classes/ChildAgentManager.ts` | Lifecycle manager for all children |
| `node-metaverse/lib/events/EnableSimulatorEvent.ts` | Event interface |
| `node-metaverse/lib/events/EstablishAgentCommunicationEvent.ts` | Event interface |
| `node-metaverse/lib/classes/ClientEvents.ts` | Added two new subjects |
| `node-metaverse/lib/classes/EventQueueClient.ts` | EnableSimulator + EstablishAgentCommunication handlers |
| `node-metaverse/lib/Bot.ts` | ChildAgentManager integration |
| `electron-ui/src/main/metaverse-connection.ts` | getChildAvatars(), cameraFar |
| `electron-ui/src/shared/types.ts` | MapMarker interface (shared) |
| `electron-ui/src/main/ipc-handlers.ts` | gatherMapPositions() + pushNearbyMarkers() |
| `electron-ui/src/map-renderer/MapApp.tsx` | World map rendering (imports MapMarker) |
| `electron-ui/scripts/test-child-agents.ts` | Test script |

## Test Script

```bash
cd electron-ui && npx tsx scripts/test-child-agents.ts [options] [start-location]
```

Options:
- `north/south/east/west` — direction for camera stepping (default: east)
- `--draw N` — set draw distance (default: 1024)
- `--no-sweep` — disable camera stepping, just observe
- `--wait N` — initial wait seconds (default: 15, or 60 for --no-sweep)

Makkeolli is a good test location (mainland, surrounded by ~261 regions with avatars).
