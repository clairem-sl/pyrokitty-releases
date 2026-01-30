# LEAP Extension for Chat Plugin

Implementation plan for extending LEAP to support an external chat application.

## Goal

Enable an Electron (or any external) application to:
1. Receive all chat messages (nearby and IM)
2. Send chat messages
3. Control native chat UI visibility

---

## Phase 1: Create ChatAPIEventAPI

Create a new EventAPI for external chat applications.

**New file:** `indra/newview/pkchateventapi.h`
**New file:** `indra/newview/pkchateventapi.cpp`

```cpp
class PKChatEventAPI : public LLEventAPI
{
public:
    PKChatEventAPI();

private:
    // Operations
    void subscribe(const LLSD& request);
    void sendNearby(const LLSD& request);
    void sendIM(const LLSD& request);
    void setVisible(const LLSD& request);

    // Internal handlers
    void onNearbyChat(const LLSD& chat);
    void onIMMessage(const LLSD& msg);

    boost::signals2::scoped_connection mNearbyChatConnection;
    boost::signals2::scoped_connection mIMConnection;
    F64 mLastNearbyThrottleTime;
};
```

**Pump name:** `ChatAPI`

**Operations:**

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `subscribe` | `reply` (required), `events` ("nearby", "im", "all") | Start receiving chat events on reply pump; response includes active sessions |
| `sendNearby` | `message` (required), `channel` (default=0), `type` ("whisper"/"normal"/"shout") | Send nearby chat (throttled to 1/sec) |
| `sendIM` | `participant_id` or `group_id`, `message` | Send IM (creates session implicitly if needed) |
| `setVisible` | `visible` (bool) | Show/hide all native chat UI |

**Event format (outgoing to plugin):**

```llsd
{
    "type": "nearby" | "im",
    "message": "Hello world",
    "from_name": "Avatar Name",
    "from_id": "<uuid>",
    "session_id": "<uuid>",
    "chat_type": "normal",          // whisper/normal/shout
    "source_type": "agent",         // agent/object/system
    "timestamp": 1705332645,
    "position": [128.0, 128.0, 25.0]
}
```

**Subscribe response includes active sessions:**

```llsd
{
    "sessions": [
        {"session_id": "<uuid>", "name": "Avatar Name", "type": "p2p", "participant_id": "<uuid>"},
        {"session_id": "<uuid>", "name": "Group Name", "type": "group", "group_id": "<uuid>"}
    ]
}
```

### Task 1.1: Hook Nearby Chat Signal

Connect to the nearby chat signal to capture all local chat.

```cpp
// In ChatAPIEventAPI constructor
LLFloaterIMNearbyChatHandler* handler =
    dynamic_cast<LLFloaterIMNearbyChatHandler*>(
        LLNotificationsUI::LLNotificationManager::instance()
            .getHandlerForType(LLChannelManager::NEARBY_CHAT));

if (handler)
{
    mNearbyChatConnection = handler->addNewChatCallback(
        boost::bind(&ChatAPIEventAPI::onNearbyChat, this, _1));
}
```

**Reference:** `indra/newview/llfloaterimnearbychathandler.cpp`

### Task 1.2: Hook IM Signal

Connect to LLIMModel to capture all instant messages.

```cpp
// In ChatAPIEventAPI constructor
mIMConnection = LLIMModel::instance().addNewMsgCallback(
    boost::bind(&ChatAPIEventAPI::onIMMessage, this, _1));
```

**Reference:** `indra/newview/llimview.h`

### Task 1.3: Implement sendIM

Use existing IM infrastructure to send messages. Create session implicitly if needed.

```cpp
void ChatAPIEventAPI::sendIM(const LLSD& request)
{
    LLUUID participant_id = request["participant_id"].asUUID();
    std::string message = request["message"].asString();

    // This creates session if it doesn't exist
    LLIMMgr::instance().addMessage(
        LLIMMgr::computeSessionID(IM_NOTHING_SPECIAL, participant_id),
        participant_id,
        /* ... */);
}
```

**Reference:** `indra/newview/llimview.h` - `LLIMMgr`

### Task 1.4: Implement setVisible

Hide/show all chat-related floaters.

```cpp
void ChatAPIEventAPI::setVisible(const LLSD& request)
{
    bool visible = request["visible"].asBoolean();

    // Nearby chat
    LLFloaterReg::setInstanceVisible("fs_nearby_chat", visible);

    // IM container
    LLFloaterReg::setInstanceVisible("fs_im_container", visible);
}
```

**Reference:** `indra/llui/llfloaterreg.h`

---

## Phase 2: Session Events (Optional)

Broadcast events when sessions are created/removed. Lower priority - the external app can infer sessions from incoming messages.

```llsd
{
    "event": "session_added" | "session_removed",
    "session_id": "<uuid>",
    "name": "Session Name",
    "type": "p2p" | "group",
    "participant_id": "<uuid>"
}
```

---

## Implementation Checklist

### New Files to Create

- [x] `indra/newview/pkchateventapi.h` - Created
- [x] `indra/newview/pkchateventapi.cpp` - Created (with static instance for auto-registration)

### Files to Modify

- [x] `indra/newview/CMakeLists.txt` - Added new source files
- [x] ~~`indra/newview/llappviewer.cpp`~~ - Not needed (uses static initialization)
- [x] ~~`indra/newview/llfloaterimnearbychathandler.cpp`~~ - Signal already exposed
- [x] ~~`indra/newview/llimview.cpp`~~ - Signal already exposed

### Testing

- [ ] Create test LEAP script (Python) to verify events
- [ ] Test nearby chat receive (subscribe)
- [ ] Test IM receive (subscribe)
- [ ] Test nearby chat send (existing ChatAPIBar API)
- [ ] Test IM send (sendIM)
- [ ] Test UI visibility (setVisible)
- [ ] Test with Electron prototype

---

## API Summary

### ChatAPI (new)

| Operation | Direction | Description |
|-----------|-----------|-------------|
| `subscribe` | → viewer | Start receiving events; returns active sessions |
| `sendNearby` | → viewer | Send nearby chat (whisper/normal/shout) |
| `sendIM` | → viewer | Send IM (creates session if needed) |
| `setVisible` | → viewer | Show/hide native chat UI |
| (event) | ← viewer | Chat message broadcast |

### ChatAPIBar (existing)

| Operation | Direction | Description |
|-----------|-----------|-------------|
| `sendChat` | → viewer | Send nearby chat |

### GroupChat (existing)

| Operation | Direction | Description |
|-----------|-----------|-------------|
| `sendGroupIM` | → viewer | Send group message |

---

## Future Considerations

### Security

- LEAP plugins run with full viewer access
- Consider sandboxing options for untrusted plugins
- Rate limiting on chat send operations (already exists in ChatAPIBar)

### Performance

- High-volume chat scenarios (busy regions, large groups)
- Consider buffering/batching for event broadcasts

### Multi-Plugin Support

- Currently only one LEAP plugin per `--leap` argument
- Consider plugin registry for multiple chat handlers
- Priority system for event consumers

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall viewer architecture
- [CHAT-SYSTEM.md](./CHAT-SYSTEM.md) - Detailed chat system docs
- [LEAP README](../../../leap/README.md) - LEAP protocol documentation
- `indra/llcommon/lleventapi.h` - LLEventAPI base class
- `indra/newview/fsnearbychatbarlistener.cpp` - Example EventAPI implementation
