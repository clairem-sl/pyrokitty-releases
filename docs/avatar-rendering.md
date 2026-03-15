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
- **Position keyframes are ADDITIVE offsets from rest**, not absolute. Compressed to [-5, 5] meters via UInt16.
- **Rotation keyframes**: UInt16 compressed [-1, 1] per component (NOT Euler). Decoded as quaternion directly.
- **Per-channel priority**: Rotation and position priority tracked INDEPENDENTLY per joint. An animation with position keys but no rotation keys claims position only — does NOT block lower-priority rotation.
- **Bone rotation order**: SL `operator*` is reversed Hamilton; our code uses standard `parent_world * local` which is equivalent.

### Micro-Loop Quirk (Hand/Finger Poses)
SL hand/finger poses are micro-loops (duration ~0.083s) with an identity first keyframe meant for the ease-in system, NOT for playback. Without handling, fingers twitch between identity and target each loop.

**Fix**: Clamp animations with `duration < 0.2s` to `loop_out` pose after first pass.

**Future**: Proper ease-in/ease-out system would fix this generically.

### Degenerate CV Bone Bases
Collision volume bones can have zero-column bases from IBM scale amplification (10-20x scale values). `_safe_basis_rotation()` falls back to `Quaternion.IDENTITY` when `determinant() < 0.5`. This prevents 20k+/session errors.

---

## Shape Deformation

Applies avatar appearance slider values to the skeleton for per-avatar proportions.

### Pipeline
```
SL Server → AvatarAppearance msg (253 VisualParam U8 bytes)
  → metaverse-connection.ts: buffers bytes during login
  → avatar-shape.ts: computeSkeletonDeltas() via fast-xml-parser
  → WebSocket → Godot: { type: "avatar_shape", avatarId, bones }
  → object_manager.gd: _apply_shape_to_skeleton() + _reapply_joint_overrides()
```

### Dequantization
```
weight = (byte / 255.0) * (value_max - value_min) + value_min
bone_scale = (1,1,1) + Σ(weight_i × param_scale_delta_i)
bone_offset = Σ(weight_i × param_offset_delta_i)
```

### SL Bone Scale Semantics
Parent scale multiplies child bone positions (`xform.cpp: mWorldPosition.scaleVec(mParent->getScale())`). This is NOT Godot basis scale (which would cascade through the entire subtree). We apply parent scale to each child's local position in SL space before coordinate conversion.

### Critical Implementation Details

**Byte array = groups 0 + 3 (NOT 0 + 2).** The enum naming is misleading:
- Group 0: TWEAKABLE — transmitted
- Group 1: ANIMATABLE — NOT transmitted (driven by group 0 drivers)
- Group 2: TWEAKABLE_NO_TRANSMIT — NOT transmitted
- Group 3: TRANSMIT_NOT_TWEAKABLE — transmitted

Source: `llvoavatar.cpp` `expected_tweakable_count = group(TWEAKABLE) + group(TRANSMIT_NOT_TWEAKABLE)`

