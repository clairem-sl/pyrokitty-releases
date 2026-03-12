# Object Flip (Drag Past Zero) - Implementation Notes

## Overview

When a user drags a face scale handle past zero in the build tool, the object flips
(mirrors) on that axis and then grows back. This is similar to Blender's negative
dimension behavior. Every zero crossing in either direction toggles the mirror.

The mirror itself is implemented via `PKMirrorFlags` (per-axis mirror flags baked
into vertex buffers at `getGeometryVolume()` time). This document covers the
**drag-past-zero** interaction specifically.

## Architecture

### Key Files

| File                | Role                                                     |
| ------------------- | -------------------------------------------------------- |
| `llmanipscale.cpp`  | Drag detection, flip triggering, scale/position math     |
| `llmanipscale.h`    | `mPKMirrorFlipped`, `mPKMirrorDirtyDuringDrag` members   |
| `pkmirrorflags.cpp` | Mirror flag cache, notecard persistence                  |
| `llvovolume.h/.cpp` | `mPKMirrorFlags`, lazy-load from cache, geometry rebuild |
| `llface.cpp`        | `getGeometryVolume()` applies mirror to vertex buffer    |

### Data Flow

```
dragFace() detects zero crossing (either direction)
  -> toggles mirror flag via PKMirrorFlags::setFlags(id, flags, nullptr)
  -> sets mPKMirrorFlags on LLVOVolume via setPKMirrorFlags()
  -> markRebuild(REBUILD_ALL) schedules geometry rebuild
  -> getGeometryVolume() reads flags, negates mat_vert rows, reverses winding

stretchFace() computes position offset
  -> if mPKMirrorFlipped: places object on OTHER side of anchored face
  -> if not flipped: normal position formula

handleMouseUp()
  -> if mPKMirrorDirtyDuringDrag:
     -> flags != 0: persistNotecard() creates notecard in object inventory
     -> flags == 0: clearFlags() removes notecard from object inventory
```

## Scale Manipulation Pipeline

Understanding how `dragFace()` and `stretchFace()` interact is critical.

### Normal (no flip) flow:

1. `dragFace()` computes `dist_along_scale_line` (dot product of mouse-to-center
   with scale direction). Positive = normal, negative = past zero.
2. Snap code clamps `dist_along_scale_line` between `min_drag_dist` and `max_drag_dist`
3. `drag_delta` is computed and passed to `stretchFace()`
4. `stretchFace()` computes `raw_desired_scale = savedScale + desired_delta_size`
5. Scale is clamped to `[min_scale, max_scale]` and applied
6. Position offset: `axis * (0.5 * desired_delta_size)` keeps anchored face fixed

### Flip flow (drag past zero):

1. `dragFace()` detects zero crossing (positive→negative OR negative→positive)
2. Mirror flag is toggled on all selected objects
3. `mPKMirrorFlipped` tracks whether mouse is currently on the negative side
4. **Negate block** (negative side only): `dist_along_scale_line` is negated to
   positive, `drag_delta` and `scale_center_to_mouse` are recomputed
5. Snap code sees a positive distance and works normally
6. `stretchFace()` receives a valid positive delta, scale grows proportionally
7. **Position**: uses `-(savedScale + desired_scale) * 0.5` to place object on the
   opposite side of the anchored face, creating a smooth visual transition

## Key Variables

- **`mScaleCenter`**: For non-uniform scaling, this is the **opposite face** from
  the one being dragged. For uniform, it's the bbox center.
- **`mScaleDir`**: Unit vector from `mScaleCenter` toward the dragged face.
- **`dist_along_scale_line`**: Dot product of (mouse - mScaleCenter) with mScaleDir.
  Goes negative when mouse crosses to the other side of mScaleCenter.
- **`mPKMirrorFlipped`**: True when mouse is on the negative side of mScaleCenter.
  Set true on positive→negative crossing, set false on negative→positive crossing.
  Both crossings toggle the mirror flag — this variable only tracks which SIDE the
  mouse is on (needed for the negate block and position formula).
- **`mPKMirrorDirtyDuringDrag`**: True if ANY flip happened during this drag.
  Never reset until `handleMouseUp`. Used to trigger notecard persistence.

## Bidirectional Flip Logic

Every zero crossing toggles the mirror, regardless of direction:

```
positive → negative:  toggle mirror flag, set mPKMirrorFlipped = true
negative → positive:  toggle mirror flag, set mPKMirrorFlipped = false
```

