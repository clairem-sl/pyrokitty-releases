# VR Motion Tracking for Second Life

## Goal

Enable VR hand/arm tracking visible to **all existing Bento-capable viewers** without server-side puppetry support or viewer modifications on the receiving end.

## Core Insight

Use pre-uploaded Bento animations as the transport layer. The VR viewer classifies the user's hand/arm state, selects the nearest animation from a pre-uploaded library, and toggles it via standard `AgentAnimation` start/stop messages. Every viewer that supports Bento already knows how to render these.

---

## Key Design Decisions

### Avatar Rotation: Snap-Turn Clears the Dead Zone

- SL servers drop rotation updates smaller than ~15 degrees, creating a dead zone (not quantization — small changes are silently swallowed)
- VR snap-turn (30/45/60 degree increments) always exceeds this threshold, so every intentional rotation is broadcast reliably
- Avatar facing is controlled by the VR controller stick, not head orientation
- This means avatar rotation is authoritative on all viewers after every snap-turn

### Arm Direction is Body-Relative

- Since rotation is reliable, arm animations only need to cover offsets within one snap-turn window (~-20 to +20 degrees from center)
- The user snap-turns to face their target, then arm animations handle the fine offset
- For targets slightly off-center, wider arm angles (-20, +20 degrees) avoid forcing a snap-turn for every small offset

### Animation Crossfade Provides Smooth Interpolation

- SL's animation ease-in/ease-out blends between consecutive poses
- Transitions between adjacent arm positions (e.g., +10 to +20 degrees) appear as smooth sweeping motions
- A reach-to-grab motion crossfades through 2-3 animations and looks like one fluid gesture
- Ease-in/ease-out duration ~200-300ms (tuning parameter: shorter = snappier tracking, longer = smoother blend)
- Sparse animation sets may be sufficient since blending fills gaps between grid points

---

## Animation Codebook

### Dimensions

| Axis | Values | Count |
|------|--------|-------|
| Horizontal offset | -20, -10, 0, +10, +20 degrees from body center | 5 |
| Elevation | down (~-30), level (0), up (~+30) | 3 |
| Arm extension | retracted, extended | 2 |
| Hand pose | relaxed, flat, point, grip, thumbs-up | 5 |
| Arm | left, right | 2 |

### Animation Count Estimate

- **Directional**: 5 horizontal x 3 elevation x 2 extension = 30 per arm, 60 total
- **Hand poses**: 5 poses x 2 arms = 10 (layered on top at higher priority, independent of direction)
- **Total: ~70 animations**

Hand pose animations only affect finger/wrist bones and can stack on top of arm direction animations via priority. This keeps the two dimensions independent and avoids a combinatorial explosion.

### Authoring

Animations will be generated programmatically, NOT authored by hand:

1. Define the grid of (azimuth, elevation, extension) targets
2. For each grid point, run IK from shoulder to target position to get shoulder/elbow/wrist joint rotations
3. Export as BVH files with proper SL bone names (Bento hand bones for hand poses)
4. Bulk upload via the viewer or a script

The IK solver and BVH exporter can be a standalone Node/Python script. Input: avatar skeleton definition + grid parameters. Output: directory of BVH files ready for upload.

---

## System Architecture

### Components

```
VR Controller Input
        |
        v
  Gesture Classifier (viewer-side)
    - Snap-turn detection -> avatar rotation via AgentUpdate
    - Arm direction -> nearest (azimuth, elevation, extension) grid point
    - Hand pose -> gesture classification (relaxed/flat/point/grip/etc)
        |
        v
  Animation Selector (viewer-side)
    - Maps classified state to animation UUIDs from the uploaded library
    - Manages transitions: stop previous arm animation, start new one
    - Sets ease-in/ease-out timing for smooth crossfade
        |
        v
  AgentAnimation messages (standard SL protocol)
    - Start/stop animation UUIDs
    - ~10 updates/sec max
        |
        v
  SL Sim broadcasts to all nearby viewers
    - Standard ObjectUpdate with animation list
    - All Bento viewers render the animations natively
```

### VR Viewer (Local Rendering)

Locally, the VR user sees their true tracked hand positions rendered directly (no animation system, just IK or raw tracking). The animation codebook is only for what OTHER viewers see. This avoids any latency or quantization in the local VR experience.

### Update Rate

