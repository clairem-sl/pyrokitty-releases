# Animation Exploration: Finger Twitching Bug

## Problem
Avatar fingers visibly oscillate back and forth instead of holding a static hand pose.

## Investigation

### Affected Avatar
UUID `27df63dc-2a9e-4c4e-9fbf-404aa902e529`, root localId `654851904`.

### Root Cause
SL hand/finger pose animations use a micro-loop format:
- Very short duration (~0.083s)
- `loop=true`
- `easeInTime=1.0` (1 second blend-in)
- 3 rotation keyframes per joint:
  1. Identity `(0,0,0)` at `loopInPoint` (0.042s) — blend-from reference
  2. Target pose at ~0.063s
  3. Target pose repeated at `loopOutPoint` (0.083s)

The first keyframe (identity) is NOT meant to be looped back to — it exists so the SL ease-in system can blend from "no pose" to the target over 1 second. Once eased in, the animation should hold at the final keyframe.

Our loop code was treating these like normal looping animations:
```
t = loop_in + fmod(joint_elapsed - loop_out, loop_len)
```
This caused `t` to oscillate between `loopInPoint` (identity key) and `loopOutPoint` (target key) every 0.041s, producing the visible finger twitching.

### Example: Animation `3eab0887`
```json
{
  "uuid": "3eab0887-014c-665f-128e-ee6cc59a521c",
  "duration": 0.083,
  "loop": true,
  "loopInPoint": 0.042,
  "loopOutPoint": 0.083,
  "easeInTime": 1,
  "priority": 4,
  "joints": [
    {
      "name": "mHandMiddle3Right",
      "priority": 4,
      "rotationKeys": [
        { "time": 0.042, "value": [0, 0, 0] },
        { "time": 0.063, "value": [0.222, -0.023, -0.006] },
        { "time": 0.083, "value": [0.222, -0.023, -0.006] }
      ]
    }
  ]
}
```

Left hand counterpart: `5441b92b` — identical structure, mirrored joint names (`mHandMiddle3Left`, etc.).

### Avatar's Full Animation Set
9 animations playing simultaneously:
- `068add6d` — 8 joints, 0.4s, loop
- `201d84aa` — 43 joints, 0.0s, loop (static full-body pose)
- `3597f01b` — 18 joints, 0.7s, loop
- `3eab0887` — 16 joints, 0.083s, loop, pri=4 (RIGHT hand pose — the twitcher)
- `5441b92b` — 16 joints, 0.083s, loop, pri=4 (LEFT hand pose — same issue)
- `8537b985` — 1 joint, 0.0s, loop
- `94f2c278` — 19 joints, 30.0s, loop
- `a1f26d83` — 32 joints, 0.1s, loop
- `dccb493a` — 6 joints, 60.0s, loop

### FingerDbg Output
```
[FingerDbg] root=654851904 fingers_in_merged=30 fingers_with_rot=30 elapsed=4.9
  mHandMiddle3Right dur=0.08 rkeys=3 loop=true anim=3eab0887 je=4.92
  rot=(0.065,-0.007,-0.002,0.998)

[FingerDbg] root=654851904 fingers_in_merged=30 fingers_with_rot=30 elapsed=12.9
  mHandMiddle3Right dur=0.08 rkeys=3 loop=true anim=3eab0887 je=12.95
  rot=(0.222,-0.023,-0.006,0.975)
```

The rotation values swing between near-identity and the target pose, confirming the oscillation.

## Fix
In `object_manager.gd` `process_animesh()`, animations with `duration < 0.2s` and `loop=true` are treated as hand/finger poses. Instead of looping, `t` is clamped to `loop_out` after the first pass — the pose plays through once (identity → target) and holds at the final keyframe.

```gdscript
elif jdur < 0.2:
    # Micro-loop hand/finger pose: clamp to end after first pass
    t = minf(joint_elapsed, loop_out)
```

The crossfade blend smooths the initial transition (matching SL's ease-in behavior), then the fingers hold steady.

## Future Work: Proper Ease-In/Ease-Out

The `jdur < 0.2` threshold is a heuristic that works for the confirmed hand pose pattern, but it papers over a deeper gap: we don't implement SL's per-animation ease-in/ease-out system at all.

In SL's viewer, `easeInTime` and `easeOutTime` (present in the animation data — e.g. `easeInTime=1.0` in the hand poses above) control how each animation blends in and out independently. This is separate from our crossfade blend, which operates at the per-joint level between animation switches. The ease-in is what makes micro-loop poses work correctly in SL: the viewer blends from the bone's current state toward the animation's output over `easeInTime` seconds, so the identity-first-keyframe never actually appears visually.

Implementing proper per-animation ease-in/ease-out would:
- Fix this class of bug generically instead of by duration threshold
- Give smoother transitions when animations start/stop (matching Firestorm behavior)
- Allow removing the crossfade blend hack (`_prev_sl_local_rot` / `_ANIM_BLEND_SPEED`), which is a rough approximation of the same thing

Not urgent — the current fix handles the known pattern and the threshold is conservative enough to not catch real looping animations — but worth revisiting.
