# Firestorm RLVa Implementation Analysis

## Overview

Firestorm implements RLVa (Kitty Barnett's clean-room reimplementation) as ~16,800 lines of core code across 14 source files, with hooks in 110+ additional viewer files. The architecture uses a three-tier pattern: internal state tracking, a public API facade, and direct hot-path checks.

## Core File Inventory

| File | Lines (h/cpp) | Purpose |
|------|---------------|---------|
| `rlvhandler.h/cpp` | 329 / 4,029 | Central singleton -- command processing, state, behaviour checking |
| `rlvhelper.h/cpp` | 766 / 2,121 | Behaviour dictionary, command parsing, template processors |
| `rlvdefines.h` | 533 | All enums (163 behaviours, 30+ modifiers), constants, settings |
| `rlvcommon.h/cpp` | 351 / 948 | Settings, localization, utilities (name filtering, chat filtering) |
| `rlvactions.h/cpp` | 380 / 736 | Public API -- `canFly()`, `canSit()`, `canShowName()`, etc. |
| `rlvlocks.h/cpp` | 707 / 1,311 | Attachment, wearable, and folder lock management |
| `rlvinventory.h/cpp` | 344 / 873 | #RLV shared folder, wear/unwear predicates |
| `rlvenvironment.h/cpp` | 67 / 730 | WindLight/EEP environment scripted control |
| `rlveffects.h/cpp` | 109 / 410 | Vision sphere & screen overlay effects |
| `rlvextensions.h/cpp` | 57 / 278 | Debug setting get/set extension commands |
| `rlvfloaters.h/cpp` | 173 / 843 | RLVa-specific UI (restriction browser, debug) |
| `rlvmodifiers.h` | 142 | Template-based modifier value management |
| `rlvui.h/cpp` | 101 / 483 | UI enabler/disabler (floater filtering, menu toggling) |
| `rlvF.glsl` / `rlvV.glsl` | - | Shaders for texture replacement effect |

**Total**: ~16,821 lines of core RLV code + 32 XML skin/localization files.

## Architecture

### Three-Tier Permission System

```
Tier 1: RlvHandler (Internal State)
  m_Objects     -- map<UUID, RlvObject> tracking restrictions per scripted object
  m_Behaviours  -- int[163] counter array for fast O(1) "is restricted?" checks
  m_Exceptions  -- multimap for per-avatar/per-object exceptions to restrictions
  m_*Locks      -- RlvAttachmentLocks, RlvWearableLocks, RlvFolderLocks

Tier 2: RlvActions (Public Developer API)
  Static convenience functions: canFly(), canSit(), canShowName(), canTeleportToLocation()...
  Used by 100+ viewer files -- shields them from RLV internals

Tier 3: Direct Hot-Path Checks
  Performance-critical code checks gRlvHandler directly
  Example: llvoavatar.cpp checking RLV_BHVR_SHOWSELF
```

### Key Classes

| Class | Role |
|-------|------|
| `RlvHandler` | Central singleton. Processes commands, maintains state, manages object-to-restriction map |
| `RlvCommand` | Parsed command object (`behaviour`, `option`, `param`, type) |
| `RlvObject` | All active restrictions from one scripted object |
| `RlvBehaviourDictionary` | Registry of ~163 behaviours with metadata and processors |
| `RlvBehaviourInfo` | Single behaviour's processor function and flags |
| `RlvBehaviourModifier` | Numeric parameter system (distances, FOV limits, etc.) |
| `RlvActions` | Public API facade for viewer code |
| `RlvAttachmentLocks` | Point-specific attachment locking with REMOVE/ADD masks |
| `RlvWearableLocks` | Clothing layer locking |
| `RlvFolderLocks` | Inventory folder locking |
| `RlvUIEnabler` | Listens for behaviour toggles, proactively enables/disables UI |

### Command Processing Flow

```
1. RECEPTION (llviewermessage.cpp:3135)
   llOwnerSay chat message intercepted
   Check: '@' prefix, CHAT_TYPE_OWNER, RLVa enabled
   Call: gRlvHandler.processCommand(object_uuid, "@fly=n", true)

2. PARSING (rlvhandler.cpp:594)
   Create RlvCommand from string
   Parse: @behaviour[:option]=parameter

3. ROUTING (rlvhandler.cpp:455)
   Route by command type:
     ADD/REM (=n/=y)  -> processAddRemCommand()
     CLEAR             -> processClearCommand()
     FORCE (=force)    -> processForceCommand()
     REPLY (=channel)  -> processReplyCommand()

4. BEHAVIOUR LOOKUP
   RlvBehaviourDictionary::getBehaviourInfo() finds processor
   Check flags: STRICT, EXTENDED, EXPERIMENTAL, BLOCKED

5. HANDLER EXECUTION
   Behaviour-specific handler runs
   Modifiers processed if applicable

6. STATE UPDATE
   m_Objects map updated with new restriction
   m_Behaviours counter incremented/decremented
   Locks registered if attachment/wearable restriction
   Exceptions added if parameterized

7. SIGNAL EMISSION
   m_OnBehaviour signal fired (restriction added/removed)
   m_OnCommand signal fired (any command processed)
   RlvUIEnabler reacts to toggle UI elements
```

### Extensibility Points

1. **RlvExtCommandHandler** -- register custom command handlers
2. **Signal system** (boost::signals2):
   - `m_OnBehaviour` -- when restriction added/removed
   - `m_OnCommand` -- when any command processed
3. **Behaviour dictionary** -- add custom behaviours at runtime
4. **setBehaviourCallback()** -- external systems subscribe to changes

## Hook Points by Subsystem

### Movement & Avatar Control (`llagent.cpp`)
- `canFly()` at movement time
- `canJump()` at button press
- Sitting: `@sit`, `@unsit`, `@sitground`, `@sittp` (distance modifier)
- Typing: `canSendTypingStart()`
- Idle: `@allowidle`
- Running: `@alwaysrun`, `@temprun`

### Camera (`llviewercamera.cpp`, `llagentcamera.cpp`)
- Mouselook: `@setcam_mouselook`
- Distance limits: `@setcam_avdistmin/max`, `@setcam_origindistmin/max`
- FOV limits: `@setcam_fovmin/max`
- Presets: `@setcam_eyeoffset`, `@setcam_focusoffset`
- Avatar visibility: `@showself`, `@showselfhead`

### Communication (`llviewermessage.cpp`, `llimview.cpp`, `fsfloaternearbychat.cpp`)
- Chat: `@sendchat`, `@recvchat`, `@recvchatfrom`, `@redirchat`
- Emotes: `@emote`, `@recvemote`, `@recvemotefrom`
- Channels: `@sendchannel`, `@chatwhisper/normal/shout`
- IMs: `@sendim`, `@sendimto`, `@recvim`, `@recvimfrom`, `@startim`
- Gestures: `@sendgesture`
- Names: `@shownames` (via `RlvUtil::filterNames()`)
- Locations: `@showloc` (via `RlvUtil::filterLocation()`)

### Teleportation (`llagent.cpp:5193+, 5328+, 5479+`)
- Acceptance: `@accepttp`, `@accepttprequest`
- Types: `@tplm`, `@tploc`, `@tplocal`, `@tplure`, `@tprequest`
- Permission checks: `RlvActions::canTeleportToLocal()`, `canTeleportToLocation()`
- Forced TP: `@tpto:x,y,z=force` via `RlvUtil::forceTp()`
- Distance limits: `@sittp`, `@standtp`

### Inventory & Appearance (`llappearancemgr.cpp`, `llattachmentsmgr.cpp`)
- Wearing: `@addoutfit`, `@remoutfit`
- Attachments: `@addattach`, `@remattach`, `@detach`
- Shared wear: `@sharedwear`, `@sharedunwear`
- Locks: `gRlvAttachmentLocks.hasLockedAttachmentPoint()`
- Folder locks: `RlvFolderLocks::instance().isLockedFolder()`

### World Interaction (`lltoolpie.cpp`, `lltool*.cpp`)
- Touch: `@touchworld`, `@touchhud`, `@touchall`, `@touchme`
- Editing: `@editworld`, `@editobj`, `@editattach`
- Interaction: `@interact`
- Distance: `@fartouch` (with modifier)
- Building: `@rez`
- Economy: `@buy`, `@pay`

### UI Panels (`llpanelpeople.cpp`, `llnavigationbar.cpp`, `llfloaterworldmap.cpp`)
- Inventory: `@showinv`
- Maps: `@showminimap`, `@showworldmap`
- Location: `@showloc`
- Names: `@shownames`, `@shownametags`
- Nearby: `@shownearby`
- Hover text: `@showhovertext`, `@showhovertexthud`, `@showhovertextworld`

### Profile & Identity (`llpanelprofile.cpp`, `llinspectavatar.cpp`)
- `canShowName(context, avatar_id)` -- multi-context name filtering
- Profile viewing blocked by name restrictions
- Avatar list filtering

### Rendering & Effects (`pipeline.cpp`, `llface.cpp`, `llenvironment.cpp`)
- WindLight: `@setenv`
- Overlay: `@setsphere`, `@setoverlay`, `@setoverlay_tween`
- Transparency: `@viewtransparent`
- Wireframe: `@viewwireframe`
- Texture replacement shader: `rlvF.glsl`, `rlvV.glsl`

### Permissions (`llnotificationscripthandler.cpp`)
- Permission dialogs: `@acceptpermission`
- Script question filtering

### Drag & Drop (`lltooldraganddrop.cpp`)
- Item giving: `RlvActions::canGiveInventory()`
- Rezzing: `@rez`, `@interact` checks

## All Files with RLV References (110+)

**Core systems (must know RLV):**
- `llagent.cpp` -- movement, sitting, teleportation
- `llvoavatar.cpp` -- avatar visibility
- `llappearancemgr.cpp` -- wearing/unwearing
- `llattachmentsmgr.cpp` -- attachment management
- `llviewermessage.cpp` -- chat reception & command entry point
- `llimview.cpp` / `llimprocessing.cpp` -- IM handling

**UI (panels, floaters, menus):**
- Inventory: `llinventorybridge.cpp`, `llinventorypanel.cpp`, `llinventoryfunctions.cpp`
- Chat: `fsfloaternearbychat.cpp`, `fschathistory.cpp`, `llchathistory.cpp`
- People: `llpanelpeople.cpp`, `llavatarlist.cpp`, `llfloaterimcontainer.cpp`
- Build tools: `lltoolpie.cpp`, `lltooldraganddrop.cpp`, `lltoolselect.cpp`, `lltoolgrab.cpp`
- Floaters: preferences, pay, properties, inspect, world map, avatar picker
- Panels: profile, places, permissions, wearing, outfit edit
- Menus: `llviewermenu.cpp`
- Firestorm-specific: `fsradar.cpp`, `fsareasearch.cpp`, `fsfloatercontacts.cpp`, `fsdiscordconnect.cpp`

**Rendering:**
- `pipeline.cpp`, `llface.cpp`
- `llviewercamera.cpp`, `llagentcamera.cpp`
- `llvoavatarself.cpp`, `llvovolume.cpp`

## Design Qualities

The RLVa implementation is well-engineered:
- **Clean separation** -- all core code in `rlv*.h/cpp` files
- **Stable API** -- `RlvActions` insulates 100+ files from internals
- **Data-driven** -- behaviour dictionary rather than giant switch statements
- **Template-based** -- type-safe command processors
- **Signal-based** -- `boost::signals2` change notification
- **Reference-counted** -- multiple objects independently add/remove same restriction
- **Modular** -- effects, environment, locks, inventory each have their own files