- `AgentAnimation` start/stop messages: lightweight UDP, can send ~10/sec without issues
- Sim broadcasts animation changes in the next `ObjectUpdate` frame (~10Hz)
- Combined with 200-300ms crossfade, effective arm update rate is ~3-5 visually distinct positions per second
- Sufficient for reaching, pointing, and gesturing — not for juggling

---

## Implementation Phases

### Phase 1: Discrete Gestures (v1)

**Goal**: A small set of recognizable hand/arm gestures visible to all viewers.

1. **Author 15-20 animations** covering common gestures:
   - Wave (right arm raised, hand open)
   - Point forward (arm extended, index finger out)
   - Thumbs up
   - Open palm / offering gesture
   - Grip / holding
   - Arms relaxed at sides (default, no animation)
   - A few left-hand variants

2. **Gesture classifier**: Map VR controller state to gesture intent
   - Trigger states (grip, index) map to hand poses
   - Controller orientation + position relative to head maps to gesture type
   - Hysteresis to avoid rapid flickering between gestures

3. **Animation toggle**: Start/stop the appropriate animation UUID
   - Only one arm animation active per arm at a time
   - Hand pose animation layered on top

4. **Upload mechanism**: Manual upload of the animation pack (one-time setup per user)

**Validation**: Have a second account on a stock Firestorm viewer confirm gestures are visible and readable.

### Phase 2: Directional Arm Tracking (v2)

**Goal**: Arm points in a specific world-space direction, accurate enough for "pointing at that thing" and "reaching for an object."

1. **Generate the full animation codebook** (~70 animations) via IK script
2. **Implement the arm direction mapper**:
   - Get VR controller world-space direction
   - Subtract avatar facing (known precisely after snap-turn)
   - Compute body-relative azimuth and elevation
   - Snap to nearest grid point
   - Select animation UUID
3. **Transition management**:
   - Track currently playing arm animation
   - Only send start/stop when grid point changes
   - Tune ease-in/ease-out for smooth sweeping
4. **Snap-turn integration**: When the user snap-turns, recalculate arm offset relative to new facing and swap animation if needed (should be seamless since the arm direction in world-space hasn't changed)

**Validation**: Have the VR user point at specific objects/avatars and confirm that observers on stock viewers see the arm pointing in the correct direction.

### Phase 3: Polish and Edge Cases

1. **Both arms simultaneously**: Ensure two arm direction animations + two hand pose animations can stack without conflicts (priority management)
2. **Walking + gesturing**: Arm animations need to coexist with walk/run cycles — priority tuning
3. **Sitting**: Arm animations may need seated variants or may work as-is depending on priority vs sit animation
4. **Animation pack distribution**: Ideally distribute as a HUD or inventory folder that auto-loads the animation UUIDs — avoid requiring users to manually upload 70 files
5. **Fallback for non-VR users**: The same animation pack could power an emote wheel or gesture bar for desktop users

---

## Open Questions

- **Animation stacking limits**: How many simultaneous animations can a sim handle per avatar before dropping some? Need to test with ~4-6 active (2 arm direction + 2 hand pose + idle override + walk)
- **Ease-in/ease-out control**: Can the viewer specify crossfade duration per animation start, or is it baked into the animation file? If baked, all animations need the same transition time authored in
- **Upload automation**: Is there an API or bulk upload path, or does each animation require manual upload through the viewer UI?
- **Animation UUID management**: How to map the grid to UUIDs after upload — probably a config notecard or JSON file the viewer reads
- **IK quality**: How well does a simple 2-bone IK (shoulder-elbow-wrist) approximate natural arm poses? May need pole vector hints for elbow direction
- **Priority conflicts with AOs**: Users running animation overriders may conflict — need to choose priority levels carefully (probably priority 4+ to override AO idle but not interfere with explicit user animations)

---

## Technical References

- Bento bone names: [SL Wiki - Bento Skeleton](http://wiki.secondlife.com/wiki/Project_Bento_Skeleton_Guide)
- BVH format for SL: [SL Wiki - BVH](http://wiki.secondlife.com/wiki/BVH)
- Animation priority system: [SL Wiki - Animation](http://wiki.secondlife.com/wiki/Animation)
- AgentAnimation message: [SL Wiki - AgentAnimation](http://wiki.secondlife.com/wiki/AgentAnimation)
