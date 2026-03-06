# Velocity Interpolation for Physical Objects

## Goal

Smooth movement of physical objects (e.g., balls rolling after collision) using Firestorm-style extrapolation — each frame, advance position using velocity and acceleration, with server updates resetting authoritative state.

## How Firestorm Does It (`llviewerobject.cpp`)

Every frame in `idleUpdate()` → `interpolateLinearMotion()`:

```cpp
// pos_delta = (vel + 0.5 * (dt - PHYSICS_TIMESTEP) * accel) * dt
// PHYSICS_TIMESTEP = 1/45s — corrects for velocity being average of last sim step
new_pos = getPositionRegion() + pos_delta;
new_vel = vel + accel * dt;
```

Key design: **the server omits updates when the object follows the predicted path.** The client is expected to extrapolate. Only deviations from the predicted trajectory trigger a server correction.

Phase-out timing:
- `sPhaseOutUpdateInterpolationTime = 2.0s` — start fading if no server update
- `sMaxUpdateInterpolationTime = 3.0s` — stop entirely

Angular velocity applied directly as rotation delta each frame (`applyAngularVelocity`).

## Architecture

### Godot Side (`scene_manager.gd`)

`_interpolate_objects(delta)` — runs every frame:

- `object_targets` dict: `localId -> { pos, rot, vel, accel, angVel, age }`
- Each frame: `pos += (vel + 0.5 * (dt - 1/45) * accel) * dt * phase_out`
- Velocity updated: `vel += accel * dt * phase_out`
- Angular velocity: `rot *= Quaternion(axis, ang_speed * dt)`
- Phase out: linear fade from 1.0 to 0.0 between 2s and 3s without server update
- Server updates reset pos, rot, vel, accel, angVel, age=0

### Bridge Side (`godot-bridge.ts`)

- Both terse and full updates forward `velocity`, `acceleration`, and `angularVelocity` to Godot
- Coalescing timer: 16ms (~1 frame)
- `has_motion` gate: enters interpolation only if vel, accel, or angVel non-zero

## Pipeline

1. SL server sends `ImprovedTerseObjectUpdate` with position, velocity, acceleration, angular velocity
2. `ObjectStoreFull.objectUpdateTerse()` parses via `Utils.UInt16ToFloat` dequantization
3. `notifyTerseUpdate()` → fires `onObjectUpdatedTerseEvent`
4. `godot-bridge.ts` subscribes, reads `obj.Velocity/Acceleration/AngularVelocity`, buffers to Godot
5. Godot `handle_object_update_batch()` resets `object_targets` entry with server state
6. `_interpolate_objects()` extrapolates every frame until next server update

## Object Store

Both main app and MCP bot use `BotOptionFlags.None` → `ObjectStoreFull` (not Lite).
`ObjectStoreLite.objectUpdateTerse()` is unimplemented but irrelevant since we use Full.

## Linksets

SL sends terse updates for the root prim of physical linksets. Child prims move via `_update_children_transforms()` which recomputes their world position from parent + offset.

- Root prim identified by `parentId == 0` in bridge
- Child offset stored in `child_offset_pos` / `child_offset_rot` dicts
- `getObjectChildren()` MCP tool useful for checking which is root vs child

Example: golf_ball linkset — root=642829107 (gets terse velocity updates), child=642829106 at offset (0,0,0).

## Debugging

- Godot log: `[Interp]` lines show when interpolation starts/stops
- Electron log: `[Terse]` lines show raw terse updates with velocity values
- Key: if velocity is always zero, check which object store is active (`BotOptionFlags`)
