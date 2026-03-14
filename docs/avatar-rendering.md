# Avatar Rendering

Technical reference for avatar rendering in the Godot viewer. Covers skeleton architecture, animations, shape deformation, and SL protocol quirks.

Key files: `object_manager.gd`, `skeleton_builder.gd`, `mesh-converter.ts`, `avatar-shape.ts`, `godot-avatar-manager.ts`

---

## Skeleton Architecture

**One shared Skeleton3D per avatar/animesh root**, built from `avatar_skeleton.xml` (159 bones). All rigged meshes bind to it via skin index remapping. Animation evaluation and shape deformation operate on this single skeleton.

- Skeleton added as parent of MeshInstance3D nodes (Godot's expected hierarchy)
- `set_bone_global_pose_override()` used for both rotation AND position — Godot's `set_bone_pose_rotation()`/`set_bone_pose_position()` during `_process` are NOT reflected in `get_bone_global_pose()` until a later frame, even with `force_update_all_bone_transforms()`
- Joint overrides from mesh attachments replace bone rest positions (last mesh wins, same as SL)
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