**253 params exactly.** Any count mismatch = byte misalignment = crooked faces. `avatar_lad.xml` has a duplicate (id=664 "Pop_Eye") — deduplicate by ID (last wins, matching SL's `std::map`).

**Use a real XML parser.** `avatar_lad.xml` has multiline tags (e.g., id=702 spans 12 lines). Line-by-line and regex parsers both fail. We use `fast-xml-parser`.

**Driver weight = trapezoidal activation, NOT linear remap.** SL's `getDrivenWeight()` uses piecewise min1/max1/max2/min2 activation. 135 of 360 driven entries have explicit ranges. Without this, bidirectional sliders (Shift_Mouth, Pop_Eye) activate BOTH directions simultaneously → crooked nose, asymmetric eyes.

**Login timing.** AvatarAppearance arrives before GodotBridge subscribes. `metaverse-connection.ts` buffers `avatarVisualParamBuffer`, seeded to avatar manager on bridge init.

### Not Implemented
- **Skinning matrix scale**: SL puts joint scale into the skinning world matrix for per-vertex deformation. Minor visual difference, would require custom shader.
- **Morph targets**: Face detail deformation via vertex morphs (blend shapes). Separate from skeleton shape.
- **Hover height**: `AppearanceHover` is separate from shape params.

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

- **Prim attachments diverge during walk**: Rigged mesh and prim attachment positions can diverge during locomotion
- **Half t-pose on some meshes**: Lel heads, some tail joints not fully resolved
- **Degenerate CV bone poses**: Falling back to IDENTITY/rest instead of animated
- **Self-avatar animation batch not logged**: Own UUID never appears in batch ready logs
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

1. **Our shape scale computation matches Firestorm exactly** — verified by adding `BONE_SCALE` logging to Firestorm's `updateVisualParams()` and comparing against our `computeSkeletonDeltas()`. All body bones match (mPelvis, mHips, mKnees, mTorso, mChest, mNeck, etc.). Unit tests added in `avatar-shape.test.ts` with real avatar byte data.

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

#### Issue 1: IBM/Rest Position Mismatch (Root Cause of Eyes, Head Droop)

The mesh converter computes IBMs and skeleton node positions from DIFFERENT sources:
- **IBMs**: computed from XML world transforms via `getWorldPos()` which walks the XML parent chain (lines 820-823 of mesh-converter.ts). These reflect the DEFAULT skeleton.
- **Skeleton nodes**: may have override positions from `alt_inverse_bind_matrix` (line 870-877). These reflect the MESH CREATOR's intended skeleton.

When a bone has an override that differs from XML default, the IBM says "this bone was at (XML world pos)" but the rest says "this bone is at (override pos)." The skinning pipeline computes `globalPose * IBM` — if they don't match, vertices get displaced. This is why the dog's eyes pop out of its head (mEyeLeft override is 0.36 from XML default).

**The fix (Approach 3, not yet tried):** Compute IBMs from the override-modified skeleton, not from XML defaults. After applying override positions to skeleton nodes (line 870-877), use those node positions for the IBM `getWorldPos()` calculation. Then IBMs and rest positions will be consistent.

Once IBMs are correct, we can safely remove parent scale from overrides (Approach 1) without causing eye popping — because IBMs and rest would both be in the same coordinate space (no parent scale in either). The no-op override threshold filter would still keep near-default bones at shape positions, preventing the leg asymmetry.

#### Issue 2: Alt IBM Translation Discrepancy

Our mesh converter and Firestorm both extract translation from flat indices [12,13,14] of the alt_inverse_bind_matrix. Both get the same raw values. We confirmed this by adding `OVERRIDE_APPLIED` logging to Firestorm — it shows the same override positions as our converter (e.g., mHead at (0.373, 0, 0.713), mNeck at (0.114, 0, 0.694)).

However, our Godot-side threshold filter (0.0001) only catches 1-2 of 43 bones as "at default." The rest have distances of 0.04-0.1 from XML defaults. These ARE genuine override positions — the dog mesh creator repositioned these bones for a quadruped head shape (mHead at 0.713 above mNeck vs default 0.076).

Firestorm's `aboveJointPosThreshold` would also pass these (they're way above 0.1mm). And Firestorm DOES apply them — the `OVERRIDE_APPLIED` log confirms it. Our earlier `BONE_POS` log that showed mHead at default was misleading — it ran during `updateVisualParams` (shape changes) BEFORE mesh overrides were applied.

**Key finding:** The override positions ARE correct and match Firestorm. The problem is not the positions themselves but the IBM mismatch (Issue 1 above).

#### Issue 3: Head Droop on Dog Avatar

The dog's head droops in Godot but looks forward in Firestorm. Both viewers have the same mHead override position (0.373, 0, 0.713). No animation drives mHead rotation on the avatar (we checked all 11 animations — none have mHead/mNeck keys). The animesh has 3 animations with mHead/mNeck keys (7ae516bc, 887c2ebf, 9cdd29bd) but those play on the animesh's own skeleton, not the avatar's.

Likely caused by the IBM/rest mismatch (Issue 1). When the IBM and rest position disagree, the skin mesh is displaced. Combined with parent scale baking on the override position, the head's visual position is wrong, making it appear to droop. Fixing IBMs (Approach 3) should resolve this.

#### Issue 4: Parent Scale Baking vs Dynamic Application

Firestorm applies parent shape scale dynamically during world transform each frame. We bake it into rest positions. This produces different world positions for overridden bones:
- **Firestorm**: `worldPos = parent.worldRot * (overridePos * parent.scale) + parent.worldPos` — override is raw, scale applied dynamically
- **Our viewer**: `rest = overridePos * parent.scale` — scale baked into rest, then Godot walks hierarchy

