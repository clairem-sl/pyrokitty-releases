# Puppetry System Architecture

## Overview

Puppetry is a real-time avatar motion capture system that allows external input devices (e.g. LEAP hand tracking) to drive avatar joint rotations and have those rotations broadcast to other clients in the region. It is built on top of the existing animation/motion controller infrastructure and uses the `AgentAnimation` UDP message (with a `PhysicalAvatarEventList` block) as its network transport.

```
External LEAP module (Python, via stdin/stdout IPC)
    │ LLSD over LLEventPump "puppetry"
    ▼
LLPuppetModule::processLeapData()       [llpuppetmodule.cpp]
    │ LLPuppetJointEvent objects
    ▼
LLPuppetMotion::addExpressionEvent()    [llpuppetmotion.cpp]
    │ buffered in mExpressionEvents map
    ▼
LLPuppetMotion::onUpdate()              (called every frame)
    ├─ updateFromExpression()  →  IK solving  →  joint rotations applied locally
    └─ pumpOutgoingEvents()    →  every 50 ms, serialize and send
         │
         ▼
    packEvents()
         │  AgentAnimation UDP message
         │  PhysicalAvatarEventList binary block
         ▼
    Simulator  →  relayed to all observing clients in range
         │
         ▼
    process_avatar_animation()          [llviewermessage.cpp]
    handle_puppetry_data()
    LLPuppetMotion::unpackEvents()
         │
         ▼
    updateFromBroadcast()  →  joint rotations applied to remote avatar
```

## Key Files

| File | Purpose |
|------|---------|
| `indra/newview/llpuppetmodule.cpp/.h` | LEAP IPC, capability config, sending/receiving settings |
| `indra/newview/llpuppetmotion.cpp/.h` | Motion controller: IK, per-frame update, pack/unpack |
| `indra/newview/llpuppetevent.cpp/.h` | `LLPuppetJointEvent` and `LLPuppetEvent` data structures, binary serialization |
| `indra/newview/llviewermessage.cpp` | `process_avatar_animation()`, `handle_puppetry_data()` |
| `indra/llcharacter/lljoint.h` | `JointPriority` enum — defines `PUPPET_PRIORITY` |
| `indra/llcharacter/llpose.cpp` | `LLJointStateBlender` — priority-ordered blending |
| `indra/llcharacter/llik.cpp/.h` | FABRIK IK solver used to compute joint rotations |

## Input: LEAP Module

The LEAP module is an external process (typically a Python script) that communicates with the viewer via stdin/stdout using the LEAP (Linden Event API Protocol) IPC mechanism. It sends LLSD data to an `LLEventPump` named `"puppetry"`.

### Input LLSD Format

```
{
  'joint_name': {            // e.g. "mWristLeft"
    'rot':       [x, y, z],  // imaginary part of rotation quaternion (parent frame)
    'local_rot': [x, y, z],  // imaginary part of rotation quaternion (local frame)
    'pos':       [x, y, z],  // end-effector position (IK target)
    'scale':     [x, y, z],  // joint scale
    'no_constraint': bool    // disable IK constraints for this joint
  },
  ...
}
```

`processLeapData()` (`llpuppetmodule.cpp`) converts each entry into a `LLPuppetJointEvent` and hands it to the active `LLPuppetMotion` via `addExpressionEvent()`.

## Motion Controller: LLPuppetMotion

`LLPuppetMotion` is a subclass of `LLMotion` and is registered with the avatar's `LLMotionController` under the UUID `ANIM_AGENT_PUPPET_MOTION`. One instance exists per avatar (self and remote).

### Per-Frame Update (`onUpdate`)

Called every frame at the avatar's update rate (~60 FPS):

1. **`updateFromExpression(now)`** — For self: drains `mExpressionEvents`, builds IK targets, runs the FABRIK IK solver (`LLIK::Solver`), and applies the solved rotations to `LLJointState` objects in `mPose`.
2. **`updateFromBroadcast(now)`** — For remote avatars: drains `mEventQueues` (which have been filled by `unpackEvents()`), interpolates joint events using a jitter-buffered `DelayedEventQueue`, and applies rotations directly.
3. **`pumpOutgoingEvents()`** — Checks `mBroadcastTimer` (50 ms interval). When expired, calls `packEvents()`.

### Joint Collection (`collectJoints`)

Called on `onActivate()`. Starts at `mPelvis` and recurses through all children where `isBone() == true`.

**Explicit exclusion:** All `mSpine*` joints are bypassed:
```cpp
while (joint->getName().rfind("mSpine", 0) == 0)
{
    joint = /* first bone child */;
}
```
The IK chain jumps directly: `mPelvis → mTorso → mChest → ...`

**Only rotations are collected:**
```cpp
joint_state->setUsage(LLJointState::ROT);
// TODO: At present only controlling rotations.
```
Position data in the protocol is used only as IK end-effector targets (for wrists), not as direct per-joint position overrides.

### IK Constraints

`get_constraint_by_joint_id()` (`llpuppetmotion.cpp:118`, marked `// BEGIN HACK`) provides hard-coded joint constraints:

| Joint(s) | Constraint type | Notes |
|----------|----------------|-------|
| mTorso | TwistLimitedCone | Very tight (±0.005π) — nearly rigid |
| mChest | TwistLimitedCone | Tight (±0.02π) |
| mNeck, mHead | TwistLimitedCone | ±45° |
| mCollarLeft/Right | TwistLimitedCone | Limited yaw |
| mShoulderLeft/Right | TwistLimitedCone | Full arm range |
| mElbowLeft/Right | ElbowConstraint | Hinge with twist limits |
| mWristLeft/Right | TwistLimitedCone | Limited bend |
| Finger proximal joints (×8) | DoubleLimitedHinge | Yaw + pitch |
| Finger medial/distal joints (×16) | KneeConstraint | Flex only |