This means dragging back and forth across zero rapidly toggles the mirror each time,
which feels natural (like Blender). The `mPKMirrorFlipped` flag does NOT track
the mirror state — it tracks which side of zero the mouse is on, controlling:

- The **negate block**: only fires when mouse is on negative side
- The **position formula** in `stretchFace()`: uses opposite-side formula when negative

## Position After Flip

In non-uniform scaling, one face is anchored at `mScaleCenter`. The position formula
ensures the object appears on the correct side of that anchor:

```
Normal:  delta_pos = axis * (desired_delta_size * 0.5)
Flipped: delta_pos = axis * (-(savedScale + desired_scale) * 0.5)
```

The flipped formula places the object center on the OTHER side of the anchored face.
This creates a smooth visual transition: the object shrinks to zero at the anchor,
then appears on the opposite side growing away from it.

Derivation:

- Anchored face position = savedCenter - axis \* savedScale/2
- After flip, new center = anchoredFace - axis \* desired_scale/2
- Delta from savedCenter = -(savedScale + desired_scale) / 2

## Notecard Persistence

- **During drag**: `setFlags(id, flags, nullptr)` — updates local cache only, no notecard
- **On mouseUp**: checks final flags per object:
    - `flags != 0`: `persistNotecard()` creates/updates `.pk_mirror_XYZ` notecard
    - `flags == 0`: `clearFlags(id, obj)` removes notecard from object inventory

## Lazy-Load on Relog

Mirror flags are loaded from the local XML cache via a lazy-load pattern:

- `LLVOVolume::getPKMirrorFlags()` is non-const
- On first call, it calls `loadPKMirrorFlags()` which reads from `PKMirrorFlags` cache
- Uses `setPKMirrorFlags()` internally so `markRebuild` fires if drawable exists
- `mPKMirrorFlagsLoaded` flag prevents repeated lookups
- Handles the timing race where volumes are created before `PKMirrorFlags::init()`

## Lessons Learned (Bugs We Hit)

### 1. Oscillation from stretchFace reset

**Bug**: Object flickered every frame (flip/unflip/flip/unflip...).

**Root cause**: Both `dragFace()` and `stretchFace()` had flip/reset logic. After
the negate block in `dragFace()` makes `dist_along_scale_line` positive, `stretchFace()`
sees `raw_desired_scale >= min_scale` and resets `mPKMirrorFlipped = false`. Next frame,
`dragFace()` sees `dist < 0 && !flipped` and flips again.

**Fix**: Removed ALL flip detection and reset logic from `stretchFace()`. Only
`dragFace()` manages `mPKMirrorFlipped`. `stretchFace()` only has a safety-net
negate for `raw_desired_scale` (no flag mutations).

### 2. Object stuck at 0.01m after flip

**Bug**: Flip fired correctly but object stayed at minimum scale (0.01m), making
the flip invisible.

**Root cause**: After the flip, `dist_along_scale_line` is negative. The snap code
(`dist_along_scale_line < min_drag_dist`) clamps it to `min_drag_dist`, locking the
scale to minimum.

**Fix**: Added negate block after flip detection. When `mPKMirrorFlipped &&
dist_along_scale_line < 0`, negate the distance, recompute `drag_delta` and
`scale_center_to_mouse`. The snap code then sees a positive distance and the scale
grows proportionally.

### 3. Notecard spam during drag

**Bug**: Hundreds of notecards created in object inventory during a single drag.

**Root cause**: `setFlags()` was called with the object pointer every frame,
triggering `updateNotecard()` on each call.

**Fix**: Pass `nullptr` for the `obj` parameter during drag. `setFlags(id, flags, nullptr)`
updates the local XML cache only, skipping notecard creation. On `handleMouseUp`,
`persistNotecard()` creates one notecard per object.

### 4. Duplicate notecards on relog

**Bug**: New notecard created every time the user logged in.

**Root cause**: `getState()` in the build panel reads cached flags, sets checkboxes,
which triggers `onCommitMirror()` -> `setFlags()`. Without a change check, a new
notecard was created every time.

**Fix**: Early-return in `setFlags()` when `mFlagsCache[id] == flags`.

### 5. Notecard name matching with server suffixes

**Bug**: `removeNotecard()` didn't find existing notecards, causing duplicates.

**Root cause**: SL servers append " 1", " 2" etc to duplicate item names in task
inventory. `notecardNameToFlags()` required exact length == 14, rejecting
".pk_mirror_100 1" (length 16).