We verified the position difference by comparing BoneDump output:
| Bone | Firestorm (raw) | Our viewer (baked) | Ratio |
|------|----------------|-------------------|-------|
| mTorso | (-0.245, 0, 0.637) | (-0.276, 0, 0.891) | 1.13x, 1.40x |
| mChest | (-0.188, 0, 1.085) | (-0.212, 0, 1.519) | 1.13x, 1.40x |
| mNeck | (0.114, 0, 0.694) | (0.131, 0, 0.764) | scaled |

The ratios match the mPelvis shape scale (1.128, 1.128, 1.400).

Dynamic application is the correct fix but requires ALL bone position consumers to use global pose overrides instead of rest positions (attachments, debug markers, etc.). We tried this (Approach 2) and it broke too many systems. With IBM fixes in place (Approach 3), we can revisit this more carefully.

#### Issue 5: Ball Avatar Before Animations

Avatars sometimes appear as a ball before their first animation evaluation. This is because `set_bone_global_pose_override` is only called during animation evaluation (30Hz throttled). Before the first eval, bones are at rest but Godot's internal pose computation doesn't correctly reflect manually-set rest transforms.

We tried running `_apply_global_pose_overrides` unconditionally for ALL skeletons every frame, but this overwrote good poses on throttled skeletons, causing T-poses. The fix should be: call `_apply_global_pose_overrides` once when a skeleton is first created or when shape/overrides are applied, not every frame.

#### Issue 6: mHead Sex Filtering

`avatar_lad_skeleton.json` lacks sex info. Firestorm's `LLPolySkeletalDistortion::apply()` checks `(getSex() & avatar_sex)` and uses `getDefaultWeight()` for params that don't match the avatar's sex. Our code always uses the byte value. This causes wrong scale on mHead (our: 0.926, Firestorm: 1.096). Need to add sex field to the JSON and filter in `computeSkeletonDeltas()`.

### Recommended Priority for Next Session

1. **Fix IBMs in mesh-converter (Approach 3)** — This is the foundation. `getWorldPos()` should use override-modified node positions, not XML defaults. Once IBMs match rest, eyes are fixed and head droop likely resolves.
2. **Remove parent scale from overrides** — With correct IBMs, Approach 1 becomes safe. Override positions and IBMs both lack parent scale → consistent skinning. Non-overridden bones keep parent scale in shape (with threshold filter preventing near-default overrides from breaking them).
3. **Ball avatar fix** — Call `_apply_global_pose_overrides` on skeleton creation and shape change, not every frame.
4. **Sex filtering** — Add sex field to `avatar_lad_skeleton.json`, filter in `computeSkeletonDeltas()`.

### Test Avatars

| Avatar | UUID | Type | Use For |
|--------|------|------|---------|
| Dog (SparkleSpice) | 8f99e602-680e-4af8-bfc5-88a22491e2dc | Avatar | Non-human mesh, head droop, eye popping, shape scale extremes |
| Dog animesh | e8ca0f4d-6bb9-9e4f-adb0-a72e135d6fbf | Animesh | Correct baseline for dog mesh (no shape) |
| Human (27df63dc) | 27df63dc-2a9e-4c4e-9fbf-404aa902e529 | Avatar | Leg asymmetry test, partial joint overrides |

### Firestorm Reference Code Locations

| What | File | Line/Function |
|------|------|---------------|
| Override application | `llvoavatar.cpp` | `addAttachmentOverridesForObject` ~line 7744 |
| Override threshold | `lljoint.cpp` | `aboveJointPosThreshold` line 398 (0.1mm) |
| Override priority | `lljoint.cpp` | `findActiveOverride` — `mOverrides.begin()` on `std::map<LLUUID>` |
| Alt IBM loading | `llmodel.cpp` | `fromLLSD` lines 1707-1722 (NO inversion, direct copy) |
| Parent scale on children | `xform.cpp` | line ~76: `mWorldPosition.scaleVec(mParent->getScale())` |
| Shape scale application | `llpolyskeletaldistortion.cpp` | `apply()` lines 189-227 |
| Sex filtering | `llpolyskeletaldistortion.cpp` | `apply()`: `(getSex() & avatar_sex) ? mCurWeight : getDefaultWeight()` |
| ControlAvatar (worn animesh) | `llcontrolavatar.cpp` | Separate avatar with own skeleton |
| Full rig threshold | `llvovolume.cpp` | `JOINT_COUNT_REQUIRED_FOR_FULLRIG = 1` |
