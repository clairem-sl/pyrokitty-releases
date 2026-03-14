# Avatar Shape Deformation

**Status:** Partially working — shapes apply and produce visible proportional changes, but needs mesh cache clear and further testing.

## Architecture (IMPLEMENTED)

```
SL Server → AvatarAppearance msg (VisualParam[] U8 bytes)
  → electron-ui: avatar-shape.ts dequantizes bytes, accumulates per-bone scale/offset
  → WebSocket: { type: "avatar_shape", avatarId, bones: {name: {scale, offset}} }
  → Godot: resets bone rests to XML baseline + shape deltas
```

### Files Modified/Created
| File | Change |
|------|--------|
| `electron-ui/src/main/avatar-shape.ts` | **NEW** — parses avatar_lad.xml, computes bone deltas |
| `electron-ui/src/main/godot-avatar-manager.ts` | Extracts VisualParam bytes, computes & sends shape; buffers shapes for flush on connect |
| `electron-ui/src/main/mesh-converter.ts` | **BUG FIX** — removed vec3Dist threshold from joint override list (line ~1022) |
| `godot-viewer/src/main.gd` | Routes `avatar_shape` message |
| `godot-viewer/src/scene_manager.gd` | Passthrough `handle_avatar_shape()` |
| `godot-viewer/src/object_manager.gd` | `_avatar_shapes` storage, `_apply_shape_to_skeleton()`, `_reapply_joint_overrides()`, pending shape in `avatar_create` |
| `godot-viewer/src/skeleton_builder.gd` | Added `get_bone_data()` accessor |

## Key Lessons Learned

### 1. SL Bone Scale = Parent Scale on Child Position (NOT basis scale)
**Source:** `firestorm/indra/llmath/xform.cpp` lines 73-77 and `llpolyskeletaldistortion.cpp` lines 197-219

In SL, `joint->setScale(newScale)` does TWO things:
- The joint's scale is stored and used in the skinning world matrix (`initAll(mScale, mWorldRotation, mWorldPosition)`)
- The parent's scale multiplies child bone positions during world transform: `mWorldPosition.scaleVec(mParent->getScale())`
- `mScaleChildOffset` is `true` for all joints (set in lljoint.cpp:107)

**Critical:** In Godot, `Basis.from_scale()` on a rest transform cascades scale through the ENTIRE subtree, inflating all descendant geometry. This is NOT how SL works. SL scale only affects direct children's positions and the skinning matrix for vertices bound to that specific joint.

**Current approach:** Apply parent's shape scale to each child's rest position (in SL space, before coordinate conversion). Do NOT put scale in the basis. This handles proportions correctly but does not replicate the per-joint skinning scale effect (which would require custom shader work).

### 2. AvatarAppearance Arrives Before Godot Connects
Shape messages were silently dropped because `this.send()` checks `this.connected`.

**Fix:** Buffer shapes in `avatarShapes` Map on the TS side. Flush all buffered shapes in `setConnected(true)`. Godot side also handles the race: `handle_avatar_create` checks `_avatar_shapes` dict for pending shapes.

### 3. VisualParam Byte Ordering
Bytes are sorted by param ID (ascending). `avatar_lad.xml` has ~253 params with IDs. The SL viewer iterates `std::map<S32, LLVisualParam*>` which is sorted by key. Our parser sorts by ID to match.

### 4. Dequantization Formula
```
weight = (byte / 255.0) * (value_max - value_min) + value_min
bone_scale = (1,1,1) + Σ(weight_i × xml_scale_delta_i)
bone_offset = Σ(weight_i × xml_offset_delta_i)
```
Scale is incremental in SL (adds `(currentWeight - lastWeight) * delta` to current scale). Since we compute from scratch each time, we accumulate `weight * delta` starting from (1,1,1).

### 5. Driver Params — NOT Double-Counted (Verified)
Driver params (e.g., id=2 "Big_Head") drive other params (e.g., 20002, 30002). The driven params' bytes in AvatarAppearance already contain computed values. However, the driven params for skeleton are typically 20xxx IDs and most of them are `param_morph`, NOT `param_skeleton`. We verified the TS-side deltas are correct and symmetric for left/right bones.

### 6. Joint Override List Bug (mesh-converter.ts)
**Bug:** `mesh-converter.ts` line ~1022 filtered the `jointOverrides` list to only include bones where `vec3Dist(altIBM_translation, xmlDefault) > 0.0001`. This caused asymmetric overrides — e.g., mKneeLeft included but mKneeRight excluded because the right knee's alt IBM happened to match default within threshold.

**Fix applied:** Removed the distance threshold. ALL joints with alt_inverse_bind_matrix entries are now included in the override list. In SL, every alt IBM joint gets an override regardless of distance from default.

**IMPORTANT:** Existing `.meta` sidecar files in the mesh cache have the old (filtered) override lists. Must clear `.meta` files from:
```
C:\Users\callcolor\AppData\Roaming\pyrokitty-ui\asset-cache\meshes\
```
Delete `.meta` files (or entire directory) and restart for the fix to take effect. GLB files themselves are fine.

### 7. Coordinate Conversion Reference
| Data | SL space | Godot space |
|------|----------|-------------|
| Position | (x, y, z) | (x, z, -y) |
| Scale (parent→child pos) | (sx, sy, sz) | applied in SL space before pos conversion |
| Offset | (ox, oy, oz) | applied in SL space before pos conversion |

## What Was Tried (Chronological)

1. **Basis.from_scale() on rest transform** — Made avatars hugely wide. Wrong because Godot basis scale cascades through entire subtree.
2. **Scale multiplied onto bone's OWN position** — Better proportions but logically wrong. SL scales child positions, not self position.
3. **Parent scale applied to child position (current)** — Correct proportional changes. Verified symmetric deltas from TS side. Legs and body proportions look reasonable.

## Remaining Work

1. **Skinning scale** — Current implementation only affects bone positions (proportions). SL also puts joint scale into the skinning world matrix, which subtly affects vertex positions near joints. This is a minor visual difference and may not be worth fixing.
2. **Shape change live update** — When an avatar changes shape in-world, a new AvatarAppearance arrives. The `handle_avatar_shape` path handles this (resets rests + reapplies overrides). Needs testing.
3. **Hover height** — `AppearanceHover` is separate from shape and not implemented.

## Firestorm Source References
- `indra/llappearance/llpolyskeletaldistortion.cpp` — shape deformation apply logic
- `indra/llmath/xform.cpp` lines 69-87 — world transform with parent scale
- `indra/llcharacter/lljoint.cpp` line 107 — `setScaleChildOffset(true)` for all joints
- `indra/llcharacter/lljoint.cpp` lines 868-889 — `setScale()` with attachment override
