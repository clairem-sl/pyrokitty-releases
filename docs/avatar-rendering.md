# Avatar Rendering

Technical reference for avatar rendering in the Godot viewer. Covers skeleton architecture, animations, shape deformation, and SL protocol quirks.

Key files: `object_manager.gd`, `skeleton_builder.gd`, `mesh-converter.ts`, `avatar-shape.ts`, `godot-avatar-manager.ts`

---

## Skeleton Architecture

**One shared Skeleton3D per avatar/animesh root**, built from `avatar_skeleton.xml` (159 bones). All rigged meshes bind to it via skin index remapping. Animation evaluation and shape deformation operate on this single skeleton.

- Skeleton added as parent of MeshInstance3D nodes (Godot's expected hierarchy)
- `set_bone_global_pose_override()` used for both rotation AND position — Godot's `set_bone_pose_rotation()`/`set_bone_pose_position()` during `_process` are NOT reflected in `get_bone_global_pose()` until a later frame, even with `force_update_all_bone_transforms()`
- Joint overrides from mesh attachments replace bone rest positions (lowest mesh UUID wins, matching SL's `std::map<LLUUID>` in `LLJoint::findActiveOverride`)
- Worn animesh attachments get their own skeleton (matching Firestorm's `LLControlAvatar`) — their child prims' overrides do NOT affect the avatar's skeleton
- GLB local rest is authoritative for overrides — do NOT convert world→local (mesh-converter sets rest from `alt_inverse_bind_matrix`)

### What Failed (Do Not Retry)
- **AnimationPlayer**: World rotation composition order mismatch — SL `operator*` is reversed Hamilton, equivalent to standard `parent_world * local`. AnimationPlayer can't be configured for this.
- **Per-mesh skeletons as siblings**: Adding Skeleton3D as scene tree sibling breaks Godot skin binding
- **Basis.from_scale() on rest**: Cascades through entire subtree (SL only scales direct child positions)

---

## Coordinate Systems

| Data | SL space | Godot space |
|------|----------|-------------|
| Position | (x, y, z) | (x, z, -y) |
| Quaternion | (x, y, z, w) | (x, z, -y, w) |
| Scale (shape) | (sx, sy, sz) | applied in SL space before pos conversion |

### IBM Transform (mesh-converter.ts)
SL uses row-vector convention. Column-major IBM layout with sign flip:
```
Col0: m[0],  m[2], -m[1], m[3]
Col1: m[8],  m[10],-m[9], m[11]
Col2:-m[4], -m[6],  m[5], m[7]
Col3: m[12], m[14],-m[13], m[15]
```

### SL Euler → Quaternion (mayaQ formula)
```
half angles: xr=x/2, yr=y/2, zr=z/2
q.w = cos(xr)cos(yr)cos(zr) + sin(xr)sin(yr)sin(zr)
q.x = sin(xr)cos(yr)cos(zr) - cos(xr)sin(yr)sin(zr)
q.y = cos(xr)sin(yr)cos(zr) + sin(xr)cos(yr)sin(zr)
q.z = cos(xr)cos(yr)sin(zr) - sin(xr)sin(yr)cos(zr)
```

---

## Animation System

Single evaluation pass per skeleton in `process_animesh`. Animations are priority-merged per joint.

### Key Behaviors
- **Position keyframes are ABSOLUTE joint positions** (replace, not add). Compressed to [-5, 5] meters via UInt16. Godot's pose position is additive on rest, so we subtract rest origin to convert.
- **Rotation keyframes**: UInt16 compressed [-1, 1] per component (NOT Euler). Decoded as quaternion directly.
- **Per-channel priority**: Rotation and position priority tracked INDEPENDENTLY per joint. An animation with position keys but no rotation keys claims position only — does NOT block lower-priority rotation.
- **Bone rotation order**: SL `operator*` is reversed Hamilton; our code uses standard `parent_world * local` which is equivalent.

### Micro-Loop Quirk (Hand/Finger Poses)
SL hand/finger poses are micro-loops (duration ~0.083s) with an identity first keyframe meant for the ease-in system, NOT for playback. Without handling, fingers twitch between identity and target each loop.

**Fix**: Clamp animations with `duration < 0.2s` to `loop_out` pose after first pass.

**Future**: Proper ease-in/ease-out system would fix this generically.

### Position Persistence (IMPLEMENTED 2026-03-16)

SL position-only animations (dur=0, loop=false) set bone positions once and they **persist** even after the animation stops. Firestorm's `blendJointStates()` starts from `target_joint->getPosition()` (current value), so positions never reset to zero.

**Fix**: Only reset bone pose ROTATIONS to identity each frame in `_evaluate_skeleton_animation()`. Position poses are NOT reset — they persist from previous animations. This prevents face collapse on avatars with position-only "snap pose" animations that toggle on/off periodically.

### Built-in head_rot Motion (IMPLEMENTED 2026-03-16)

Firestorm has 5 procedural motions generated locally by the viewer (not sent via AvatarAnimation messages):

| Motion | UUID prefix | Priority | Effect |
|--------|------------|----------|--------|
| head_rot | e6e8d1dd | 1 (MEDIUM) | Head/neck/torso toward look-at target |
| eye | 5c780ea8 | 1 | Eye tracking + jitter + blink |
| breathe_rot | 4c5a103e | 1 | Chest breathing |
| hand_motion | ce986325 | 1 | Default hand poses |
| pelvis_fix | 0c5dd2a2 | 0 (LOW) | Pelvis position → zero |

**head_rot** is implemented via `compute_head_rot()` in `animation_manager.gd`. It computes per-skeleton "look forward" rotation by:

1. Walking the pelvis→torso→chest→neck→head chain to find the head's position in root-local space (using animation positions + rest offsets + parent shape scale)
2. Computing direction from head position toward target (default: 2.5m forward from root, matching Firestorm's privacy-spoofed look-at)
3. Building a rotation quaternion from the direction (LL uses row-major matrices → `.transposed()` before Godot's `get_rotation_quaternion()`)
4. Constraining to ±72° (`F_PI_BY_TWO * 0.8`)
5. Distributing: torso 35%, neck 50%, head 50% (usually torso is overridden by higher-priority body anims)

**Gotchas**:
- Target must be relative to ROOT, not pelvis — pelvis animation rotation is not the avatar's facing direction
- LL's `a * b` = Hamilton `b * a` (reversed multiplication convention)
- The head position offset from root matters for non-humanoid skeletons (quadruped dogs need ~30° correction vs ~0° for humans)
- Injected as a synthetic animation at priority 1 via placeholder keyframes; actual values computed per-frame in `process_animesh`

**TODO**: Replace static "look forward" with real look-at targets from ViewerEffect messages. Pass target direction to `compute_head_rot(target_sl=...)`. Still missing: eye, breathe_rot, hand_motion.

### Degenerate CV Bone Bases
Collision volume bones can have zero-column bases from IBM scale amplification (10-20x scale values). `_safe_basis_rotation()` falls back to `Quaternion.IDENTITY` when `determinant() < 0.5`. This prevents 20k+/session errors.

---

## Shape Deformation

Applies avatar appearance slider values to the skeleton for per-avatar proportions.

### Pipeline
```
SL Server → AvatarAppearance msg (253 VisualParam U8 bytes)
  → metaverse-connection.ts: buffers bytes during login
  → avatar-shape.ts: computeShapeDeltas() via fast-xml-parser
  → WebSocket → Godot: { type: "avatar_shape", avatarId, bones }
  → object_manager.gd: _apply_shape_to_skeleton() + _reapply_joint_overrides()
```

### Dequantization
```
weight = (byte / 255.0) * (value_max - value_min) + value_min
bone_scale = (1,1,1) + Σ(weight_i × param_scale_delta_i)
bone_offset = Σ(weight_i × param_offset_delta_i)
```

### SL Bone Scale Semantics (UPDATED 2026-03-15)

Two scale effects in SL's `xform.cpp`, both applied dynamically each frame in `_apply_global_pose_overrides`:

1. **Parent scale on child position** (`xform.cpp:76`): `child.worldPos = parent.worldRot * (child.localPos * parent.scale) + parent.worldPos`. Scale does NOT cascade through rotation/basis — only affects child position. Applied dynamically (not baked into rest) so override rest positions match GLB IBMs (both without parent scale).

2. **Bone's own scale in skinning matrix** (`xform.cpp:93`): `worldMatrix.initAll(mScale, mWorldRotation, mWorldPosition)`. The bone's shape scale goes into the world matrix upper 3x3 for per-vertex mesh deformation. Scale does NOT cascade to children's scale (`worldScale = localScale`). In Godot, achieved via `Basis.from_scale()` multiplied into the global pose override basis.

SL→Godot scale axis mapping: `Vector3(sl_sx, sl_sz, sl_sy)` (SL X→Godot X, SL Z→Godot Y, SL Y→Godot Z).

Shape scales stored in `sm.bone_shape_scales[root_id]` as SL-space `Vector3(sx, sy, sz)` per bone name.

### Collision Volume Scale (IMPLEMENTED 2026-03-15)

CV bones get their skinning scale from three sources, combined as a **deformation ratio** (because the IBM fixup already cancels the CV's default scale):

1. **Inherited parent shape scale** — CV inherits parent skeleton bone's shape scale (Firestorm: `inheritScale()=true`, `llpolyskeletaldistortion.cpp:162-171`)
2. **Volume morph deltas** — direct CV scale changes from morph params (Firestorm: `LLPolyMorphTarget::applyVolumeChanges()`, avatar_lad.xml `<volume_morph>` tags)
3. **Deformation ratio** — `(cv_default * parent_shape + vm_delta) / cv_default` = `parent_shape + vm_delta / cv_default`

The ratio is needed because the GLB IBM fixup (`blenderFixJoint`) cancels the CV's XML default scale. Putting the absolute CV scale (e.g., 0.042) into the global pose would double-apply the default, producing stick-thin limbs. The deformation ratio (e.g., 0.7) correctly represents the shape change from default.

Volume morph deltas are extracted by `convert-avatar-lad.js` from `<volume_morph>` tags, computed in `computeShapeDeltas()`, buffered in `avatarVolumeMorphs` alongside bone shapes, and stored in `sm.cv_volume_morphs[root_id]` on the Godot side.

### Critical Implementation Details

**Byte array = groups 0 + 3 (NOT 0 + 2).** The enum naming is misleading:
- Group 0: TWEAKABLE — transmitted
- Group 1: ANIMATABLE — NOT transmitted (driven by group 0 drivers)
- Group 2: TWEAKABLE_NO_TRANSMIT — NOT transmitted
- Group 3: TRANSMIT_NOT_TWEAKABLE — transmitted

Source: `llvoavatar.cpp` `expected_tweakable_count = group(TWEAKABLE) + group(TRANSMIT_NOT_TWEAKABLE)`

**253 params exactly.** Any count mismatch = byte misalignment = crooked faces. `avatar_lad.xml` has a duplicate (id=664 "Pop_Eye") — deduplicate by ID (last wins, matching SL's `std::map`).

**Use a real XML parser.** `avatar_lad.xml` has multiline tags (e.g., id=702 spans 12 lines). Line-by-line and regex parsers both fail. We use `fast-xml-parser`.

**Hover height is VisualParam 11001, byte index 252** (the last byte). Range [-2, +2], default 0. Dequantize: `(byte/255) * 4 - 2`. Firestorm reads it via `getVisualParamWeight(AVATAR_HOVER)` in `computeBodySize()` and stores in `mAvatarOffset.mV[VZ]`. It has an empty `<param_skeleton />` (no bone deltas) so `convert-avatar-lad.js` skips it — extracted separately in `computeShapeDeltas()`. The AppearanceHover message block is redundant — same data is already in the VisualParam bytes.

**Driver weight = trapezoidal activation, NOT linear remap.** SL's `getDrivenWeight()` uses piecewise min1/max1/max2/min2 activation. 135 of 360 driven entries have explicit ranges. Without this, bidirectional sliders (Shift_Mouth, Pop_Eye) activate BOTH directions simultaneously → crooked nose, asymmetric eyes.

**Login timing.** AvatarAppearance arrives before GodotBridge subscribes. `metaverse-connection.ts` buffers `avatarVisualParamBuffer`, seeded to avatar manager on bridge init.

### Sex Filtering (IMPLEMENTED 2026-03-15)
Params with `sex="male"` or `sex="female"` in avatar_lad.xml use weight 0 when avatar sex doesn't match (Firestorm: `(getSex() & avatar_sex) ? mCurWeight : getDefaultWeight()`). Avatar sex determined by param id=80 ("male") at byteIndex=31: dequantized > 0.5 = male. Only 1 skeleton param is sex-filtered: id=879 Male_Package → mGroin. Sex field extracted by `convert-avatar-lad.js` into JSON.

### Not Implemented
- **Vertex morph targets** (won't implement): Per-vertex face/body deformation for system avatar meshes only. Nearly all avatars use rigged mesh bodies which don't use these.
- **Hover height**: Partially working but inaccurate. Shape → Body → Hover slider affects avatar height but values don't match Firestorm.

---

## Bakes on Mesh (BoM)

Baked skin/clothing textures from SL's appearance service replace magic UUID placeholders on avatar mesh faces.

- `godot-avatar-manager.ts`: Subscribes to AvatarAppearance, parses magic UUIDs, maps bake channels to TextureEntry face indices
- `texture-fetch-queue.ts`: Downloads baked textures via appearance service URL
- 5-component J2C bake textures (RGBA + bump) — strip to 4 before decoding
- `TextureEntry.ts` 32-bit bitfield bug: JS `<<` truncates at 32 bits; bake indices 41-45 use arithmetic workaround

---

## Collision Volume Bones

CV bones use `inverse(alt_inverse_bind_matrix)` for local transform ONLY when BSM is identity. Non-identity BSM taints raw IBM (`inverse(rawIBM) = BSM * jointWorld`), producing 100x-scaled transforms.

CV rotation/scale is baked into GLB IBMs via Hippolyzer-style fixup. Rest transforms are translation-only.

---

## Known Issues

- **Hover height not gated on sit state**: Firestorm skips hover when `isSitting()` or `sit_ground_constrained` is active (`llvoavatar.cpp:5535`). We always apply hover, which causes sitting avatars (especially large quadrupeds like the Dog) to float. Need proper sit state tracking per avatar (server-confirmed ParentID changes, not animation-based) before gating hover.
- **Missing ObjectUpdate for some avatars**: AvatarAppearance and AvatarAnimation arrive but ObjectUpdate never does (`localId=undefined`). Avatar never renders. Intermittent — same avatar loads on restart. Possibly a race condition in region handshake or a dropped UDP packet.
- **Degenerate CV bone poses**: Falling back to IDENTITY/rest instead of animated
- **519 missing children on rescan**: Attachment routing incomplete on startup
- **Debug logging**: Multiple log categories (`[AttachDebug]`, `[AttachBone]`, `[AvatarDebug]`, `[ShapeDebug]`, etc.) still active

---

## Firestorm Source References

| Topic | File |
|-------|------|
| Bone scale / world transform | `indra/llmath/xform.cpp` lines 69-87 |
| Shape deformation apply | `indra/llappearance/llpolyskeletaldistortion.cpp` |
| Joint setScale | `indra/llcharacter/lljoint.cpp` lines 868-889 |
| Visual param groups | `indra/llcharacter/llvisualparam.h` lines 47-51 |
| Appearance byte count | `indra/newview/llvoavatar.cpp` `expected_tweakable_count` |
| Driver weight mapping | `indra/llappearance/lldriverparam.cpp` `getDrivenWeight()` |

## External References

- **Hippolyzer**: `hippolyzer/lib/base/wearables.py` — VisualParam parsing, group filtering (groups 0+3)
- **CrystalFrost**: Uses LibreMetaverse for param handling
- **avatar_lad.xml**: Defines all visual params, skeleton bones, driver relationships
- **avatar_skeleton.xml**: Defines bone hierarchy, rest positions, collision volumes

---

## Parent Shape Scale Investigation (2026-03-15)

### The Problem

SL's `xform.cpp` applies parent bone scale to children's positions during world transform:
```
child.worldPos = parent.worldRot * (child.localPos * parent.scale) + parent.worldPos
```
Godot doesn't do this automatically. We simulate it by "baking" parent scale into each bone's rest position. This works for consistency but produces different world positions than Firestorm for bones with joint overrides.

### What We Confirmed

1. **Our shape scale computation matches Firestorm exactly** — verified by adding `BONE_SCALE` logging to Firestorm's `updateVisualParams()` and comparing against our `computeShapeDeltas()`. All body bones match (mPelvis, mHips, mKnees, mTorso, mChest, mNeck, etc.). Unit tests added in `avatar-shape.test.ts` with real avatar byte data.

2. **Firestorm does NOT bake parent scale into rest positions** — it stores raw override/shape positions as local positions, then applies parent scale dynamically during world transform computation each frame.

3. **Firestorm's `addAttachmentPosOverride`** uses the alt IBM translation directly as the joint's local position (no parent scale applied). We verified this by adding `OVERRIDE_APPLIED` logging inside the override application path. The override values match what our mesh-converter extracts from the same alt IBM data.

4. **Firestorm filters overrides with `aboveJointPosThreshold`** (0.1mm) — compares alt IBM translation against `getDefaultPosition()`. Our mesh converter generates override lists for ALL joints with alt IBMs, including ones at default positions.

### What We Tried

#### Approach 1: Remove parent scale from overrides only
- **Change**: Don't apply parent shape scale in `_apply_joint_overrides`, keep it in `_apply_shape_to_skeleton`
- **Fixed**: Dog avatar eyes — without parent scale on overrides, the override bone positions match the IBMs in the GLB (both are without parent scale), so skinning is correct. Eyes sit inside the head properly.
- **Broke**: Asymmetric legs on human avatar 27df63dc — mKneeLeft (overridden, no scale) and mKneeRight (shape-baked, with scale) end up in different coordinate spaces. One leg visibly longer than the other.
- **Key insight**: The eye fix and leg break are two sides of the same coin. Override positions need to match the IBM coordinate space. Currently IBMs are computed from XML world transforms (no parent scale), so overrides without parent scale match IBMs correctly. But non-overridden bones have parent scale baked, creating inconsistency.

#### Approach 2: Remove parent scale from BOTH shape and overrides, apply dynamically
- **Change**: Remove parent scale baking from `_apply_shape_to_skeleton`. Store per-bone shape scales in `sm.bone_shape_scale`. Apply parent scale dynamically in `_apply_global_pose_overrides` (new function) called every frame for all skeletons.
- **Result**: Eyes popped out WORSE than Approach 1 — removing parent scale from shape positions changed the rest positions that the IBMs were (partially) aligned with, making the mismatch larger. Unrigged attachments and debug skeleton markers also misaligned because they read rest positions directly, not global pose overrides. Would require updating ALL bone position consumers to use global pose overrides instead of rest positions — too invasive for now.

#### Current State: Baked parent scale (working, not perfect)
Parent scale is baked into both `_apply_shape_to_skeleton` and `_apply_joint_overrides` rest positions. All bones are in the same coordinate space. Produces slightly different world positions than Firestorm (proportional stretching from parent scale on override positions), but visually acceptable — the dog avatar looks "about the same" as Firestorm per user comparison. Eyes pop slightly due to override rest positions having parent scale baked in but IBMs not having it.

#### Potential Approach 3: Fix IBMs in mesh converter (not yet tried)
If the mesh converter computed IBMs from the ACTUAL bone positions (including overrides) instead of from XML defaults, then baked parent scale on both overrides and IBMs would be consistent — both would include the same scale factor. This would fix the eyes without breaking legs. Requires changes to `mesh-converter.ts` IBM computation, not Godot-side code.

### The Correct Fix (Not Yet Implemented)

To truly match Firestorm, the dynamic parent scale approach (Approach 2) is correct but requires:
1. ALL bone position consumers use global pose overrides, not rest positions
2. The `_apply_global_pose_overrides` function runs unconditionally every frame for all skeletons (already implemented)
3. IBMs in the GLB need to be computed from the override-modified skeleton, not the XML default (mesh-converter change)
4. Unrigged attachment positioning needs to read from global pose overrides
5. Debug markers need to read from global pose overrides

This is a significant refactor. The baked approach works acceptably for now.

### Other Fixes Made (Solid, Keep These)

1. **Worn animesh gets own skeleton** — `object_manager.gd` now creates a separate Node3D + Skeleton3D for worn animesh attachments, matching Firestorm's `LLControlAvatar`. Previously, worn animesh child prims' joint overrides clobbered the avatar's skeleton.

2. **Race condition in animesh root assignment** — Added `not sm.animesh_root_for.has(local_id)` guard so child tracking code doesn't overwrite the animesh root assignment made by the animesh detection code.

3. **Override priority: lowest mesh UUID wins** — `_apply_joint_overrides` now tracks per-bone ownership by mesh UUID via `sm.bone_override_owner`. Matches SL's `std::map<LLUUID>` ordering in `LLJoint::findActiveOverride()`.

4. **No-op override filter** — Godot-side threshold check (0.0001) skips overrides whose position matches XML default, matching Firestorm's `aboveJointPosThreshold`. Prevents default-position overrides from replacing shape-modified positions.

5. **Avatar shape unit tests** — `avatar-shape.test.ts` with regression data from real avatars (dog avatar 8f99e602, human avatar 27df63dc). Validates scale computation against Firestorm output.

### Remaining Issues & Next Steps

#### Issue 1: IBM/Rest Position Mismatch (RESOLVED — Eye Position Fixed)

The mesh converter was computing IBMs and skeleton node positions from DIFFERENT sources:
- **IBMs**: computed from XML world transforms via `getWorldPos()` which walks the XML parent chain. These reflected the DEFAULT skeleton.
- **Skeleton nodes**: had override positions from `alt_inverse_bind_matrix`. These reflected the MESH CREATOR's intended skeleton.

This mismatch caused eye popping on the dog avatar (mEyeLeft override 0.36 from XML default). **Fixed** — IBMs and rest positions are now consistent. Eye position is correct.

#### Issue 2: Head Droop on Dog Avatar

The dog's head droops in Godot but looks forward in Firestorm. Both viewers have the same mHead override position (0.373, 0, 0.713). The original theory blamed the IBM/rest position mismatch (Issue 1), but that was wrong — **the actual cause is an animation priority bug**. The droop persists after the IBM fix, confirming it's an animation issue, not a skinning issue.

#### Issue 3: T-Pose Before First Animation

Avatars briefly T-pose before their first animation evaluation. `_apply_global_pose_overrides` is only called inside `process_animesh` during animation eval (30Hz throttled), so before the first eval, bones sit at rest pose. Fix: run `_apply_global_pose_overrides` once when a skeleton is first created or when shape/overrides are applied.

#### Issue 6: mHead Sex Filtering

`avatar_lad_skeleton.json` lacks sex info. Firestorm's `LLPolySkeletalDistortion::apply()` checks `(getSex() & avatar_sex)` and uses `getDefaultWeight()` for params that don't match the avatar's sex. Our code always uses the byte value. This causes wrong scale on mHead (our: 0.926, Firestorm: 1.096). Need to add sex field to the JSON and filter in `computeShapeDeltas()`.

### Resolution (2026-03-15)

Issues 1-4 and 6 were resolved by implementing dynamic parent scale + bone scale in skinning (Approach 2, done properly this time with all consumers updated). The key changes:

1. **Dynamic parent scale**: `_apply_shape_to_skeleton` no longer bakes parent scale. Shape scales stored in `sm.bone_shape_scales`. `_apply_global_pose_overrides` applies parent scale dynamically each frame (matching `xform.cpp:76`). All bone position consumers (`_update_bone_attachments`, debug markers) also use dynamic parent scale.

2. **Bone scale in skinning basis**: `_apply_global_pose_overrides` includes each bone's own shape scale in the global pose override via `Basis.from_scale()`, matching `xform.cpp:93: initAll(mScale, mWorldRot, mWorldPos)`. Scale does NOT cascade to children (matching SL: `worldScale = localScale`).

3. **AP offset bone scale**: `_get_ap_world_transform` now scales AP offsets by the bone's shape scale (AP is a child joint, subject to `xform.cpp:76`). Fixed boots too low / ears too high.

4. **Sex filtering**: `convert-avatar-lad.js` extracts `@_sex`. `computeShapeDeltas()` filters by avatar sex (param id=80, byteIndex=31). Only 1 skeleton param affected: id=879 Male_Package → mGroin. Earlier mHead attribution was incorrect.

5. **Network positions are AP-local**: Confirmed by Firestorm log comparison — `setupDrawable` shows `obj_pos_local` values are small offsets (0.08m), not skeleton heights. Formula `ap_world + ap_rot * offset` is correct.

### Remaining Issues

- **Ball avatar before animations** — `set_bone_global_pose_override` only called during anim eval
- **Hover height accuracy** — Shape → Body → Hover slider works but values don't match Firestorm
- **Volume morph position** — `<volume_morph pos=...>` entries modify CV position but only scale is currently applied

### Test Avatars

| Avatar | UUID | Type |
|--------|------|------|
| Dog (SparkleSpice) | 8f99e602-680e-4af8-bfc5-88a22491e2dc | Avatar |
| Dog animesh | e8ca0f4d-6bb9-9e4f-adb0-a72e135d6fbf | Animesh |
| Human (ostiabs) | 27df63dc-2a9e-4c4e-9fbf-404aa902e529 | Avatar |

### Firestorm Reference Code Locations

| What | File | Line/Function |
|------|------|---------------|
| World matrix with scale | `xform.cpp` | line 93: `initAll(mScale, mWorldRotation, mWorldPosition)` |
| Parent scale on children | `xform.cpp` | line 76: `mWorldPosition.scaleVec(mParent->getScale())` |
| Skinning matrix palette | `llskinningutil.cpp` | line 182: `matMul(invBind, world, mat)` |
| Attachment setupDrawable | `llviewerjointattachment.cpp` | lines 108-130: world→AP-local conversion |
| Override application | `llvoavatar.cpp` | `addAttachmentOverridesForObject` ~line 7744 |
| Override threshold | `lljoint.cpp` | `aboveJointPosThreshold` line 398 (0.1mm) |
| Shape scale application | `llpolyskeletaldistortion.cpp` | `apply()` lines 189-227 |
| Sex filtering | `llpolyskeletaldistortion.cpp` | `apply()`: `(getSex() & avatar_sex) ? mCurWeight : getDefaultWeight()` |
| ControlAvatar (worn animesh) | `llcontrolavatar.cpp` | Separate avatar with own skeleton |
