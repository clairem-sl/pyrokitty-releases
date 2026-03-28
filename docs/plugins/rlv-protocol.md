# RLV/RLVa Protocol Specification

## Overview

RLV (Restrained Love Viewer) / RLVa (Restrained Love Viewer alternate) is a protocol that allows in-world LSL scripts to impose restrictions on and control the Second Life viewer's behavior. Originally created by Marine Kelley for roleplay, it has become a general-purpose mechanism for scripted viewer control used across many applications (games, roleplay HUDs, immersive experiences).

**Key concept**: an in-world script attached to an avatar sends commands to the viewer via `llOwnerSay()`, and the viewer voluntarily enforces those commands. There is no server-side enforcement -- it is entirely a viewer-side protocol.

## RLV vs. RLVa

| | RLV | RLVa |
|---|---|---|
| **Author** | Marine Kelley | Kitty Barnett |
| **Spec version** | 2.9.28 | 3.4.3 |
| **Architecture** | Tightly coupled to viewer fork | Modular, clean separation of concerns |
| **Adoption** | Marine Kelley's viewer | Firestorm, Catznip, others |

RLVa implements the RLV spec for script compatibility but extends it with visual effects (`@setsphere`, `@setoverlay`), behaviour modifiers, distance-based IM restrictions, and more granular camera control. Firestorm ships RLVa.

## Command Transport

Commands travel from in-world scripts to the viewer via `llOwnerSay()` -- a chat function on channel 0 that only the object's owner can see. The viewer intercepts these messages before displaying them.

**Reception conditions** (from Firestorm `llviewermessage.cpp:3135`):
- RLVa must be enabled in viewer settings
- Message must start with `@` (`RLV_CMD_PREFIX`)
- Chat type must be `CHAT_TYPE_OWNER` (llOwnerSay)
- If the object is a temp attachment, temp attachment support must be enabled

## Command Syntax

```
@<behaviour>[:<option>]=<param>[,<behaviour>[:<option>]=<param>,...]
```

Multiple commands can be comma-separated in a single message.

| Component | Description | Examples |
|-----------|-------------|---------|
| `behaviour` | Command name | `sendchat`, `tploc`, `detach`, `fly` |
| `option` | Optional modifier/target | Attachment point, UUID, folder path |
| `param` | Command type | See below |

### Parameter Types

| Param | Aliases | Type | Effect |
|-------|---------|------|--------|
| `n` | `add` | `RLV_TYPE_ADD` | Activate/add restriction |
| `y` | `rem` | `RLV_TYPE_REMOVE` | Remove/deactivate restriction |
| `force` | | `RLV_TYPE_FORCE` | Force an action immediately |
| `<integer>` | | `RLV_TYPE_REPLY` | Query -- reply on this chat channel |

Special case: `@clear` clears all restrictions from the sending object.

### Examples

```
@sendchat=n              -- Prevent user from sending chat
@sendchat=y              -- Remove the chat restriction
@tpto:128/128/50=force   -- Force teleport to coordinates
@getattach=2222          -- Reply on channel 2222 with attachment info
@detach:chest=n          -- Prevent detaching from chest point
@sendchat=n,fly=n        -- Multiple restrictions in one message
@clear                   -- Clear all restrictions from this object
```

### Reply Mechanism

When a script sends a reply-type command (`@command=<channel>`), the viewer replies by sending chat on the specified channel via the equivalent of `llSay()`. The script listens on that channel. Channel must be > 0 and cannot be the debug channel (2147483647).

## Command Categories (~163 behaviours)

