# Object & Avatar Movement

## SL Update Protocol

SL sends three UDP packet types for object state:
- **ObjectUpdate** (full) — all properties, fires `onObjectUpdatedEvent`
- **ObjectUpdateCompressed** — all properties compressed, fires `onObjectUpdatedEvent`
- **ImprovedTerseObjectUpdate** (terse) — position/velocity only, fires `onObjectUpdatedTerseEvent`

node-metaverse uses **ObjectStoreFull** (not Lite — `BotOptionFlags.None` at metaverse-connection.ts:152).
ObjectStoreLite.objectUpdateTerse is NOT IMPLEMENTED (line 1344). ObjectStoreFull overrides it (ObjectStoreFull.ts:479).

Key design: **the server omits updates when the object follows the predicted path.** The client is expected to extrapolate. Only deviations from the predicted trajectory trigger a server correction.

## Bridge Pipeline (godot-bridge.ts)

- Terse handler (line ~1226): reads obj.Position/Velocity from event, writes to `updateBuffer` Map keyed by localId
- Full handler (line ~1297): same buffer, but `terseHasMotion` guard skips position/velocity if terse recently wrote
- `recentTerse` Set tracks objects with terse updates; cleared on flush
- Buffer flushed every 16ms via setTimeout
- Flush splits by velocity: objects WITH velocity → `object_update_physics`, WITHOUT → `object_update_batch`
- `object_update_physics` is HIGH priority in Godot (prefix matches `"object_update_p`)
- `object_update_batch` is LOW priority — gets queued when frame budget exhausted

## Godot Pipeline (scene_manager.gd)

`handle_object_update_batch` handles BOTH message types (`object_update_batch` and `object_update_physics`).

- Objects with velocity → stored in `object_targets` dict, extrapolated each frame (dead reckoning)
- Objects without velocity → snap to position immediately

### Dead Reckoning (Firestorm-style)

`_interpolate_objects(delta)` runs every frame:

- `object_targets` dict: `localId -> { pos, rot, vel, accel, angVel, age, blend_offset, blend_time }`
- Each frame: `pos += (vel + 0.5 * (dt - 1/45) * accel) * dt * phase_out`
- Velocity updated: `vel += accel * dt * phase_out`
- Angular velocity: `rot *= Quaternion(axis, ang_speed * dt)`
- Phase out: linear fade 1.0→0.0 between 2s and 3s without server update (matches Firestorm defaults)
- Blend correction: `rsi.pos = extrapolated_pos + blend_offset * (1 - t/BLEND_TIME)`
- Server updates set `blend_offset = rsi.pos - server_pos`, reset age=0

Firestorm reference (`llviewerobject.cpp` → `interpolateLinearMotion()`):
```cpp
// PHYSICS_TIMESTEP = 1/45s — corrects for velocity being average of last sim step
pos_delta = (vel + 0.5 * (dt - PHYSICS_TIMESTEP) * accel) * dt;
new_pos = getPositionRegion() + pos_delta;
new_vel = vel + accel * dt;
```

## Linksets

SL sends terse updates for the root prim of physical linksets. Child prims move via `_update_children_transforms()` which recomputes world position from parent + offset.

- Root prim identified by `parentId == 0` in bridge
- Child offset stored in `child_offset_pos` / `child_offset_rot` dicts

## Sequence Number System

- UDP packets have monotonic per-circuit sequence numbers
- Bridge tracks `updateSeq` Map per localId — rejects updates with seq < previous
- Both terse and full handlers check sequence numbers
- Sequence numbers are per-PACKET not per-update — full updates can have higher seq than terse but staler position

## Avatar Movement

- Only receives terse updates (full updates filtered by PCode === 47)
- Blend correction APPLIED for avatars (simpler than objects: no acceleration, no angular velocity)
- `AVATAR_MAX_INTERP_DIST = 10.0` — snap if correction exceeds this
- `AVATAR_SLERP_SPEED = 15.0` — rotation slerp rate
- `BLEND_TIME = 0.25` — seconds to decay blend offset

## Fixes Applied

### Priority Check Typo (ROOT CAUSE — FIXED)
- `_is_high_priority()` in main.gd checked for `'"object_update_p"'` (with trailing quote)
- `"object_update_physics"` does NOT contain `"object_update_p"` as a substring — the `p` is followed by `h` not `"`
- ALL physics messages were treated as LOW priority, queuing during busy frames
- Old position data replayed when the queue drained, causing 5m+ jumps to stale positions
- Fix: `'"object_update_p'` (no trailing quote)

### Priority Queue Race (FIXED with Godot-side guard)
- Problem: `object_update_batch` (low priority) queued during loading; stale batch drains later and snaps object backward
- Fix (scene_manager.gd): If object has active `object_targets` entry, skip position/rotation from batch updates (only allow scale)

### Sequence Number Tracking (APPLIED)
- Bridge rejects stale updates via per-object sequence numbers from SL UDP packets

### terseHasMotion Guard (APPLIED)
- Full update handler skips position/velocity if terse update recently wrote to buffer

### Dead Reckoning Interpolation (APPLIED)
- Velocity extrapolation between server updates
- Phase-out after 2.0s, stop after 3.0s (matches Firestorm defaults)

### Blend Correction (APPLIED for both objects and avatars)
- On server correction: `blend_offset = current_visual_pos - new_server_pos`
- Decays to zero over `BLEND_TIME` (0.25s)
- Snap if correction exceeds `BLEND_SNAP_DIST` (10.0m)
- Previous bugs fixed: offset accumulation (use rsi.pos which includes decayed prior blend), zero-velocity early-exit (blend decay runs even when stationary)