**Fix**: Changed to `length >= 14` and validate only characters 11-13 as '0'/'1'.

### 6. Notecard auto-opening on creation

**Bug**: Creating a notecard triggered the notecard preview floater with
"object does not exist in database" error.

**Root cause**: `LLOpenTaskOffer` observer detected the new notecard and called
`open_inventory_offer()`. The notecard was already moved to task inventory and
deleted from agent inventory by the time the preview tried to open it.

**Fix**: Create the temp notecard in `FT_TRASH` instead of `FT_NOTECARD`. Trash is
a "quiet" folder in `LLViewerFolderDictionary` that suppresses `LLOpenTaskOffer`
notifications. The notecard is immediately copied to task inventory and the agent
copy is deleted.

### 7. Even-numbered zero crossings skipped

**Bug**: Dragging back and forth across zero, only odd crossings (1st, 3rd, 5th)
flipped the object. Even crossings (2nd, 4th, 6th) had no effect.

**Root cause**: The negative→positive crossing (return crossing) only reset
`mPKMirrorFlipped` to false without toggling the mirror flag. So only
positive→negative crossings triggered actual flips.

**Fix**: Made both crossing directions toggle the mirror flag. The return crossing
block now iterates all selected objects and XORs the mirror flag, same as the
forward crossing block.

### 8. Position wrong after flip

**Bug**: After flipping, the object's center stayed on the same side of the
anchored face instead of moving to the opposite side.

**Root cause**: `stretchFace()` used the same position formula (`axis * 0.5 *
desired_delta_size`) regardless of flip state. After a flip, the object should
appear on the OTHER side of the anchored face.

**Fix**: When `mPKMirrorFlipped`, use `axis * (-(savedScale + desired_scale) * 0.5)`
which places the center on the opposite side of the anchor.

### 9. Mirror flags not applied on relog

**Bug**: Objects with cached mirror flags appeared un-mirrored after relogging.

**Root cause**: `loadPKMirrorFlags()` in the `LLVOVolume` constructor ran before
`PKMirrorFlags::init()` loaded the cache (cache was empty). Also, even if the cache
was populated, `loadPKMirrorFlags` didn't call `markRebuild` (drawable was null
during construction).

**Fix**: Added lazy-load pattern. `getPKMirrorFlags()` checks `mPKMirrorFlagsLoaded`
flag and calls `loadPKMirrorFlags()` on first access. `loadPKMirrorFlags()` uses
`setPKMirrorFlags()` which triggers `markRebuild` if drawable exists.

## Debugging

All logging uses the `PKMirror` tag with `LL_INFOS` (always visible in log).

Key log messages:

- `dragFace: FLIP TRIGGERED axis=N` - positive→negative crossing
- `dragFace: FLIP TRIGGERED (return crossing) axis=N` - negative→positive crossing
- `setPKMirrorFlags: flags X -> Y drawable=yes` - volume flags updated, rebuild queued
- `getGeometryVolume: mirror_flags=N` - geometry rebuild applying mirror
- `handleMouseUp: persist object` - notecard creation on drag end
- `loadPKMirrorFlags: object UUID loaded flags=N` - lazy-load from cache
- `setFlags: SKIPPED` - cache hit, no update needed
- `setFlags: UPDATING cache from X to Y` - cache miss, updating
- `setFlags: skipping notecard (obj=nullptr, drag mode)` - drag suppression active

Log file: `~\AppData\Roaming\PyroKitty_x64\logs\PyroKitty.log`

Filter: `grep PKMirror PyroKitty.log`
Exclude geometry spam: `grep PKMirror PyroKitty.log | grep -v getGeometryVolume`

## Rebuild Chain

```
setPKMirrorFlags(flags)
  -> markRebuild(drawable, REBUILD_ALL)
     REBUILD_ALL = REBUILD_GEOMETRY | REBUILD_VOLUME
     REBUILD_GEOMETRY = REBUILD_POSITION | REBUILD_TCOORD | REBUILD_COLOR

getGeometryVolume():
  full_rebuild = REBUILD_VOLUME flag set  (true)
  rebuild_pos  = full_rebuild             (true)
  -> mirror code on mat_vert executes     (only when rebuild_pos is true)
```

If `REBUILD_ALL` is downgraded to `REBUILD_POSITION` only, `full_rebuild` would be
false but `rebuild_pos` would still be true, so the mirror still applies.