### Attachment & Outfit Control
| Command | Type | Description |
|---------|------|-------------|
| `@detach[:<point>]=n/y` | Restrict | Lock/unlock attachments at specific points |
| `@addattach[:<point>]=n/y` | Restrict | Prevent attaching to points |
| `@remattach[:<point>]=n/y` | Restrict | Prevent detaching from points |
| `@addoutfit[:<layer>]=n/y` | Restrict | Lock clothing layers (prevent wear) |
| `@remoutfit[:<layer>]=n/y` | Restrict | Lock clothing layers (prevent remove) |
| `@sharedwear=n/y` | Restrict | Block wear from shared (#RLV) folders |
| `@sharedunwear=n/y` | Restrict | Block unwear from shared folders |
| `@unsharedwear=n/y` | Restrict | Block wear from non-shared folders |
| `@unsharedunwear=n/y` | Restrict | Block unwear from non-shared folders |
| `@attachthis[:<folder>]=n/y` | Restrict | Lock specific #RLV folder items |
| `@detachthis[:<folder>]=n/y` | Restrict | Lock specific #RLV folder items |
| `@detachme=force` | Force | Force-detach the commanding object |
| `@attach:<folder>=force` | Force | Force wear from #RLV folder |
| `@detach:<folder>=force` | Force | Force remove from #RLV folder |

### Communication
| Command | Type | Description |
|---------|------|-------------|
| `@sendchat=n/y` | Restrict | Block outgoing nearby chat |
| `@chatwhisper=n/y` | Restrict | Block whisper |
| `@chatnormal=n/y` | Restrict | Block normal chat |
| `@chatshout=n/y` | Restrict | Block shout |
| `@sendchannel[:<ch>]=n/y` | Restrict | Block sending on specific channels |
| `@sendchannel_except[:<ch>]=n/y` | Restrict | Block all channels except specified |
| `@recvchat[:<uuid>]=n/y` | Restrict | Block receiving nearby chat |
| `@recvchatfrom:<uuid>=n/y` | Restrict | Block chat from specific avatar |
| `@recvemote[:<uuid>]=n/y` | Restrict | Block receiving emotes |
| `@recvemotefrom:<uuid>=n/y` | Restrict | Block emotes from specific avatar |
| `@redirchat:<channel>=n/y` | Restrict | Redirect received chat to channel |
| `@rediremote:<channel>=n/y` | Restrict | Redirect emotes to channel |
| `@emote=n/y` | Restrict | Restrict emotes |
| `@sendim[:<uuid>]=n/y` | Restrict | Block sending IMs |
| `@sendimto:<uuid>=n/y` | Restrict | Block IMs to specific avatar |
| `@recvim[:<uuid>]=n/y` | Restrict | Block receiving IMs |
| `@recvimfrom:<uuid>=n/y` | Restrict | Block IMs from specific avatar |
| `@startim[:<uuid>]=n/y` | Restrict | Prevent starting new IM sessions |
| `@sendgesture=n/y` | Restrict | Block gesture playback |

### Movement & Teleportation
| Command | Type | Description |
|---------|------|-------------|
| `@fly=n/y` | Restrict | Prevent flying |
| `@jump=n/y` | Restrict | Prevent jumping |
| `@sit[:<uuid>]=n/y` | Restrict | Prevent sitting (or force sit on uuid) |
| `@unsit=n/y` | Restrict | Prevent standing up |
| `@sitground=n/y` | Restrict | Prevent sitting on ground |
| `@sittp=n/y` | Restrict | Prevent sit-teleport (distance limited) |
| `@standtp=n/y` | Restrict | Teleport user back when standing |
| `@alwaysrun=n/y` | Restrict | Lock running mode |
| `@temprun=n/y` | Restrict | Lock temporary run |
| `@tplm=n/y` | Restrict | Prevent teleport to landmark |
| `@tploc=n/y` | Restrict | Prevent teleport to location |
| `@tplocal=n/y` | Restrict | Prevent local/double-click teleport |
| `@tplure[:<uuid>]=n/y` | Restrict | Block teleport offers |
| `@tprequest[:<uuid>]=n/y` | Restrict | Block teleport requests |
| `@accepttp[:<uuid>]=n/y` | Restrict | Force auto-accept teleport offers |
| `@accepttprequest[:<uuid>]=n/y` | Restrict | Force auto-accept teleport requests |
| `@tpto:<x>/<y>/<z>=force` | Force | Force teleport to coordinates |
| `@sit:<uuid>=force` | Force | Force sit on object |
| `@unsit=force` | Force | Force stand up |
| `@setgroup:<uuid>=force` | Force | Force active group change |

### Information Display
| Command | Type | Description |
|---------|------|-------------|
| `@shownames[:<uuid>]=n/y` | Restrict | Hide/anonymize avatar names |
| `@shownametags=n/y` | Restrict | Hide name tags |
| `@shownearby=n/y` | Restrict | Hide nearby avatar list |
| `@showloc=n/y` | Restrict | Hide location info (region, coords) |
| `@showminimap=n/y` | Restrict | Hide minimap |
| `@showworldmap=n/y` | Restrict | Hide world map |
| `@showinv=n/y` | Restrict | Hide inventory |
| `@showhovertext=n/y` | Restrict | Hide hover text |
| `@showhovertexthud=n/y` | Restrict | Hide HUD hover text |
| `@showhovertextworld=n/y` | Restrict | Hide world hover text |
| `@showself=n/y` | Restrict | Hide user's own avatar |
| `@showselfhead=n/y` | Restrict | Hide user's own head |

### Camera Control
| Command | Type | Description |
|---------|------|-------------|
| `@setcam=n/y` | Restrict | Give exclusive camera control to object |
| `@setcam_avdistmin:<val>=force` | Force | Min avatar silhouette distance |
| `@setcam_avdistmax:<val>=force` | Force | Max avatar silhouette distance |
| `@setcam_origindistmin:<val>=force` | Force | Min camera distance from origin |
| `@setcam_origindistmax:<val>=force` | Force | Max camera distance from origin |
| `@setcam_eyeoffset:<x>/<y>/<z>=force` | Force | Camera eye offset |
| `@setcam_focusoffset:<x>/<y>/<z>=force` | Force | Camera focus offset |
| `@setcam_focus:<uuid>=force` | Force | Force focus on object/position |
| `@setcam_fov:<val>=force` | Force | Set field of view |
| `@setcam_fovmin:<val>=force` | Force | Min FOV limit |
| `@setcam_fovmax:<val>=force` | Force | Max FOV limit |
| `@setcam_mouselook=n/y` | Restrict | Prevent mouselook |
| `@setcam_textures:<uuid>=force` | Force | Replace all world textures |
| `@setcam_unlock=n/y` | Restrict | Force camera to follow avatar |
| `@setcam_mode:<mode>=force` | Force | Switch mouselook/third-person |

### Visual Effects (RLVa Extension)
| Command | Type | Description |
|---------|------|-------------|
| `@setsphere=n/y` | Restrict | Vision sphere (blur, color with distance falloff) |
| `@setoverlay=n/y` | Restrict | Screen overlay texture with alpha/tint |
| `@setoverlay_touch=n/y` | Restrict | Overlay alpha controls click-through |
| `@setoverlay_tween=n/y` | Restrict | Animated transitions for overlay |

### World Interaction
| Command | Type | Description |
|---------|------|-------------|
| `@edit=n/y` | Restrict | Block editing objects |
| `@editattach=n/y` | Restrict | Block editing attachments |
| `@editobj:<uuid>=n/y` | Restrict | Block editing specific object |
| `@editworld=n/y` | Restrict | Block editing world objects |
| `@rez=n/y` | Restrict | Block rezzing objects |
| `@fartouch=n/y` | Restrict | Limit touch distance |
| `@interact=n/y` | Restrict | Block all world interaction |
| `@touchworld=n/y` | Restrict | Block touching world objects |
| `@touchattach=n/y` | Restrict | Block touching attachments |
| `@touchattachself=n/y` | Restrict | Block touching own attachments |
| `@touchattachother=n/y` | Restrict | Block touching others' attachments |
| `@touchhud=n/y` | Restrict | Block touching HUDs |
| `@touchall=n/y` | Restrict | Block all touch |
| `@touchme=n/y` | Restrict | Block touching the RLV object |
| `@buy=n/y` | Restrict | Block buying |
| `@pay=n/y` | Restrict | Block paying |

### Viewer Control
| Command | Type | Description |
|---------|------|-------------|
| `@setdebug=n/y` | Restrict | Block debug setting changes |
| `@setenv=n/y` | Restrict | Block environment changes |
| `@acceptpermission=n/y` | Restrict | Auto-accept script permissions |
| `@allowidle=n/y` | Restrict | Control idle behaviour |
| `@adjustheight:<val>=force` | Force | Adjust avatar height offset |
| `@viewtransparent=n/y` | Restrict | Block highlight transparent |
| `@viewwireframe=n/y` | Restrict | Block wireframe rendering |
| `@viewnote=n/y` | Restrict | Block viewing notecards |
| `@viewscript=n/y` | Restrict | Block viewing scripts |
| `@viewtexture=n/y` | Restrict | Block viewing textures |

### Query/Reply Commands
| Command | Description |
|---------|-------------|
| `@version=<ch>` | Get RLV version string |
| `@versionnew=<ch>` | Get version (new format) |
| `@versionnum=<ch>` | Get numeric version |
| `@getattach[:<point>]=<ch>` | Query worn attachments |
| `@getattachnames[:<point>]=<ch>` | Query attachment point names |
| `@getaddattachnames[:<point>]=<ch>` | Query unlocked-for-add points |
| `@getremattachnames[:<point>]=<ch>` | Query unlocked-for-remove points |
| `@getoutfit[:<layer>]=<ch>` | Query worn clothing layers |
| `@getoutfitnames=<ch>` | Query clothing layer names |
| `@findfolder:<pattern>=<ch>` | Search #RLV folder names |
| `@findfolders:<pattern>=<ch>` | Search #RLV (multiple results) |
| `@getpath[:<option>]=<ch>` | Get #RLV path for worn item |
| `@getpathnew[:<option>]=<ch>` | Get #RLV path (new format) |
| `@getinv[:<folder>]=<ch>` | Get shared inventory contents |
| `@getinvworn[:<folder>]=<ch>` | Get worn status in folder |
| `@getgroup=<ch>` | Get active group UUID |
| `@getsitid=<ch>` | Get UUID of object sat on |
| `@getcommand[:<filter>]=<ch>` | Query available commands |
| `@getstatus[:<filter>]=<ch>` | Get active restrictions |
| `@getstatusall[:<filter>]=<ch>` | Get all active restrictions |
| `@getheightoffset=<ch>` | Get height offset |

### Environment Control (Extension)
| Command | Description |
|---------|-------------|
| `@getenv_<setting>=<ch>` | Read WindLight/EEP setting |
| `@setenv_<setting>:<value>=force` | Write WindLight/EEP setting |
| `@get_<debug>=<ch>` | Read viewer debug setting (allowlisted) |
| `@set_<debug>:<value>=force` | Write viewer debug setting (allowlisted) |

## Shared Inventory (#RLV Folder)

A special folder named `#RLV` in the user's inventory serves as the interface for scripted outfit management:

- **Force-wear**: `@attach:subfolder/path=force`
- **Force-remove**: `@detach:subfolder/path=force`
- **Query contents**: `@getinv=<channel>`
- **Query worn status**: `@getinvworn=<channel>`

**Folder naming conventions:**
- `.` prefix = hidden folder (not listed in queries)
- `~` prefix = "put inventory" target folder
- `nostrip` flag in folder name = folder cannot be force-stripped

## Restriction Tracking

Multiple objects can independently impose restrictions. The system uses reference counting:

- **Object map**: Each scripted object's UUID maps to its set of active restrictions
- **Behaviour counters**: Array of 163 counters -- fast O(1) checks for "is this restricted?"
- **Exception map**: Allows exceptions (e.g., "block all IMs except from UUID X")
- **Modifier values**: Sorted list per modifier type; the "winning" value (first after sort) is active
- `@clear` removes all restrictions from the sending object only
- Removing the object from the avatar clears its restrictions
