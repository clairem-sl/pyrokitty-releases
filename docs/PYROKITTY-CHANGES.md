# PyroKitty Branch Changes Summary

This document describes all modifications made in the PyroKitty branch of Firestorm.

## Table of Contents

- [Overview](#overview)
- [1. Chat Event API (WebSocket)](#1-chat-event-api-websocket)
- [2. Progressive Teleport Slowdown Fix](#2-progressive-teleport-slowdown-fix)
- [3. Privacy Improvements (Machine ID)](#3-privacy-improvements-machine-id)
- [4. Build System Improvements](#4-build-system-improvements)
- [5. Developer/Testing Modifications](#5-developertesting-modifications)
- [6. Stability Fixes](#6-stability-fixes)
- [7. External Login System](#7-external-login-system)
- [8. Same-Region Session Continuation (Archived)](#8-same-region-session-continuation-archived)
- [9. Per-Axis Mirroring](#9-per-axis-mirroring)
- [10. Performance Optimizations](#10-performance-optimizations)
- [11. Inventory Event API](#11-inventory-event-api)
- [12. Vivox Removal](#12-vivox-removal)
- [13. Texture Pre-Compression (DXT5)](#13-texture-pre-compression-dxt5)
- [14. Media Texture Color Fix](#14-media-texture-color-fix)
- [15. SL MCP Server](#15-sl-mcp-server)
- [16. Default Settings Changes](#16-default-settings-changes)
- [File Change Summary](#file-change-summary)

---

## Overview

The PyroKitty branch introduces several categories of changes:

| Category | Purpose |
|----------|---------|
| Chat Event API | Enable external chat applications via WebSocket |
| Teleport Fix | Fix progressive slowdown after multiple teleports |
| Privacy | Remove MAC address leakage in machine identification |
| Build System | Improvements for Windows build process |
| Stability | Null checks and thread safety improvements |
| External Login | Electron app for friends/groups/chat, Firestorm logs in via CLI |
| Per-Axis Mirroring | Mirror objects on X/Y/Z axes with drag-past-zero support |
| Performance | Shadow throttling, FSR upscaling, texture priority, GPU texture cache |
| Inventory API | Inventory operations via WebSocket for external apps |
| Vivox Removal | Removed proprietary voice chat dependency |
| Texture Compression | DXT5 pre-compression on decode threads for faster GL uploads |
| Media Fix | Fixed inverted colors on CEF/dullahan media textures |
| SL MCP Server | Model Context Protocol server for Second Life bot automation |
| Default Settings | PlayTypingAnim off, welcome pack cleanup on close |

All changes are tagged with `<FS:Pyrokitty>` comments for easy identification.

---

## 1. Chat Event API (WebSocket)

### What It Does

Enables the Electron UI to relay chat (nearby, IMs, group messages) bidirectionally with the viewer over a WebSocket connection. When the viewer is running, the Electron app routes chat through the viewer; when the viewer is closed, it uses node-metaverse directly.

### Architecture

```
Electron UI (React)
        │
        │ WebSocket (ws://localhost:9001)
        ▼
PKWebSocketServer (pkwebsocketserver.cpp)
        │
        │ LLEventPump messages
        ▼
PKChatEventAPI (pkchateventapi.cpp)
        │
        ├─► Subscribe to nearby chat signals
        ├─► Subscribe to IM signals
        ├─► Send nearby chat / IMs (P2P and group)
        └─► Control native chat UI visibility
```

### Key Files

| File | Purpose |
|------|---------|
| `indra/newview/pkchateventapi.h/.cpp` | Chat event API (subscribe, send, visibility) |
| `indra/newview/pkwebsocketserver.h/.cpp` | WebSocket server for external communication |
| `electron-ui/src/main/viewer-connection.ts` | WebSocket client with request/response matching |
| `electron-ui/src/main/ipc-handlers.ts` | Routes chat based on connection state |

### API Operations

**Pump Name:** `ChatAPI`

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `subscribe` | `reply` (required), `events` (optional: "all", "nearby", "im") | Subscribe to chat events |
| `sendNearby` | `message`, `channel` (optional) | Send nearby chat |
| `sendIM` | `participant_id` OR `group_id`, `message` | Send an instant message |
| `setVisible` | `visible` (boolean) | Show/hide native chat floaters |

### Event Format

Events are forwarded over WebSocket as JSON with snake_case keys. The Electron renderer transforms to camelCase.

**Nearby Chat Event:**
```json
{
  "type": "nearby",
  "message": "Hello world",
  "from_name": "Avatar Name",
  "from_id": "uuid",
  "source_type": 1,
  "chat_type": 1
}
```

**IM Event:**
```json
{
  "type": "im",
  "message": "Hello",
  "from_name": "Avatar Name",
  "from_id": "uuid",
  "session_id": "uuid",
  "session_type": "p2p"
}
```

### Native Chat UI

When the WebSocket connects after viewer launch, `setChatVisible(false)` hides Firestorm's `fs_nearby_chat` and `fs_im_container` floaters so the Electron UI is the sole chat interface.

---

## 2. Progressive Teleport Slowdown Fix

### Problem

Each teleport was taking progressively longer than the last. A relog would reset the timing to normal.

### Root Cause (Mesh)

The mesh repository maintains several containers for tracking pending mesh requests:
- `mPendingRequests` - Queue of mesh LOD requests
- `mLoadingMeshes[4]` - Maps of meshes being loaded per LOD level
- `mLoadingSkins` - Skin data being loaded
- `mLoadingDecompositions` - Physics decomposition data
- `mLoadingPhysicsShapes` - Physics shapes

Unlike textures (which call `deleteAllRequests()` on teleport), these mesh containers were never cleared. They accumulated stale requests from previous regions, causing the mesh system to process dead requests and timeout on unreachable servers.

### Solution

Added `LLMeshRepository::clearPendingRequests()` called during teleport:

**llmeshrepository.cpp:4366**
```cpp
void LLMeshRepository::clearPendingRequests()
{
    LLMutexLock lock(mMeshMutex);

    mPendingRequests.clear();
    for (S32 i = 0; i < 4; ++i)
        mLoadingMeshes[i].clear();
    mLoadingSkins.clear();
    mLoadingDecompositions.clear();
    // ... clear queues with swap()
    sLODPending = 0;
}
```

**llagent.cpp:4799** (in `teleportCore()`):
```cpp
// <FS:Pyrokitty> Clear pending mesh requests
gMeshRepo.clearPendingRequests();
// </FS:Pyrokitty>
```

### Root Cause (Textures)

Textures had a similar issue - the `mCreateTextureList` and `mDownScaleQueue` queues accumulated across teleports.

### Additional Solution (Textures)

Enhanced `LLViewerTextureList::clearFetchingRequests()`:

**llviewertexturelist.cpp:910**
```cpp
// Clear texture queues that accumulate across teleports
while (!mCreateTextureList.empty())
{
    mCreateTextureList.front()->mCreatePending = false;
    mCreateTextureList.pop();
}

while (!mDownScaleQueue.empty())
{
    mDownScaleQueue.front()->mDownScalePending = false;
    mDownScaleQueue.pop();
}

// Spike discard bias to trigger VRAM cleanup
LLViewerTexture::sDesiredDiscardBias = 4.0f;
```

This clears the texture creation/downscale queues and spikes the discard bias to trigger aggressive texture downscaling, freeing VRAM through the normal path without breaking texture states.

---

## 3. Privacy Improvements (Machine ID)

### Problem

The viewer was leaking MAC addresses through two mechanisms:
1. `LLUUID::getNodeID()` - Used MAC address for UUID generation
2. `LLMachineID::getUniqueID()` - Used WMI queries on Windows to get hardware serials

### Solution

Removed all MAC address and hardware serial retrieval code:

**lluuid.cpp:**
- Removed `getNodeID()` implementations for Windows, macOS, and Linux
- UUID generation now uses random bytes only

**llmachineid.cpp:**
- Removed entire `LLWMIMethods` class (500+ lines)
- Removed WMI queries for disk serial, processor serial, motherboard serial
- Simplified to return static identifier

**llhasheduniqueid.cpp:**
- Removed fallback to `LLUUID::getNodeID()` (MAC address)
- Simplified flow

### Impact

- Machine identification is now privacy-preserving
- UUIDs are fully random (RFC 4122 compliant)
- No hardware fingerprinting data transmitted

---

## 4. Build System Improvements

### CMakeLists.txt Changes

**indra/newview/CMakeLists.txt:**
- Added `pkchateventapi.cpp` and `pkchateventapi.h` to build

**indra/llwindow/CMakeLists.txt:**
- Build system fix

### viewer_manifest.py Changes

Improvements to the Windows build manifest for packaging.

### configure_firestorm.sh Changes

Build script improvements for the new components.

---

## 5. Developer/Testing Modifications

These changes are for development and testing purposes:

### Godlike Viewer Flag

**llagent.cpp:399**
```cpp
#define HACKED_GODLIKE_VIEWER
```

Enables local godlike powers for testing (the viewer believes it has god mode). This does not grant actual server-side god powers.

### Permission Bypass

**llpermissions.cpp:479**
```cpp
bool LLPermissions::allowOperationBy(...)
{
    return true;  // Always allow
}
```

Permission checks are bypassed locally for testing. This enables testing features that would normally require specific permissions.

**Note:** These are development-only modifications. The server still enforces actual permissions.

---

## 6. Stability Fixes

### Thread Recorder Null Check

**llappviewer.cpp:1678**
```cpp
// <FS:Pyrokitty> Add null check
if (LLTrace::ThreadRecorder* recorder = LLTrace::get_thread_recorder())
{
    recorder->pullFromChildren();
}
// </FS:Pyrokitty>
```

Prevents crash if thread recorder is null during frame processing.

### Fast Timer Null Safety

**llfasttimer.cpp:188**
```cpp
TimeBlockTreeNode& BlockTimerStatHandle::getTreeNode() const
{
    static TimeBlockTreeNode null_node;
    ThreadRecorder* recorder = LLTrace::get_thread_recorder();
    if (!recorder) return null_node;
    TimeBlockTreeNode* nodep = recorder->getTimeBlockTreeNode(getIndex());
    if (!nodep) return null_node;
    return *nodep;
}
```

Returns a static null node instead of crashing when recorder is unavailable.

### Trace Recording Null Checks

**lltrace.cpp:66** - Added null check in `setParent()`:
```cpp
ThreadRecorder* recorder = get_thread_recorder();
if (!recorder) return;
```

**lltracerecording.cpp:140** - Added null check in `handleStart()`:
```cpp
if (LLTrace::get_thread_recorder())
{
    mActiveBuffers = LLTrace::get_thread_recorder()->activate(mBuffers.write());
}
```

**lltracerecording.cpp:156** - Added null check in `handleStop()`:
```cpp
if (LLTrace::get_thread_recorder())
{
    LLTrace::get_thread_recorder()->deactivate(mBuffers.write());
}
```

These prevent crashes when fast timers are disabled or during shutdown sequences when the thread recorder may be null.

---

## File Change Summary

### New Files
| File | Lines | Purpose |
|------|-------|---------|
| `pkchateventapi.cpp/.h` | ~370 | Chat Event API (subscribe, send, visibility) |
| `pkinventoryeventapi.cpp/.h` | ~300 | Inventory Event API (8 operations) |
| `pkloginhandoff.cpp/.h` | ~310 | External login session handoff API |
| `pkwebsocketserver.cpp/.h` | ~500 | WebSocket server for Electron communication |
| `pkmirrorflags.cpp/.h` | ~400 | Per-axis mirror flags singleton |
| `llgputexturecache.cpp/.h` | ~600 | DXT5 GPU texture cache |
| `electron-ui/` | ~8000 | Electron app (React UI, node-metaverse) |
| `sl-mcp/` | ~2000 | MCP server for SL bot automation |

### Modified Files (Significant Changes)
| File | Change |
|------|--------|
| `llmeshrepository.cpp/h` | Added `clearPendingRequests()` for teleport fix |
| `llviewertexturelist.cpp` | Clear texture queues on teleport, spike discard bias |
| `llagent.cpp` | Call mesh clear on teleport, godlike flag |
| `llappviewer.cpp` | ChatAPI init, null check, WebSocket server |
| `llstartup.cpp` | External login states, session continuation, interest list reset |
| `llcircuit.cpp/h` | Added `setPacketOutID()` for session continuation |
| `net.cpp` | SO_REUSEADDR for UDP port reuse |
| `lluuid.cpp` | Removed MAC address code (~220 lines) |
| `llmachineid.cpp` | Removed WMI code (~440 lines) |
| `llhasheduniqueid.cpp` | Simplified, removed MAC fallback |
| `llpermissions.cpp` | Permission bypass for testing |
| `llfasttimer.cpp/h` | Null safety improvements |
| `lltrace.cpp` | Null check in setParent |
| `lltracerecording.cpp` | Null checks in start/stop |
| `node-metaverse/lib/classes/Circuit.ts` | Added `getLocalPort()`, `getSequenceNumber()` |
| `node-metaverse/lib/Bot.ts` | Added `shutdownForHandoff()` |

### Modified Files (Minor Changes)
| File | Change |
|------|--------|
| `00-Common.cmake` | Build config |
| `llmanifest.py` | Manifest handling |
| `indra_constants.h` | Constants update |
| `llfasttimer.cpp/h` | Timer improvements |
| `lltrace.cpp` | Trace fixes |
| `lltracerecording.cpp` | Recording fixes |
| `llpermissions.cpp` | Permission handling |
| `lltexture.cpp/h` | Texture handling |
| `llviewertexture.cpp/h` | Viewer texture handling |
| `llviewertexturelist.cpp` | Texture list handling |
| `fsexportperms.cpp` | Export permissions |
| `fspanelface.cpp` | Face panel |
| `llpanelface.cpp` | Panel face |
| `lltexturectrl.cpp` | Texture control |
| `llviewercontrol.h` | Viewer control |
| `llviewerstats.cpp` | Stats handling |
| `llvovolume.cpp` | Volume handling |
| Platform viewers (`llappviewerwin32.cpp`, etc.) | Platform-specific updates |

---

## Testing

### Chat API Testing

1. Build the viewer
2. Launch the Electron UI (`cd electron-ui && npm start`)
3. Log in via the Electron app — viewer launches automatically
4. Chat should relay bidirectionally between Electron and viewer

### Teleport Fix Testing

1. Teleport multiple times in succession
2. Observe that each teleport completes in roughly the same time
3. Previously: each teleport would take 5-15 seconds longer than the last

---

---

## 7. External Login System

### Current Approach (2026-02-05)

The simpler approach: node-metaverse handles initial login for friends/groups/chat UI, then Firestorm logs in normally with CLI params. SL auto-disconnects node-metaverse when Firestorm logs in. When Firestorm exits, node-metaverse re-logs in.

```
[Electron/node-metaverse logs in]
        ↓
[Shows friends/groups/chat UI]
        ↓
[User clicks "Launch Viewer"]
        ↓
[Firestorm launches with --login CLI params]
        ↓
[SL auto-disconnects node-metaverse]
        ↓
[WebSocket connects for chat relay]
        ↓
[Native chat UI hidden via setChatVisible(false)]
        ↓
[User closes Firestorm]
        ↓
[node-metaverse re-logs in automatically]
```

**Key Features:**
- Bidirectional chat relay via WebSocket (ChatAPI pump)
- Native chat floaters (fs_nearby_chat, fs_im_container) hidden when WebSocket connects
- Unread count management synced between Electron and Firestorm
- Local echo for outgoing messages

**Key Files:**
- `electron-ui/src/main/viewer-manager.ts` - Viewer lifecycle, re-login logic
- `electron-ui/src/main/viewer-connection.ts` - WebSocket connection, setChatVisible
- `electron-ui/src/main/ipc-handlers.ts` - Chat routing based on connection state
- `electron-ui/src/renderer/hooks/useChat.ts` - Chat state, session management

---

### Previous Approach: Session Handoff (Archived)

The session handoff approach attempted to transfer an active session from node-metaverse to Firestorm without re-logging in. This worked but was complex. Documentation preserved below for reference.

#### What It Does

Moves the login process from the C++ viewer to PyroKitty (Electron app). This enables:
- Multi-account management in a unified UI
- Login queuing and automation
- External session management via node_metaverse library

#### Architecture

```
PyroKitty (Electron + node_metaverse)
        │
        │ 1. XML-RPC login to grid
        │ 2. Connect to source region
        │ 3. Initiate teleport → capture destination data
        ▼
    WebSocket (ws://localhost:9001)
        │
        ▼
Viewer (--external-login mode)
        │
        │ PKLoginHandoff API receives credentials
        │ Sets agent IDs, circuit code, inventory roots
        │ Transitions to STATE_WORLD_INIT
        ▼
    Direct connection to destination region
```

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `pkloginhandoff.cpp` | ~200 | External login API via LLEventAPI |
| `pkloginhandoff.h` | ~50 | Header for login handoff |
| `electron-ui/scripts/test-viewer-handoff.ts` | ~280 | Test script for handoff |

### Modified Files

| File | Change |
|------|--------|
| `llstartup.cpp` | Added STATE_EXTERNAL_LOGIN_WAIT handler |
| `llinventorymodel.h` | Added `setAgentInventoryUsable()` for external login |
| `app_settings/cmd_line.xml` | Added `--external-login` command line flag |
| `llappviewer.cpp` | Initialize PKLoginHandoff singleton |
| `CMakeLists.txt` | Added pkloginhandoff to build |

### Key Code Changes

**llstartup.cpp - External Login Wait State:**
```cpp
case STATE_EXTERNAL_LOGIN_WAIT:
{
    if (!PKLoginHandoff::hasSessionData())
    {
        ms_sleep(100);
        return false;
    }

    // Apply session data
    LLSD sessionData = PKLoginHandoff::getSessionData();
    gAgentID = LLUUID(sessionData["agent_id"].asString());
    gAgentSessionID = LLUUID(sessionData["session_id"].asString());

    // Initialize inventory roots
    LLUUID inv_root_id(sessionData["inventory_root"].asString());
    gInventory.setRootFolderID(inv_root_id);

    // Create minimal root category
    LLPointer<LLViewerInventoryCategory> root_cat = new LLViewerInventoryCategory(...);
    gInventory.updateCategory(root_cat);
    gInventory.buildParentChildMap();
    gInventory.setAgentInventoryUsable(true);

    // Start background inventory fetch
    LLInventoryModelBackgroundFetch::instance().start();

    LLStartUp::setStartupState(STATE_WORLD_INIT);
}
```

**pkloginhandoff.cpp - Session Handoff API:**
```cpp
PKLoginHandoff::PKLoginHandoff()
    : LLEventAPI("PKLoginHandoff", "Login session handoff from PyroKitty")
{
    add("session_handoff", "Receive session credentials from external login",
        &PKLoginHandoff::handleSessionHandoff,
        llsd::map("agent_id", LLSD(), "session_id", LLSD(), ...));
}

void PKLoginHandoff::handleSessionHandoff(const LLSD& event)
{
    sSessionData = event;
    sHasSessionData = true;  // std::atomic<bool> for thread safety

    // Reply to WebSocket
    LLSD reply;
    reply["success"] = true;
    reply["status"] = "session_received";
    sendReply(reply, event);
}
```

### Thread Safety Note

The WebSocket callback runs on a different thread than the main startup loop. The `sHasSessionData` flag uses `std::atomic<bool>` to ensure visibility across threads.

### Current Status

- ✅ Session handoff works
- ✅ Agent IDs set correctly
- ✅ Circuit established
- ✅ 3D world renders
- ✅ Avatar appearance loading (fixed 2026-02-02)
- ✅ Benefits initialization (fixed 2026-02-02)
- ✅ Inventory validation bypass (fixed 2026-02-02)
- ✅ Location modal suppression (fixed 2026-02-02)
- ✅ Inventory loads correctly

### Appearance Loading Fix (2026-02-02)

The external login was creating duplicate system folders (including empty COF) before the actual inventory was fetched. Fixed by:
1. Removed premature `createCommonSystemCategories()` from STATE_EXTERNAL_LOGIN_WAIT
2. Skip `createCommonSystemCategories()` in STATE_INVENTORY_SEND2 for external login
3. Re-initialize COF ID in `set_flags_and_update_appearance()` after COF is fetched

### Benefits Handoff (2026-02-02)

Benefits data (account tier, upload costs, limits) is now passed through the external login handoff:
1. Modified `electron-ui/node-metaverse/lib/classes/LoginResponse.ts` to parse benefits fields
2. Updated `test-viewer-handoff.ts` to include benefits in handoff data
3. Updated `llstartup.cpp` to call `init_benefits()` with handoff data if available

Benefits fields in handoff:
- `account_type`: "Base", "Premium", etc.
- `account_level_benefits`: Object with `animated_object_limit`, `attachment_limit`, `group_membership_limit`, `picks_limit`, upload costs
- `premium_packages`: Optional map of additional benefit tiers

### Inventory Validation Bypass (2026-02-02)

The inventory validation in `buildParentChildMap()` was marking inventory as unusable due to duplicate system folders (common in old/merged accounts). Fixed by:

1. Skip redundant `buildParentChildMap()` call in STATE_INVENTORY_SEND2 for external login
2. Re-force `mIsAgentInvUsable = true` if validation fails during external login
3. Suppress "Inventory is broken" notification for external login

**llstartup.cpp (STATE_INVENTORY_SEND2):**
```cpp
// <FS:Pyrokitty> Skip for external login - we already called this in STATE_EXTERNAL_LOGIN_WAIT
if (!PKLoginHandoff::isExternalLoginMode())
{
    gInventory.buildParentChildMap();
}
else
{
    // For external login, validation may fail due to duplicate system folders.
    // Force usable since the skeleton was already loaded successfully.
    if (!gInventory.isInventoryUsable())
    {
        gInventory.setAgentInventoryUsable(true);
    }
}
// </FS:Pyrokitty>
```

### Location Modal Suppression (2026-02-02)

The "Your requested location is not currently available" modal was appearing during external login because the teleport destination handling differs from normal login. Fixed by checking for external login mode:

**llstartup.cpp (line ~3286):**
```cpp
// <FS:Pyrokitty> Skip for external login - we handle location via teleport handoff
if (!gAgent.isFirstLogin() && !PKLoginHandoff::isExternalLoginMode())
{
    LL_INFOS("AppInit") << "processAgentMovementComplete: non first login" << LL_ENDL;
    // ... show AvatarMoved notification
}
// </FS:Pyrokitty>
```

### Inventory Cleanup Script

For accounts with corrupted inventory (duplicate system folders), use the cleanup script:

```bash
cd electron-ui

# Dry run - see what would be cleaned
npx tsx scripts/fix-inventory-duplicates.ts --dry-run

# Actually fix duplicates
npx tsx scripts/fix-inventory-duplicates.ts
```

The script:
1. Logs in via node-metaverse
2. Scans inventory skeleton for duplicate system folders
3. Keeps the folder with highest version number
4. Moves duplicates to Trash
5. Purges Trash

System folders checked: Trash, Favorites, Current Outfit, My Outfits, Received Items, Settings, Materials, Calling Cards, Landmarks, Marketplace Listings.

### Testing

```bash
cd electron-ui
npx tsx scripts/test-viewer-handoff.ts
```

---

## 8. Same-Region Session Continuation (Archived)

> **Note:** This approach is no longer used. See Section 7 for current architecture.

### Problem

Cross-region handoff works because the destination sim allocates a NEW circuit in "pending" state. But same-region handoff (where we want to hand off without teleporting) doesn't work because:

1. The sim already has the circuit in "established" state from the bot
2. The sim ignores UseCircuitCode for already-established circuits
3. The sim already sent AgentMovementComplete to the bot

### Solution: Session Continuation

Instead of re-establishing the circuit, the viewer **continues** the bot's session:

1. **Skip UseCircuitCode** - The circuit is already established
2. **Match sequence numbers** - Continue from where the bot left off
3. **Skip CompleteAgentMovement** - The bot already did this
4. **Reset interest list** - Tell sim to re-send all objects

### Implementation Details

#### Sequence Number Handling

The bot (node-metaverse) and viewer use different increment styles:
- **node-metaverse**: Post-increment (`packet.sequenceNumber = this.sequenceNumber++`)
- **Viewer**: Pre-increment (`id = (mPacketsOutID + 1)`)

If bot's sequenceNumber is 17, the next packet would be 17. But if viewer's mPacketsOutID is 17, the next packet would be 18.

**Fix**: Set `mPacketsOutID = sequenceNumber - 1` so the viewer's first packet matches what the bot would have sent.

#### Files Modified

**electron-ui/node-metaverse/lib/classes/Circuit.ts:**
```typescript
public getSequenceNumber(): number
{
    return this.sequenceNumber;
}
```

**indra/newview/pkloginhandoff.h/.cpp:**
```cpp
static bool isSessionContinuation();
static U32 getInitialSequenceNumber();
```
Parses `session_continuation` and `sequence_number` fields from handoff data.

**indra/llmessage/llcircuit.h/.cpp:**
```cpp
void LLCircuitData::setPacketOutID(TPACKETID id);
```
Allows setting the initial sequence number for session continuation.

**indra/newview/llstartup.cpp (STATE_WORLD_WAIT):**
```cpp
if (PKLoginHandoff::isSessionContinuation())
{
    // Skip UseCircuitCode
    // Set sequence number (adjusted for increment style difference)
    U32 initialSeq = PKLoginHandoff::getInitialSequenceNumber();
    U32 adjustedSeq = (initialSeq > 0) ? (initialSeq - 1) : 0;
    cdp->setPacketOutID(adjustedSeq);
    gGotUseCircuitCodeAck = true;
}
```

**indra/newview/llstartup.cpp (STATE_AGENT_SEND):**
```cpp
if (PKLoginHandoff::isSessionContinuation())
{
    // Skip CompleteAgentMovement - bot already did this
    gAgentMovementCompleted = true;

    // Reset interest list so sim re-sends all objects
    regionp->resetInterestList();
}
```

#### Interest List Reset

The sim tracks which objects it has sent to each client. After session continuation, the sim thinks the viewer already has objects from the bot's session.

`resetInterestList()` sends a DELETE to the "InterestList" capability, telling the sim to forget what it sent and start fresh. This causes the sim to re-send all visible objects.

### Test Script

**electron-ui/scripts/test-same-region-handoff.ts:**

```typescript
const handoffData: HandoffData = {
    // ... standard handoff fields ...

    // Session continuation fields
    session_continuation: true,
    sequence_number: circuit.getSequenceNumber(),
};
```

### Flow Comparison

**Cross-Region Handoff (already working):**
1. Bot logs in → connects to Region A
2. Bot teleports to Region B → gets NEW circuit data
3. Bot closes connection to A (stays logged in on B's circuit)
4. Viewer connects to Region B with new circuit
5. Sim B treats this as a fresh connection

**Same-Region Session Continuation (new):**
1. Bot logs in → connects to Region A
2. Bot captures: local port, sequence number, circuit code
3. Bot closes UDP socket (without CloseCircuit message)
4. Viewer binds to same local port
5. Viewer continues bot's session (same circuit, continued sequence)
6. Viewer resets interest list to get objects re-sent

### UDP Port Reuse

For the viewer to appear as the same client to the sim, it must use the same UDP endpoint:

**indra/llmessage/net.cpp:**
```cpp
// Enable SO_REUSEADDR for quick port reuse (session handoff)
int reuse = 1;
setsockopt(hSocket, SOL_SOCKET, SO_REUSEADDR, (char*)&reuse, sizeof(reuse));
```

**Viewer launch:**
```bash
./firestorm-bin.exe --external-login --set UserConnectionPort <bot_local_port>
```

### Sequence Gap Tolerance

The sim tolerates sequence gaps up to 16 packets (see `llcircuit.cpp:738`). If a sequence is skipped, the sim marks it as "potentially lost" but continues processing. This provides some margin for error in sequence number matching.

### Testing

```bash
cd electron-ui
npx tsx scripts/test-same-region-handoff.ts
```

---

## 9. Per-Axis Mirroring

### What It Does

Allows mirroring objects on individual X, Y, and Z axes. Includes drag-past-zero flipping in the build tools — dragging a face past the object's center automatically flips the mirror flag for that axis.

### Architecture

Mirror flags are stored as a bitmask (`PK_MIRROR_X=0x1`, `PK_MIRROR_Y=0x2`, `PK_MIRROR_Z=0x4`) persisted via notecards in the object's task inventory (`.pk_mirror_XXYYZZ` naming convention). This survives region restarts and object transfers without requiring server changes.

```
User drags face past zero
        |
        v
LLManipScale::dragFace() detects sign flip
        |
        v
PKMirrorFlags::setFlags() updates local cache + notecard
        |
        v
LLFace::getGeometryVolume() applies mirror matrix
        |
        v
LLVolume::generateSilhouetteVertices() mirrors highlight
```

### Key Files

| File | Purpose |
|------|---------|
| `pkmirrorflags.h/.cpp` | Singleton managing per-object mirror flags |
| `llface.cpp` | Mirror matrix applied during geometry upload |
| `llvovolume.h/.cpp` | Mirror flag integration with volume rendering |
| `llmanipscale.cpp/.h` | Drag-past-zero flip detection |
| `llpanelobject.cpp/.h` | Mirror checkboxes in build floater |
| `floater_tools.xml` | UI for mirror axis toggles |

### Build Floater UI

Three checkboxes (Mirror X/Y/Z) in the Object tab of the build floater. Checkboxes reflect current mirror state and can be toggled manually.

---

## 10. Performance Optimizations

See `docs/architecture/performance-todo.md` and `docs/architecture/shadow-system.md` for full details.

### Summary of Implemented Optimizations

| Feature | Impact | Setting |
|---------|--------|---------|
| Per-split shadow frame skipping | Near shadows every frame, far every 8th | `RenderShadowUpdateRate`, `RenderShadowSplitRateScale` |
| Shadow small object culling | Skip tiny objects in shadow passes | `RenderShadowMinVertexCount`, `RenderShadowMinSize` |
| Fixed alpha cutoff in shadows | Eliminates per-object flush calls | Always on |
| Shader bind tracking | Reduces redundant shader binds | Always on |
| Skip postSort in shadow passes | Skip geometry rebuild during shadows | Always on |
| FSR 1.0 EASU + RCAS | Render at lower res, upscale with sharpening | `RenderResolutionMultiplier`, `RenderFSREnabled` |
| Auto-tune resolution | GPU-bound detection adjusts resolution | `AutoTuneResolutionEnabled` |
| Texture priority throttling | 52% reduction in updateImageDecodePriority | `TextureFetchUpdateDivisor` |
| GPU texture cache | DXT5 cache bypasses J2C decode on reload | `GPUTextureCacheEnabled`, `GPUTextureCacheSize` |
| Impostor optimizations | Lower res, fewer passes, longer intervals | Various |
| OpenJPEG multithreaded decode | 2 threads per decode | Always on |
| Alpha draw distance culling | Skip small alpha objects beyond 32m | Always on |

---

## 11. Inventory Event API

### What It Does

Provides inventory operations via WebSocket for the Electron UI. Allows browsing, creating, downloading, uploading, deleting, and renaming inventory items.

### API Operations

**Pump Name:** `InventoryAPI`

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `getRootFolder` | none | Get root inventory folder UUID |
| `getFolderContents` | `folder_id` | List items and subfolders |
| `createFolder` | `parent_id`, `name` | Create a new subfolder (async) |
| `downloadAsset` | `item_id` | Download asset data as base64 (async) |
| `uploadAsset` | `folder_id`, `name`, `asset_type`, `data` | Upload new asset (async) |
| `deleteItem` | `item_id` | Delete an inventory item |
| `updateItem` | `item_id`, `name` | Rename an inventory item |
| `getUploadCost` | none | Get texture upload cost in L$ |

### Key Files

| File | Purpose |
|------|---------|
| `pkinventoryeventapi.h/.cpp` | Viewer-side inventory API implementation |
| `electron-ui/src/main/viewer-inventory-adapter.ts` | WebSocket adapter wrapping API |
| `electron-ui/src/main/inventory-sync-manager.ts` | Dual-backend sync (Bot or Viewer) |

---

## 12. Vivox Removal

### What It Does

Removed the proprietary Vivox voice chat SDK and all related runtime dependencies. Voice chat uses WebRTC instead (upstream Firestorm feature).

### Changes

- Removed Vivox DLLs from packaging manifest (`viewer_manifest.py`)
- Removed Vivox-related build targets (`CMakeLists.txt`)
- Disabled Vivox voice module initialization

---

## 13. Texture Pre-Compression (DXT5)

### What It Does

When `RenderPreCompressTextures` is enabled (default: true), textures are compressed to DXT5 on the decode worker thread immediately after J2C decoding, before being uploaded to GL. This shifts compression work off the GL thread and enables `glCompressedTexImage2D` uploads instead of driver-side compression.

### Architecture

```
J2C decode (worker thread)
        |
        v
compressToDXT5() - stb_dxt compression on worker thread
        |
        v
LLImageRaw with mHasCompressedData = true
        |
        v
createGLTexture() detects compressed data
        |
        v
setExplicitFormat(GL_COMPRESSED_RGBA_S3TC_DXT5_EXT)
        |
        v
glCompressedTexImage2D() - direct upload, no driver compression
```

### Key Files

| File | Purpose |
|------|---------|
| `indra/llimage/llimage.cpp` | `compressToDXT5()`, `compressDXT5Blocks()` |
| `indra/llimage/llimageworker.cpp` | Calls `compressToDXT5()` after decode |
| `indra/llimage/stb_dxt.h` | STB DXT compression library |
| `indra/llrender/llimagegl.cpp` | Compressed texture upload path |

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `RenderPreCompressTextures` | true | Enable DXT5 pre-compression on decode threads |

---

## 14. Media Texture Color Fix

### Problem

CEF/dullahan media textures (web pages rendered on prims and in UI floaters) displayed with inverted red/blue channels after texture compression changes were added.

### Root Cause

In `llimagegl.cpp`, a guard was added to clear `mHasExplicitFormat` when incoming image data wasn't pre-compressed DXT5. This was intended to handle the transition when a texture object switches from compressed to uncompressed data. However, it also cleared the explicit format for **media textures**, which use `GL_BGRA` as their pixel format (set by CEF plugin). With the explicit format cleared, the format was re-derived as `GL_RGBA` from the component count, causing OpenGL to interpret BGRA bytes as RGBA — swapping red and blue channels.

### Fix

Changed the guard to only clear `mHasExplicitFormat` when the current format is actually a compressed format (`isCompressed()` returns true), preserving `GL_BGRA` for media textures:

```cpp
// Only clear for compressed formats, not GL_BGRA (media textures)
if (mHasExplicitFormat && !imageraw->hasCompressedData() && isCompressed())
{
    mHasExplicitFormat = false;
}
```

### Welcome Pack Cleanup

Additionally, the Avatar Welcome Pack floater (`LLFloaterAvatarWelcomePack`) was leaving 5 `dullahan_host.exe` processes running after being closed. The floater uses `single_instance="true"`, so closing it only hides it — the destructor never runs. Added an `onClose()` override that calls `unloadMediaSource()` to kill CEF processes, and moved navigation to `onOpen()` so re-opening the floater re-loads the page.

**Files modified:** `llfloateravatarwelcomepack.cpp/.h`, `indra/llrender/llimagegl.cpp`

---

## 15. SL MCP Server

### What It Does

A Model Context Protocol (MCP) server that provides Second Life bot automation tools. Allows AI assistants (like Claude Code) to log into SL, navigate, chat, manipulate objects, and play Minesweeper.

### Architecture

```
Claude Code (MCP Client)
        |
        | STDIO (JSON-RPC)
        v
Wrapper (wrapper.ts) - Low-level MCP Server
        |
        | child_process.fork() + IPC
        v
Backend (backend.ts) - Creates BotManager
        |
        | node-metaverse
        v
Second Life Grid
```

### Tool Categories

| Category | Tools |
|----------|-------|
| Session | `sl_login`, `sl_logout`, `sl_status`, `reload` |
| Chat | `sl_say`, `sl_send_im`, `sl_send_group_message`, `sl_get_recent_ims`, `sl_get_recent_chat` |
| Navigation | `sl_teleport`, `sl_walk_to`, `sl_fly`, `sl_get_region_info` |
| Social | `sl_get_nearby_avatars`, `sl_get_friends`, `sl_get_groups`, `sl_avatar_name_to_key`, `sl_avatar_key_to_name`, `sl_get_balance` |
| Objects | `sl_rez_prim`, `sl_set_object_name/description/position/scale`, `sl_find_objects`, `sl_touch_object`, `sl_delete_object`, `sl_get_object_children/textures/inventory` |
| Minesweeper | `sl_minesweeper_read_board`, `sl_minesweeper_analyze`, `sl_minesweeper_walk_to_cell`, `sl_minesweeper_walk_path` |

### Key Files

| File | Purpose |
|------|---------|
| `sl-mcp/src/wrapper.ts` | MCP STDIO server, forks backend |
| `sl-mcp/src/backend.ts` | Child process, IPC handler |
| `sl-mcp/src/bot-manager.ts` | Bot lifecycle and 25+ methods |
| `sl-mcp/src/tools/*.ts` | Tool definitions by category |

---

## 16. Default Settings Changes

| Setting | Old Default | New Default | Reason |
|---------|------------|-------------|--------|
| `PlayTypingAnim` | 1 (on) | 0 (off) | Typing animation is distracting |
| `RenderPreCompressTextures` | N/A (new) | 1 (on) | DXT5 pre-compression on decode threads |
| `GPUTextureCacheEnabled` | N/A (new) | 1 (on) | Fast texture reloading from DXT5 cache |
| `RenderResolutionMultiplier` | N/A (new) | 0.7 | Render at 70% resolution for GPU savings |
| `RenderFSREnabled` | N/A (new) | 1 (on) | FSR EASU upscaling |
| `RenderCASSharpness` | N/A (new) | 0.5 | Moderate CAS sharpening |
| `AutoTuneResolutionEnabled` | N/A (new) | 1 (on) | Auto-adjust resolution when GPU-bound |
| `TextureFetchUpdateDivisor` | N/A (new) | 20 | Throttle texture priority updates |
| `RenderShadowSplitRateScale` | N/A (new) | 2.0 | Far shadows update less frequently |

---

## Code Search

To find all PyroKitty changes in the codebase:

```bash
grep -r "FS:Pyrokitty" indra/
```
