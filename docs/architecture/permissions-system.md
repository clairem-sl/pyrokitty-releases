# Permissions System Architecture

## Overview

The viewer has a client-side permissions system that determines what actions are allowed on objects. This can be overridden with "god mode" for development/debugging.

## Key Files

- `firestorm/indra/newview/llviewerobject.cpp` - Permission check implementations
- `firestorm/indra/newview/llviewercontrol.h` - God mode defines
- `firestorm/indra/newview/llagent.cpp` - Agent god level management
- `firestorm/indra/newview/llviewermenu.cpp` - God mode menu handlers

## Permission Methods

Located in `llviewerobject.cpp`:

| Method | Purpose |
|--------|---------|
| `permYouOwner()` | Check if agent owns the object |
| `permModify()` | Check if agent can modify the object |
| `permCopy()` | Check if agent can copy the object |
| `permMove()` | Check if agent can move the object |
| `permTransfer()` | Check if agent can transfer the object |

## God Mode Options

### HACKED_GODLIKE_VIEWER (Always On)

Define in `firestorm/indra/newview/llviewercontrol.h`:
```cpp
#define HACKED_GODLIKE_VIEWER
```

Effect: All permission methods return `true` for all objects.

Implementation in `llviewerobject.cpp`:
```cpp
bool LLViewerObject::permModify() const
{
    if (isRootEdit())
    {
#ifdef HACKED_GODLIKE_VIEWER
        return true;  // Always allow
#else
        // ... normal permission checks
#endif
    }
}
```

### TOGGLE_HACKED_GODLIKE_VIEWER (Toggleable)

Define in `firestorm/indra/newview/llviewercontrol.h`:
```cpp
#define TOGGLE_HACKED_GODLIKE_VIEWER
```

Uses global variable `gHackGodmode` to toggle at runtime.

**Limitation**: Only works on SL Beta grids due to check:
```cpp
if (LLGridManager::getInstance()->isInSLBeta()
    && (gAgent.getGodLevel() >= GOD_MAINTENANCE))
{
    return true;
}
```

### Choosing Between Options

| Option | Pros | Cons |
|--------|------|------|
| `HACKED_GODLIKE_VIEWER` | Always works, simple | Can't disable without rebuild |
| `TOGGLE_HACKED_GODLIKE_VIEWER` | Can toggle on/off | Only works on beta grids by default |

## God Levels

Defined in `firestorm/indra/llcommon/indra_constants.h`:

```cpp
const U8 GOD_NOT = 0;
const U8 GOD_LIKE = 1;
const U8 GOD_MAINTENANCE = 200;
const U8 GOD_FULL = 255;
```

## UI Panels and Permissions

### Texture Panel (Build Floater)

Files:
- `firestorm/indra/newview/llpanelface.cpp` - LL texture panel
- `firestorm/indra/newview/fspanelface.cpp` - Firestorm texture panel

The texture panel's `updateUI()` method checks permissions:
```cpp
if (objectp
    && objectp->getPCode() == LL_PCODE_VOLUME
    && objectp->permModify())  // <-- Permission check
{
    // Show editable UI
}
else
{
    clearCtrls();  // Disable all controls
}
```

To show texture tab regardless of ownership, remove `permModify()` check:
```cpp
if (objectp
    && objectp->getPCode() == LL_PCODE_VOLUME)
{
    bool editable = objectp->permModify() && !objectp->isPermanentEnforced();
    // UI is shown, but controls disabled when !editable
}
```

## Tab Visibility in Build Floater

In `llfloatertools.cpp`:
```cpp
mTab->enableTabButton(idx_features, all_volume);
mTab->enableTabButton(idx_face, all_volume);      // Texture tab
mTab->enableTabButton(idx_contents, all_volume);
```

The `all_volume` check is for object type (volume vs. other), not permissions.