All other bones (legs, face, eyes, etc.) are collected and registered with the IK solver but receive no constraint (`default: break` → null constraint). They can receive rotation data but IK does not solve through them in a physically meaningful way.

Right-side arm/hand constraints are compiled in unconditionally (`#define ENABLE_RIGHT_CONSTRAINTS` at line 47).

## Network Transport

### Sending (`packEvents`)

Triggered every 50 ms (`PUPPET_BROADCAST_INTERVAL = 0.05f`) when puppetry is active and `isSending()` is true.

Message layout:
```
AgentAnimation (UDP)
  AgentData block
    AgentID   (UUID)
    SessionID (UUID)
  AnimationList block(s)       ← standard animation data (unchanged)
  PhysicalAvatarEventList block(s)
    TypeData  (binary, ≤255 bytes per block)
```

The `TypeData` binary payload for one `LLPuppetEvent`:
```
S32   timestamp_ms        // viewer clock in milliseconds
S16   num_joints
S32   binary_data_size
[per-joint records...]
```

Per-joint record (variable size, minimum 3 bytes):
```
S16   joint_id
U8    mask                // EF_ROTATION=0x04, EF_POSITION=0x01, EF_SCALE=0x10,
                          // EF_ROTATION_IN_PARENT_FRAME=0x08, EF_DISABLE_CONSTRAINT=0x80
U16×3 rotation            // imaginary XYZ of quaternion; W = sqrt(1 - X²-Y²-Z²)
                          //   (only present if mask & EF_ROTATION)
U16×3 position            // quantized to [-LL_MAX_PELVIS_OFFSET, +LL_MAX_PELVIS_OFFSET]
                          //   (only present if mask & EF_POSITION)
U16×3 scale               // (only present if mask & EF_SCALE)
```

Quantization uses `F32_to_U16()` / `U16_to_F32()` helpers (symmetric range, linear).
Quaternion W is always non-negative (negate entire quaternion if W < 0 before packing).

Size caps: `PUPPET_MAX_MSG_BYTES = 255` per block. Multiple blocks per message are possible, checked against UDP MTU.

### Receiving

`process_avatar_animation()` (`llviewermessage.cpp`) handles inbound `AgentAnimation` messages for all avatars. When `PhysicalAvatarEventList` blocks are present:

```cpp
handle_puppetry_data(mesgsys, avatarp, num_physav_blocks);
```

This finds or creates the `LLPuppetMotion` on the remote avatar and calls `unpackEvents()`, which feeds events into per-joint `DelayedEventQueue` instances. Each queue applies jitter buffering by pushing events into the future by `eventPeriod + eventJitter` (dynamically measured), giving the receiver a stable stream to interpolate from.

## Animation Priority

`PUPPET_PRIORITY = LL_CHARACTER_MAX_PRIORITY = 7` — the highest value in `LLJoint::JointPriority`:

```
LOW_PRIORITY      = 0
MEDIUM_PRIORITY   = 1   (head tracking, hand pose)
HIGH_PRIORITY     = 2   (keyframe anims, walk)
HIGHER_PRIORITY   = 3   (run)
HIGHEST_PRIORITY  = 4
                  = 5, 6
ADDITIVE_PRIORITY = 7   ← user anims hard-capped at ADDITIVE_PRIORITY-1 = 6
PUPPET_PRIORITY   = 7   ← puppetry
```

`LLKeyframeMotion` explicitly clamps any uploaded animation to at most priority 6 (`llkeyframemotion.cpp:1281`), so puppetry always wins on any joint it controls.

`LLPuppetMotion::getBlendType()` returns `NORMAL_BLEND` (not additive), so it is a full override — not stacked on top. When the motion weight reaches 1.0 (fully eased in), lower-priority animations contribute zero to the same joints.

Per-component nuance: if puppetry only sets `ROT` (not `POS`) for a joint, a lower-priority animation's position can still apply to that joint.

## Configuration and Capability

The simulator exposes a `"Puppetry"` HTTP capability. `LLPuppetMotion::RequestPuppetryStatusCoro()` fetches it on region entry. The capability response reports:

- Whether puppetry is enabled on this simulator (`sIsPuppetryEnabled`)
- Maximum event payload size (`sPuppeteerEventMaxSize`)

`LLPuppetModule` holds runtime settings:

| Setting | Meaning |
|---------|---------|
| `mIsSending` | Whether this client is broadcasting joint data |
| `mIsReceiving` | Whether this client applies incoming remote puppet data |
| `mPlayServerEcho` | Receive your own data back from the sim (lets others see you) |
| range | Visibility radius (default 25 m); sim filters by agent distance |

## Joint Support Summary

| Category | Supported |
|----------|-----------|
| Upper body bones (torso, chest, neck, head) | Yes — rotation only, IK constrained |
| Arms and hands (collar → wrist, all fingers) | Yes — rotation only, IK constrained |
| Leg bones (hip, knee, ankle, foot, toe) | Collected, rotation accepted, no IK constraints |
| Face / eye bones | Collected, rotation accepted, no IK constraints |
| mSpine1–mSpine4 | **No** — explicitly skipped in collectJoints |
| Collision volumes / attachment points | **No** — not bones |
| Per-joint position control | **No** — position drives IK targets only (wrists) |
