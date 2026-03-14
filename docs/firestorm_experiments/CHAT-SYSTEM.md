# Chat System Architecture

This document details the chat system architecture for the purpose of building an external chat plugin.

## Table of Contents

- [Overview](#overview)
- [Message Flow](#message-flow)
- [Core Components](#core-components)
- [Existing APIs](#existing-apis)
- [Integration Points](#integration-points)
- [Key Files Reference](#key-files-reference)

---

## Overview

The chat system handles two distinct types of communication:

1. **Nearby Chat** - Public chat in the 3D world (whisper/normal/shout)
2. **Instant Messages (IM)** - Private messages (P2P, group, ad-hoc conferences)

Both share some infrastructure but have separate UI components and data flows.

---

## Message Flow

### Incoming Nearby Chat

```
Network (simulator)
    │
    ▼
process_chat_from_simulator()          ← firestorm/indra/newview/llviewermessage.cpp:2762
    │
    ├── Anti-spam filtering             ← NACLAntiSpamRegistry
    ├── Mute checking                   ← LLMuteList
    ├── Avatar name lookup              ← LLAvatarNameCache
    │
    ▼
LLChat object created                   ← firestorm/indra/llui/llchat.h
    │
    ▼
LLFloaterIMNearbyChatHandler::processChat()
    │
    ├── mNewChatSignal.emit()           ← Signal for listeners
    ├── sChatWatcher->post()            ← LLEventPump broadcast
    │
    ▼
FSFloaterNearbyChat::addMessage()       ← UI display
    │
    ▼
LLLogChat::saveHistory()                ← File persistence (async)
```

### Outgoing Nearby Chat

```
User types in FSFloaterNearbyChat
    │
    ▼
FSFloaterNearbyChat::onChatBoxCommit()  ← firestorm/indra/newview/fsfloaternearbychat.cpp
    │
    ▼
FSNearbyChat::sendChatFromViewer()      ← firestorm/indra/newview/fsnearbychathub.cpp
    │
    ├── Channel number parsing (/42 syntax)
    ├── Chat type triggers (/me, /shout, etc.)
    │
    ▼
gAgent.sendChat()                       ← Sends to simulator
```

### Incoming IM

```
Network (ImprovedInstantMessage packet)
    │
    ▼
LLIMProcessing::processNewMessage()     ← firestorm/indra/newview/llimprocessing.cpp
    │
    ▼
LLIMMgr::addMessage()                   ← firestorm/indra/newview/llimview.cpp
    │
    ▼
LLIMModel::addMessage()                 ← Session management
    │
    ├── mNewMsgSignal.emit()            ← Signal for listeners
    ├── mMsgs.push_back()               ← In-memory storage
    │
    ▼
FSFloaterIM::updateMessages()           ← UI display
    │
    ▼
LLLogChat::saveHistory()                ← File persistence
```

### Outgoing IM

```
User types in FSFloaterIM
    │
    ▼
FSFloaterIM::sendMsg()                  ← firestorm/indra/newview/fsfloaterim.cpp
    │
    ▼
LLIMMgr::sendMessage()                  ← firestorm/indra/newview/llimview.cpp
    │
    ▼
send_improved_im() or HTTP capability   ← Network transmission
```

---

## Core Components

### Data Structures

#### LLChat (`firestorm/indra/llui/llchat.h`)

Core chat message structure:

```cpp
class LLChat
{
public:
    std::string     mText;          // UTF-8 message content
    std::string     mFromName;      // Sender display name
    LLUUID          mFromID;        // Sender UUID
    EChatSourceType mSourceType;    // CHAT_SOURCE_AGENT, _OBJECT, _SYSTEM
    EChatType       mChatType;      // CHAT_TYPE_WHISPER, _NORMAL, _SHOUT, etc.
    EChatAudible    mAudible;       // CHAT_AUDIBLE_FULLY, _BARELY, _NOT
    LLVector3       mPosAgent;      // Sender position
    std::string     mTimeStr;       // Formatted timestamp
    LLUUID          mSessionID;     // IM session (if applicable)
    // ... additional fields
};
```

#### Chat Types (`firestorm/indra/llcommon/llchat.h`)

```cpp
enum EChatType {
    CHAT_TYPE_WHISPER = 0,
    CHAT_TYPE_NORMAL = 1,
    CHAT_TYPE_SHOUT = 2,
    CHAT_TYPE_OOC = 5,      // Out of character (Firestorm)
    // ... others
};

enum EChatSourceType {
    CHAT_SOURCE_SYSTEM = 0,
    CHAT_SOURCE_AGENT = 1,
    CHAT_SOURCE_OBJECT = 2,
    CHAT_SOURCE_UNKNOWN = 3,
    CHAT_SOURCE_REGION = 4,
};
```

### IM Session Management

#### LLIMModel (`firestorm/indra/newview/llimview.h`)

Singleton managing all IM sessions:

```cpp
class LLIMModel : public LLSingleton<LLIMModel>
{
public:
    // Session types
    enum EType { P2P_SESSION, GROUP_SESSION, ADHOC_SESSION };

    // Signals
    typedef boost::signals2::signal<void(const LLSD&)> session_signal_t;
    session_signal_t mNewMsgSignal;         // New message received
    session_signal_t mNoUnreadMsgsSignal;   // Messages marked read

    // Session access
    LLIMSession* findIMSession(const LLUUID& session_id);
    void addMessage(const LLUUID& session_id, /* ... */);

    // Callbacks
    boost::signals2::connection addNewMsgCallback(const slot_type& cb);
};
```

#### LLIMSession

Per-conversation session data:

```cpp
class LLIMSession
{
public:
    LLUUID              mSessionID;
    std::string         mName;
    EType               mType;              // P2P, GROUP, ADHOC
    std::list<LLSD>     mMsgs;              // Message history
    LLUUID              mOtherParticipant;  // For P2P
    bool                mHasOfflineMessage;
    // ...
};
```

### Session Observer Pattern

```cpp
class LLIMSessionObserver
{
public:
    virtual void sessionAdded(const LLUUID& session_id,
                              const std::string& name,
                              const LLUUID& other_participant_id,
                              bool has_offline_msg) = 0;
    virtual void sessionActivated(const LLUUID& session_id, ...) = 0;
    virtual void sessionRemoved(const LLUUID& session_id) = 0;
    virtual void sessionIDUpdated(const LLUUID& old_id,
                                  const LLUUID& new_id) = 0;
};
```

---

## Existing APIs

### LLChatBar EventAPI (`firestorm/indra/newview/fsnearbychatbarlistener.cpp`)

**Pump Name:** `LLChatBar`

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `sendChat` | `message` (required), `channel` (default: 0), `type` (default: "normal") | Send nearby chat |

**Type values:** `"whisper"`, `"normal"`, `"shout"`

**Example LLSD:**
```
{'op': 'sendChat', 'message': 'Hello world', 'type': 'normal'}
```

### GroupChat EventAPI (`firestorm/indra/newview/groupchatlistener.cpp`)

**Pump Name:** `GroupChat`

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `startGroupChat` | `group_id` (required) | Open/join group chat |
| `leaveGroupChat` | `group_id` (required) | Leave group chat |
| `sendGroupIM` | `group_id`, `message` (required) | Send group message |

---

## Integration Points

### Signals Available for Hooking

#### Nearby Chat Signal

**Location:** `firestorm/indra/newview/llfloaterimnearbychathandler.cpp`

```cpp
// In LLFloaterIMNearbyChatHandler
typedef boost::signals2::signal<void(const LLSD&)> new_chat_signal_t;
new_chat_signal_t mNewChatSignal;

// Also has an LLEventPump
static LLEventPump* sChatWatcher;
```

#### IM Signals

**Location:** `firestorm/indra/newview/llimview.h`

```cpp
// In LLIMModel
session_signal_t mNewMsgSignal;       // New IM received
session_signal_t mNoUnreadMsgsSignal; // Messages read
```

### Chat Hub

**Location:** `firestorm/indra/newview/fsnearbychathub.h`

Central routing for nearby chat:

```cpp
class FSNearbyChat : public LLSingleton<FSNearbyChat>
{
public:
    void sendChatFromViewer(const std::string& utf8text,
                            EChatType type,
                            bool animate);
};
```

---

## UI Components

### Nearby Chat Floater

**File:** `firestorm/indra/newview/fsfloaternearbychat.h/cpp`

```cpp
class FSFloaterNearbyChat : public LLFloater
{
    FSChatHistory*  mChatHistory;       // Message display
    LLChatEntry*    mInputEditor;       // Text input
    LLComboBox*     mChatTypeCombo;     // Whisper/Normal/Shout
};
```

### IM Container

**File:** `firestorm/indra/newview/fsfloaterimcontainer.h/cpp`

Tabbed container for IM sessions:

```cpp
class FSFloaterIMContainer : public LLMultiFloater,
                             public LLIMSessionObserver
{
    // Implements session lifecycle callbacks
};
```

### Individual IM Floater

**File:** `firestorm/indra/newview/fsfloaterim.h/cpp`

```cpp
class FSFloaterIM : public LLTransientDockableFloater
{
    FSChatHistory*  mChatHistory;
    LLChatEntry*    mInputEditor;
};
```

### Chat History Widget

**File:** `firestorm/indra/newview/fschathistory.h/cpp`

Rich text display for chat:

```cpp
class FSChatHistory : public LLTextEditor
{
    // Formatted message rendering
    // Avatar icons, timestamps, styling
};
```

---

## Chat Logging

### LLLogChat (`firestorm/indra/newview/lllogchat.h`)

File-based chat history:

```cpp
class LLLogChat
{
public:
    static void saveHistory(const std::string& filename,
                           const std::string& from,
                           const LLUUID& from_id,
                           const std::string& line);

    // Async loading
    static void loadChatHistory(const std::string& filename,
                               callback_t callback);

    // Signal for save events
    typedef boost::signals2::signal<void(const LLSD&)> save_history_signal_t;
};
```

**Log format:**
```
[2024/01/15 14:30:45] Avatar Name: Message text here
```

---

## Key Files Reference

### Network/Processing

| File | Purpose |
|------|---------|
| `firestorm/indra/newview/llviewermessage.cpp` | `process_chat_from_simulator()` at line ~2762 |
| `firestorm/indra/newview/llimprocessing.h/cpp` | IM packet processing |
| `firestorm/indra/newview/llstartup.cpp` | Message handler registration |

### Data/Model

| File | Purpose |
|------|---------|
| `firestorm/indra/llui/llchat.h` | LLChat structure definition |
| `firestorm/indra/newview/llimview.h/cpp` | LLIMModel, LLIMMgr, LLIMSession |
| `firestorm/indra/newview/lllogchat.h/cpp` | Chat file logging |

### UI Components

| File | Purpose |
|------|---------|
| `firestorm/indra/newview/fsfloaternearbychat.h/cpp` | Nearby chat window |
| `firestorm/indra/newview/fsfloaterim.h/cpp` | Individual IM window |
| `firestorm/indra/newview/fsfloaterimcontainer.h/cpp` | IM tabs container |
| `firestorm/indra/newview/fschathistory.h/cpp` | Chat display widget |
| `firestorm/indra/llui/llchatentry.h/cpp` | Chat input widget |

### Event APIs

| File | Purpose |
|------|---------|
| `firestorm/indra/newview/fsnearbychatbarlistener.h/cpp` | LLChatBar API |
| `firestorm/indra/newview/groupchatlistener.h/cpp` | GroupChat API |
| `firestorm/indra/newview/llfloaterimnearbychathandler.h/cpp` | Chat notification handler |

### Central Hub

| File | Purpose |
|------|---------|
| `firestorm/indra/newview/fsnearbychathub.h/cpp` | FSNearbyChat singleton |

---

## What Needs Exposure for External Chat Plugin

To fully replace the chat UI with an external application:

### Must Have

1. **Receive all incoming chat** (nearby + IM) via events
2. **Send chat** (nearby + IM) via API calls
3. **List active IM sessions**
4. **Create/close IM sessions**
5. **Access chat history**

### Nice to Have

1. **Typing indicators** (send and receive)
2. **Online/offline status** of contacts
3. **Mute list access**
4. **Chat notification control** (suppress native notifications)

### Already Available

- Send nearby chat: `ChatAPI.sendNearby` (or legacy `LLChatBar.sendChat`)
- Send group IM: `ChatAPI.sendIM` with `group_id` (or legacy `GroupChat.sendGroupIM`)
- Join/leave group: `GroupChat.startGroupChat/leaveGroupChat`
- Receive nearby chat events: `ChatAPI.subscribe` with `events="nearby"` or `"all"`
- Receive IM events: `ChatAPI.subscribe` with `events="im"` or `"all"`
- P2P IM sending: `ChatAPI.sendIM` with `participant_id`
- Session list: returned by `ChatAPI.subscribe`
- Floater visibility control: `ChatAPI.setVisible`

### Still Needs Implementation

- Session lifecycle events (session added/removed)
- History access
