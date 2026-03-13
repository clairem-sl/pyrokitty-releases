# Firestorm Viewer Architecture for Plugin Development

This document describes the Firestorm viewer architecture relevant to building a plugin system.

## Table of Contents

- [Overview](#overview)
- [Core Architecture Layers](#core-architecture-layers)
- [Event System](#event-system)
- [Existing Extension Mechanisms](#existing-extension-mechanisms)
- [Key Files Reference](#key-files-reference)

---

## Overview

The Firestorm viewer is a C++ application with approximately 715K lines of code in the main viewer (`firestorm/indra/newview/`), plus supporting libraries. It uses a custom UI framework, Boost.Signals2 for internal events, and LLSD (Linden Lab Structured Data) as its primary data interchange format.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (LLUI Framework)                                  │
│  └── LLView → LLPanel → LLFloater hierarchy                 │
│  └── XML-based layouts (skins/)                             │
├─────────────────────────────────────────────────────────────┤
│  Core Viewer Systems (firestorm/indra/newview/)                       │
│  └── LLAppViewer (main singleton)                           │
│  └── LLViewerWindow (main window/input)                     │
│  └── LLAgent (user avatar state)                            │
│  └── LLPipeline (rendering)                                 │
├─────────────────────────────────────────────────────────────┤
│  Event/Messaging Layer                                      │
│  └── LLEventPump (pub/sub event bus)                        │
│  └── LLEventAPI (named API endpoints)                       │
│  └── LLEventDispatcher (method dispatch)                    │
├─────────────────────────────────────────────────────────────┤
│  Foundation Libraries (firestorm/indra/ll*)                           │
│  └── llcommon (threads, memory, strings, events)            │
│  └── llmessage (network protocol)                           │
│  └── llplugin (out-of-process plugins)                      │
│  └── llui (widget library)                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Architecture Layers

### 1. Foundation Layer (`firestorm/indra/llcommon/`)

Core utilities used throughout the codebase.

| Component | File | Purpose |
|-----------|------|---------|
| Threading | `llthread.h` | Base thread class, worker threads |
| Events | `llevents.h` | LLEventPump, pub/sub system |
| Dispatcher | `lleventdispatcher.h` | String-based function dispatch |
| Event API | `lleventapi.h` | Base class for exposing APIs |
| LLSD | `llsd.h` | Structured data format (like JSON) |
| Logging | `llerror.h` | LL_INFOS, LL_WARNS, LL_ERRS macros |

### 2. UI Framework (`firestorm/indra/llui/`)

Custom C++ widget library (not web-based).

| Component | File | Purpose |
|-----------|------|---------|
| Base Widget | `llview.h` | Base drawable, handles input |
| Container | `llpanel.h` | Panel container, XML loading |
| Window | `llfloater.h` | Floating windows with chrome |
| Registry | `llfloaterreg.h` | Floater factory/discovery |
| Text Input | `llchatentry.h` | Chat input widget |
| Text Display | `lltexteditor.h` | Rich text display |

### 3. Core Viewer (`firestorm/indra/newview/`)

Main application logic (~1,714 files).

| Component | File | Purpose |
|-----------|------|---------|
| App Entry | `llappviewer.h` | Main singleton, lifecycle |
| Window | `llviewerwindow.h` | Main window, input routing |
| Agent | `llagent.h` | User avatar state/control |
| Rendering | `pipeline.h` | Main render pipeline |
| Settings | Uses `llcontrol.h` | `gSavedSettings` singleton |

### 4. Plugin System (`firestorm/indra/llplugin/`)

Existing out-of-process plugin infrastructure (used for media).

| Component | File | Purpose |
|-----------|------|---------|
| Media Interface | `llpluginclassmedia.h` | Media plugin API |
| Process Parent | `llpluginprocessparent.h` | Manages child processes |
| Messages | `llpluginmessage.h` | LLSD message serialization |
| IPC Pipe | `llpluginmessagepipe.h` | Socket-based communication |

---

## Event System

The viewer uses a sophisticated event system based on Boost.Signals2.

### LLEventPump (`firestorm/indra/llcommon/llevents.h`)

Named event channels that support pub/sub messaging.

```cpp
// Get or create a pump
LLEventPump& pump = LLEventPumps::instance().obtain("MyPump");

// Subscribe to events
pump.listen("mylistener", [](const LLSD& event) {
    // Handle event
    return false; // Don't consume
});

// Post an event
pump.post(LLSD().with("key", "value"));
```

### LLEventAPI (`firestorm/indra/llcommon/lleventapi.h`)

Base class for creating named API endpoints accessible via events.

```cpp
class MyAPI : public LLEventAPI {
public:
    MyAPI() : LLEventAPI("MyAPI", "Description of my API") {
        add("operation", "Description", &MyAPI::operation);
    }

    void operation(const LLSD& request) {
        Response reply(LLSD(), request);
        reply["result"] = "success";
    }
};
```

### Existing LLEventAPI Implementations

| API Name | File | Purpose |
|----------|------|---------|
| `LLChatBar` | `fsnearbychatbarlistener.cpp` | Send nearby chat |
| `GroupChat` | `groupchatlistener.cpp` | Group chat operations |
| `LLAgent` | `llagentlistener.cpp` | Agent control |
| `LLInventory` | `llinventorylistener.cpp` | Inventory access |
| `LLFloaterReg` | `llfloaterreglistener.cpp` | Floater control |
| `LLGesture` | `llgesturelistener.cpp` | Gesture playback |
| `LLViewerControl` | `llviewercontrollistener.cpp` | Settings access |
| `LLViewerWindow` | `llviewerwindowlistener.cpp` | Window operations |
| `LLAppViewer` | `llappviewerlistener.cpp` | App lifecycle |

---

## Existing Extension Mechanisms

### 1. LEAP (LLSD Event API Plugin)

**Location:** `firestorm/indra/llcommon/llleap.cpp`, `llleaplistener.cpp`

External processes that communicate via stdin/stdout using length-prefixed LLSD.

**Protocol:**
```
# Message format
<length>:<llsd-notation>

# Example
119:{'data':{'op':'sendChat','message':'Hello'},'pump':'LLChatBar'}
```

**Capabilities:**
- Subscribe to any LLEventPump
- Call any LLEventAPI operation
- Create new pumps
- Bidirectional communication

**Launch:**
```bash
viewer --leap "python my_plugin.py"
```

**Reference:** See `C:\DeeDrive\dev\leap\README.md` for protocol details.

### 2. Media Plugin System

**Location:** `firestorm/indra/llplugin/`

Socket-based IPC for out-of-process media handling.

- Used for CEF browser, video players
- Shared memory for texture data
- Process lifecycle management
- Message queue with priorities

### 3. Internal Signals

Many viewer systems expose Boost.Signals2 signals for internal extensibility:

```cpp
// Example from LLIMModel
typedef boost::signals2::signal<void(const LLSD&)> session_signal_t;
session_signal_t mNewMsgSignal;

// Connect
model.addNewMsgCallback([](const LLSD& msg) { /* handle */ });
```

---

## Key Files Reference

### Application Core

| File | Path | Description |
|------|------|-------------|
| `llappviewer.h/cpp` | `firestorm/indra/newview/` | Main application class |
| `llviewerwindow.h/cpp` | `firestorm/indra/newview/` | Main window management |
| `llagent.h/cpp` | `firestorm/indra/newview/` | User avatar state |
| `llstartup.cpp` | `firestorm/indra/newview/` | Startup sequence, message registration |

### Event System

| File | Path | Description |
|------|------|-------------|
| `llevents.h/cpp` | `firestorm/indra/llcommon/` | LLEventPump system |
| `lleventapi.h/cpp` | `firestorm/indra/llcommon/` | LLEventAPI base class |
| `lleventdispatcher.h/cpp` | `firestorm/indra/llcommon/` | Method dispatch |
| `llleap.h/cpp` | `firestorm/indra/llcommon/` | LEAP process management |
| `llleaplistener.cpp` | `firestorm/indra/llcommon/` | LEAP protocol handler |

### UI Framework

| File | Path | Description |
|------|------|-------------|
| `llview.h/cpp` | `firestorm/indra/llui/` | Base widget class |
| `llpanel.h/cpp` | `firestorm/indra/llui/` | Panel container |
| `llfloater.h/cpp` | `firestorm/indra/llui/` | Floating window |
| `llfloaterreg.h/cpp` | `firestorm/indra/llui/` | Floater registry |

### Plugin Infrastructure

| File | Path | Description |
|------|------|-------------|
| `llpluginclassmedia.h/cpp` | `firestorm/indra/llplugin/` | Media plugin interface |
| `llpluginprocessparent.h/cpp` | `firestorm/indra/llplugin/` | Plugin process manager |
| `llpluginmessage.h/cpp` | `firestorm/indra/llplugin/` | Plugin message format |
| `llpluginmessagepipe.h/cpp` | `firestorm/indra/llplugin/` | Socket IPC |

---

## Next Steps

See [CHAT-SYSTEM.md](./CHAT-SYSTEM.md) for detailed chat architecture.
See [TODO-LEAP-EXTENSION.md](./TODO-LEAP-EXTENSION.md) for implementation plan.
