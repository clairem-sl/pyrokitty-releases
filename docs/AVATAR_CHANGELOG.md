# Avatar Rendering Changelog

Tracks changes to avatar rendering in the Godot viewer. Each entry documents what was changed, why, and what the outcome was.

Key files: `godot-viewer/src/object_manager.gd`, `godot-viewer/src/scene_manager.gd`, `godot-viewer/src/skeleton_builder.gd`, `electron-ui/src/main/godot-bridge.ts`, `electron-ui/src/main/godot-avatar-manager.ts`, `electron-ui/src/main/godot-object-sender.ts`, `electron-ui/src/main/texture-fetch-queue.ts`

---

## Phase 1 — Basic Avatar Rendering

**Goal:** Render avatar bodies and attachments using the existing animesh pipeline.

**Approach:** Register the avatar's localId in `animesh_roots`. Route all worn attachments (body, head, clothing, shoes) through `_instantiate_animesh_mesh` exactly like animesh linkset children.

**Outcome:** Avatar meshes render. Animations play. Bodies are recognizable.

---

## Phase 2 — Bakes of Materials (BoM)

**Goal:** Apply baked skin/clothing textures from SL's appearance service instead of showing untextured grey avatars.

**Changes:**
- `godot-avatar-manager.ts`: Subscribe to AvatarAppearance events, parse magic UUIDs, map bake channels to TextureEntry face indices (`BAKE_CHANNEL_TO_TE_FACE` in `godot-bridge-types.ts`). Also handles re-emit when bakes arrive after attachments.
- `texture-fetch-queue.ts`: `requestBake` + `downloadBakeTexture` — download bake textures via appearance service URL (`{agent_appearance_service}texture/{avatarUUID}/{channelName}/{textureUUID}`)
- `godot-object-sender.ts`: `substituteBakeUuids()` called on all material re-emit paths to prevent legacy material updates from clobbering bake substitutions. Avatar manager wired in via `setAvatarManager()` to break circular dependency.
- `godot-material-pipeline.ts`: `substituteBakeUuids()` helper
- `texture-decode-worker.ts`: Fixed 5-component J2C bake textures (SL bakes have RGBA + bump channel; strip to 4 before passing to sharp)
- `TextureEntry.ts` (node-metaverse): Fixed 32-bit bitfield bug — JS `<<` truncates at 32 bits, bake texture indices 41-45 were unreadable. Fixed with arithmetic `* 128` and `hasBit()` helper.

**Outcome:** Avatar skin, hair, and clothing bakes display correctly.

---

## Phase 3 — Animation System Overhaul

**Goal:** Fix avatar animations so all body parts move correctly in Godot.

### AnimationPlayer attempt (ABANDONED — do not retry)
**Problem:** SL animation format uses `world = local * parent` rotation composition; Godot uses `world = parent * local`. Applying SL keyframe rotations directly to a Godot `AnimationPlayer` produces wrong bone orientations — rotations compound incorrectly when parent bones rotate.

**Attempt:** Used `AnimationPlayer` nodes (one per mesh), built `Animation` resources from SL keyframe data, played animations via `player.play()`.

**Why it failed:** The rotation order mismatch is fundamental. AnimationPlayer sets local pose directly from track data; there is no way to intercept the accumulation step to apply the SL→Godot conjugation. Avatars were distorted or posed incorrectly regardless of coordinate conversions applied to the keyframe data.

**Abandoned in:** commit `86aaa8257f` ("some animesh progress, click things!")

### Manual per-frame animation evaluation (CURRENT)
**Approach:** Remove all `AnimationPlayer` nodes. Instead, store raw SL keyframe data in `animesh_eval` (a dict per root: elapsed time + per-joint rot/pos keys). Each frame in `process_animesh`, evaluate SL-space rotations by interpolating keyframes, convert to Godot world space with the proper conjugation (`combined_inv * q_godot_world`), then set `set_bone_pose_rotation`/`set_bone_pose_position` directly.

**Per-joint priority merging:** Multiple animations (STAND, WALK, attachment animations) are merged by per-joint priority. `joint_best` dict selects highest-priority animation per joint. Each joint also independently tracks its own duration and loop flag (from its source animation), so different-length animations play correctly.

**Collision volume scale amplification fix:** CV bones have non-uniform scale in their rest basis (from IBMs). When converting position keyframes to pose space via `rest_basis.inverse()`, this amplified positions 10–20×. Fix: strip scale from rest basis (`Basis(rest_xf.basis.get_rotation_quaternion())`) before inverting.

**Outcome:** Animations play correctly. Priority merging works. Loop timing is per-joint independent.

### Per-skeleton animation evaluation
**Problem:** All mesh skeletons were evaluated using the first skeleton as a reference. If the first skeleton was a boot (11 bones), head bones were never computed.

**Fix:** Each mesh skeleton evaluated independently. `_apply_world_to_mesh_skeleton` called on every entry in `animesh_mesh_skeletons`.

**Outcome:** Full-body animations evaluate correctly across all attached meshes.

### Recursive `getGlobalPosition` for grandchild objects
**Problem:** `godot-object-sender.ts` only walked one level up the parent chain. Grandchild objects (child → attachment → avatar) computed wrong distance (~182m instead of ~3m), deferring texture fetches indefinitely.

**Fix:** Walk full parent chain for nested children.

**Outcome:** Textures load correctly for grandchild prims.

### Degenerate basis fix
**Problem:** Collision volume bones have non-uniform scale → zero rows in basis → crash in `get_rotation_quaternion()`.

**Fix:** Call `.orthonormalized()` before `.get_rotation_quaternion()` on bone rest transforms.

**Outcome:** No crash on collision volume bones.

### Avatar RSI placeholder hiding
**Problem:** The avatar's blue-box RSI placeholder (from `sm.avatars`) was not hidden when the first rigged mesh loaded.

**Fix:** `_instantiate_animesh_mesh` hides the avatar RSI when the first rigged mesh loads.

**Outcome:** Blue box disappears when body mesh renders.

### Half t-pose history (partially fixed)

**Root cause:** Shared XML skeleton rest positions don't match per-mesh IBM rest positions. When all meshes are bound to one shared skeleton (which has XML-derived rest poses), the IBMs in each mesh don't cancel out correctly → wrong world positions for vertices.

**Failed approaches (do not retry):**
1. **Shared skeleton only (early):** One Skeleton3D from XML for all meshes. IBMs don't match rest transforms → t-pose distortion.
2. **Per-mesh skeleton, first-skeleton-as-reference:** Each mesh had its own Skeleton3D (from GLB). Animation evaluated once using first skeleton found. If first skeleton was a boot (11 bones), head never moved.
3. **`animesh_root_skeletons` list:** Introduced in commit `c69cab0c6f`. Maintained `Array[Skeleton3D]` per root. Animation evaluated independently per skeleton. Still caused divergence because each mesh evaluated independently without a common reference.

**Current fix — Hybrid skeleton architecture:**
- ONE shared Skeleton3D per avatar root, built from `avatar_skeleton.xml` (159 bones) via `skeleton_builder.gd`. Used only for animation evaluation.
- Each rigged mesh keeps its own per-mesh Skeleton3D from the GLB file (for rendering). IBMs are always correct relative to GLB rest transforms.
- After evaluating poses on the shared skeleton, `_apply_world_to_mesh_skeleton` propagates Godot-space world rotations by bone name to every per-mesh skeleton.
- This works because: (a) all bones are evaluated on a common reference skeleton, (b) per-mesh IBMs remain correct since each mesh is still bound to its own skeleton.

**Outcome:** Bodies recognizable. Remaining issues: Lel heads, some tail joints.

---

## Phase 4 — Non-Rigged Prim Attachment Bone Tracking

**Goal:** Non-rigged prim attachments (spheres, cylinders, boxes worn at attachment points) should follow their attachment point bone during animation, matching SL behavior.

### Added `attach_bone` tracking
**Change:** When a non-rigged object has `attachmentPoint > 0`, look up the bone name from `ATTACH_POINT_BONES` map (55 entries from `avatar_lad.xml`), store in `sm.attach_bone[local_id]`.

**Outcome:** System knows which bone each prim attachment should follow.

### Added `_update_bone_attachments` (called each frame from `process_animesh`)
**Change:** For each prim attachment with a tracked bone, use the **anchor strategy** to compute the bone's world transform:

1. Build chain from skeleton root to target bone.
2. Find the deepest ancestor of the target bone that exists in any per-mesh skeleton (this is the "anchor").
3. Read full animated transform from per-mesh skeleton up to anchor (these transforms match what the GPU renders).
4. Chain from anchor+1 down to target bone using shared skeleton rest + pose.

This is needed because the shared skeleton and per-mesh skeletons can have divergent positions when animation position keyframes move root bones (e.g. mPelvis during walk).

**Status:** Implemented and running. Results are inconsistent ("half working sometimes"). Prim attachments may still diverge from rigged mesh positions during walk animations.

### Removed incorrect +0.9 height offset
**Problem:** Avatar position was offset up by 0.9m from ground, placing all meshes and attachments too high.

**Fix:** Removed `godot_pos.y += 0.9` from `handle_avatar_create` and `_apply_avatar_target`.

**Outcome:** Avatar and boots near ground level.

---

## Phase 5 — Architecture Changes (2026-03-08)

### godot-bridge.ts modular split
**Problem:** `godot-bridge.ts` had grown to ~2000 lines and was unmaintainable.

**Change (commit `c69cab0c6f`):** Split into 7 focused modules:
- `godot-animation-manager.ts` — animation asset fetching and caching
- `godot-avatar-manager.ts` — avatar lifecycle, BoM subscription
- `godot-environment-manager.ts` — environment/sky/fog
- `godot-input-handler.ts` — keyboard/mouse input, sitting
- `godot-material-pipeline.ts` — PBR material asset fetching
- `godot-object-sender.ts` — object creation/update/kill
- `godot-update-coalescer.ts` — batched updates

**Outcome:** Cleaner structure. This split is the current architecture — do not consolidate back.

### animesh_manager.gd (CREATED AND ABANDONED — do not retry)
**Attempt (commit `c69cab0c6f`):** Extracted all animesh instantiation logic from `object_manager.gd` into a separate GDScript file `animesh_manager.gd` (519 lines). The file was referenced via `sm.animesh_mgr.*` calls.

**Why abandoned (commit `3d6caa31e4`):** Named "broken avatars" — the separation introduced state management bugs. The animesh logic is deeply intertwined with object lifecycle (create/kill/update) and skeleton state, and the cross-file boundary added complexity without benefit.

**Replaced by:** `skeleton_builder.gd` (124 lines, parses `avatar_skeleton.xml` and creates shared Skeleton3D instances only) + inline code in `object_manager.gd`.

**Do not retry:** Extracting animesh logic into a separate `.gd` manager file causes state synchronization bugs. Keep animesh code in `object_manager.gd`.

### Worn animesh routing
**Problem:** Worn animesh objects (animesh flag set, child of avatar) were creating their own Node3D root and skeleton, separate from the avatar's skeleton. This meant worn animesh characters didn't share animation evaluation with the avatar.

**Fix (commit `3d6caa31e4`):** When an animesh object has `parent_id` in `animesh_roots` (i.e. its parent is the avatar), it routes through the avatar's animesh root instead of creating a new one. Animations from worn animesh are stored in `animesh_worn_anims[avatar_root_id]` (separate dict) so they don't get overwritten by the avatar's own animation batch updates.

**Outcome:** Worn animesh characters share the avatar skeleton for animation evaluation.

### Static mesh for non-animesh rigged meshes
**Problem:** Some rigged mesh assets have a non-identity `bindShapeMatrix` (BSM). When a rigged mesh is displayed as a static prop (non-animesh), the BSM pre-transforms the mesh into an unexpected bind-pose position, causing misalignment.

**Fix (commit `dfcc7be4b4`):** When a rigged mesh has a non-identity BSM, generate a second GLB file (`*.static.glb`) without the BSM applied. Non-animesh display uses `static_mesh_cache` / `static_mesh_paths` to load this variant. `readMeshMeta` and `MeshConvertResult` now carry `staticCachePath`.

**Outcome:** Non-animesh rigged meshes (e.g. catgirl mesh displayed as a prop) render at correct scale/position.

---

## Phase 6 — Degenerate Basis Fix (2026-03-10)

### 20,000+ per-session `get_rotation_quaternion` errors (FIXED)

**Problem:** Every frame, 8 specific bones in per-mesh GLB skeletons produced a degenerate (zero or near-zero column) basis when `orthonormalized()` was called. `get_rotation_quaternion()` then crashed with:
```
ERROR: Basis must be normalized in order to be casted to a Quaternion.
```
4 patterns at ~2,773 hits/frame each, plus ~4 fully-zero bases, totalling ~20k errors per 60-second session. The affected bones got garbage/identity pose rotations every frame instead of correct animation poses.

**Root cause:** Per-mesh GLB skeletons are built from IBMs via `Local = parent_JW⁻¹ × child_JW`. Collision volume bones have large-scale IBMs (e.g. scale=20), so their `JW = mat4Inverse(IBM)` has scale ≈ 0.05. When the CV bone's parent is a standard bone with `JW ≈ identity`, the local transform ends up with scale ≈ 0.05 on all axes. `Basis.orthonormalized()` handles this fine (normalizes the small-but-nonzero columns). However some bones end up with **literally zero columns** — either from a singular IBM that `mat4Inverse()` returns null for (unhandled in mesh-converter), or from CV bones whose parent chain produces a zero component after the SL→Godot axis remap. `orthonormalized()` on a zero column returns zero, and `get_rotation_quaternion()` then errors.

**Fix:** Added `_safe_basis_rotation(b: Basis) -> Quaternion` helper in `object_manager.gd`. Calls `b.orthonormalized()`, then checks `absf(on.determinant()) < 0.5` — a valid rotation matrix has det=1, a degenerate result has det≈0. Falls back to `Quaternion.IDENTITY` for degenerate bases. Applied at all three call sites:
- `process_animesh` line 899: shared skeleton CV bone rest rotation
- `_apply_world_to_mesh_skeleton` line 1131: per-mesh skeleton rest rotation for pose derivation
- `_apply_world_to_mesh_skeleton` line 1141: per-mesh skeleton rest rotation for position keyframe conversion

**Outcome:** Zero errors in new session. Eval improving (13→14 of 15 roots). Bones with degenerate rest hold identity pose instead of garbage — better than before even if not perfect.

---

## Phase 7 — Animesh Skeleton Isolation Fix (2026-03-10)

### Shared skeleton in scene tree breaks animesh skin binding (FIXED)

**Problem:** Non-avatar animesh objects (e.g. Solarian cat) had "some bones rotate, others don't" — a subtle partial animation regression introduced in commit `3d6caa31e4`.

**Root cause:** The hybrid skeleton architecture added a shared Skeleton3D (159 bones from avatar_skeleton.xml) as a sibling of the per-mesh Skeleton3D nodes under the animesh root Node3D. Godot's skin binding resolves Skeleton3D references during scene tree insertion — having two Skeleton3D siblings caused some MeshInstance3D skins to partially bind to the shared skeleton instead of their per-mesh skeleton. Since the shared skeleton has XML-derived rest transforms (different from the per-mesh GLB/IBM-derived transforms), affected bones received wrong pose derivations.

**Fix:** Don't add the shared skeleton to the scene tree for non-avatar animesh objects. Keep the reference in `sm.animesh_shared_skeleton` for bone position lookups and prim attachment tracking, but don't call `animesh_node.add_child(shared_skel)`. The shared skeleton's `set_bone_pose_rotation`/`find_bone`/etc. all work without being in the scene tree.

**Also reverted:** `mat4NormalizeRotation` in mesh-converter.ts (stripped scale from standard bone rest transforms in GLB) — this was an incorrect optimization that changed the IBM-derived rest transforms. And reverted per-mesh animation evaluation to match the old per-skeleton approach from `c69cab0c6f` (each skeleton evaluated independently using its own rest transforms, keyed by bone index).

**Outcome:** Animesh objects animate correctly. All child meshes receive proper per-bone animation.

**Do not retry:** Adding a shared Skeleton3D as a sibling of per-mesh Skeleton3D nodes under the same parent. Godot's skin binding gets confused by multiple Skeleton3D siblings. For avatars, the shared skeleton IS added to the scene tree — this may need the same fix if avatar meshes show similar issues.

---

## Phase 8 — Shared Skeleton (2026-03-10)

### Replace per-mesh skeletons with ONE shared skeleton per avatar/animesh root

**Problem:** The hybrid skeleton approach (Phase 7) kept per-mesh Skeleton3D nodes from GLBs for rendering and a shared XML skeleton for animation evaluation. This required complex per-mesh propagation in `process_animesh` and an "anchor strategy" in `_update_bone_attachments` to find bones across multiple skeletons.

**Change:**
- **ONE Skeleton3D per avatar/animesh root**, built from `avatar_skeleton.xml` (159 bones). All worn meshes bind to it.
- **Joint position overrides**: When a rigged mesh loads, `_apply_joint_overrides()` computes bone world transforms from the GLB skeleton's IBM-derived rest hierarchy and applies matching local rest transforms to the shared skeleton. Last mesh wins (same as SL).
- **Shared skeleton as parent**: MeshInstance3D nodes are reparented under the shared skeleton (Godot's expected pattern for skin binding). No per-mesh Skeleton3D nodes.
- **Single evaluation pass**: `process_animesh` evaluates animation on the shared skeleton once per root. No per-mesh iteration.
- **Simplified attachment tracking**: `_update_bone_attachments` reads bone transforms directly from the shared skeleton instead of searching across per-mesh skeletons.
- Non-avatar animesh objects now add the shared skeleton to the scene tree (previously avoided to prevent skin binding confusion with per-mesh sibling skeletons — no longer an issue since per-mesh skeletons are removed).
- Removed `animesh_mesh_skeletons` dictionary and `_collect_joint_position_overrides` (superseded by `_apply_joint_overrides`).

**Files changed:** `object_manager.gd`, `scene_manager.gd`

**Outcome:** Shared skeleton, animation evaluation, debug markers, and prim attachment tracking all work. Skin binding to the shared skeleton does NOT work — see Phase 9.

---

## Phase 9 — Shared Skeleton Skin Binding Investigation (2026-03-11)

### Problem: meshes don't deform when bound to the shared skeleton

After Phase 8, the shared skeleton is correct (debug bone markers track animation perfectly, prim attachments follow bones). But rigged meshes reparented under the shared skeleton do not deform — they sit static at their vertex positions ignoring the skeleton entirely.

### What was tried

1. **Skin bind_name remapping** — Set `skin.set_bind_name(i, bone_name)` for each bind to resolve by name instead of index. No effect.

2. **Skin bind_bone index remapping** — Remapped `skin.set_bind_bone(i, shared_skel.find_bone(name))` to correct indices in the 159-bone shared skeleton. No effect.

3. **Both bind_name + bind_bone** — Set both simultaneously. No effect.

4. **bind_bone only (clear bind_name)** — Set bind_name to "" to force index-based lookup. No effect.

5. **Fresh MeshInstance3D (no reparenting)** — Created a brand-new MeshInstance3D, copied `.mesh` and `.skin`, added directly as child of shared skeleton. Avoids Godot 4.4 reparent regression (godotengine/godot#98349). No effect.

6. **Deferred skin assignment** — Set skin and skeleton path via `call_deferred()` after the node is in the tree. No effect.

7. **Skin assignment after reparenting** — Clear skin before reparent, set it after `add_child`. No effect.

8. **Godot 4.7-dev2** — Tested with `Godot_v4.7-dev2_mono_win64` to see if the regression was fixed in newer Godot. No effect.

### What DID work

**A/B test: GLB's own skeleton** — Keeping the mesh under its own GLB-imported Skeleton3D (with original unmodified skin) produces a perfect T-pose at correct scale, shape, and location. The mesh + skin + skeleton from GLB import are a matched set that Godot handles correctly.

### Key findings

- **Bone rest transforms match exactly** — Compared first 10 bones of GLB skeleton vs shared skeleton: all `match=true` with < 0.001 distance tolerance. The XML-derived transforms in both are identical.
- **Mesh data is correct** — `ARRAY_BONES` and `ARRAY_WEIGHTS` present on all surfaces. Bone indices and weights are valid.
- **Skin binds resolve correctly** — Debug logging confirms bind_bone indices map to correct shared skeleton bones, bind_poses (IBMs) have expected values.
- **This is NOT the godotengine/godot#98349 reparent bug** — Fresh MeshInstance3D (never reparented) and Godot 4.7-dev2 both fail identically.

### Root cause hypothesis

Godot's `Skeleton3D.register_skin()` creates a `SkinReference` that maps skin binds to skeleton bones. The rendering server uses this to compute `RS_bone[i] = bone_global_pose[bind_index] * bind_pose[i]`. Something in this pipeline fails when the Skin resource was created by GLTFDocument for one Skeleton3D and then applied to a different Skeleton3D — even when bone names, indices, and rest transforms are identical. Possibly an internal caching/identity check on the Skin or Skeleton3D RID.

### GLB skeleton changes (mesh-converter.ts)

During this investigation, the GLB skeleton generation was rewritten to use `avatar_skeleton.xml` positions instead of `inverse(IBM)`:
- Joint world transforms computed from XML hierarchy (standard bones: translation only; CVs: rotation + scale via `slCvLocalTransform`)
- IBMs recomputed as `inverse(joint_world_transform)` — consistent with skeleton nodes
- Added `scale` field to `SkeletonJoint` interface and XML parser
- Added `slCvLocalTransform()` matching `skeleton_builder.gd`'s `_sl_cv_basis`
- Result: GLB opens correctly in Blender with proper human proportions, and Godot's GLTFDocument import produces a skeleton with rest transforms matching the shared skeleton exactly

### Approaches tried (continued from Phase 9 investigation)

1. **`Skeleton3D.create_skin_from_rest_transforms()`** — Created native skin from shared skeleton, filtered to mesh's bones. **Did not fix deformation.** Bind poses were identical to GLB's anyway.

2. **`Skin.new()` with manual binds** — Built skin from scratch with `set_bind_count/set_bind_bone/set_bind_name/set_bind_pose`. **Did not fix deformation.**

3. **Modify original skin in-place** — Remapped `bind_bone` indices on the GLB skin directly. **Did not fix deformation.**

4. **Duplicate + remap** — `orig_skin.duplicate()`, remap bone indices. **Did not fix deformation** — or so we thought (see breakthrough below).

5. **No skin modification at all** — Reparented mesh with original unmodified GLB skin. **Some meshes deformed** (with wrong bone mapping), proving the binding mechanism DOES work.

### The breakthrough: forced rotation test

Applied extreme rotation to bone 0 (mPelvis) — ALL meshes rotated 90°. This proved:
- Skinning mechanism works ✓
- Binding to shared skeleton works ✓
- Both with unmodified AND with duplicate+remapped skin ✓

Applied forced rotation to mElbowRight — mesh bent at the correct elbow location, confirming bone index remapping is correct.

**The real problem was NOT skin binding — it was bone POSITION.**

### Root cause: `pose_global` missing rest translation

Godot's `get_bone_global_pose()` returns `pose_global` which is computed during `NOTIFICATION_UPDATE_SKELETON`. When we call `set_bone_pose_rotation()` / `set_bone_pose_position()` in our animation evaluation (during `_process`), these fire AFTER the skeleton update step. The next skeleton update should pick them up, but empirically:

```
get_bone_global_pose(mPelvis).origin ≈ (0, 0, 0)   ← WRONG
Expected: rest.origin + pose_pos ≈ (0, 1.067, 0)   ← rest translation missing
```

Even `force_update_all_bone_transforms()` didn't fix it. The `pose_global` equals `pose_cache` directly (without `rest *` multiplication). This is the **exact same timing issue** we hit with BoneAttachment3D / debug markers — Godot's internal bone transforms don't reflect our manual `set_bone_pose_*` calls until a later frame.

### The fix: `set_bone_global_pose_override()`

Same approach as the debug markers: manually compute `rest * pose` for every bone (walking the parent chain), then force it into the skin pipeline via `set_bone_global_pose_override(bi, transform, 1.0, true)`.

Added at the end of `_evaluate_skeleton_animation()`:
```gdscript
var bone_globals: Array[Transform3D] = []
bone_globals.resize(skeleton.get_bone_count())
for bi in range(skeleton.get_bone_count()):
    var rest_xf: Transform3D = skeleton.get_bone_rest(bi)
    var pose_rot: Quaternion = skeleton.get_bone_pose_rotation(bi)
    var pose_pos: Vector3 = skeleton.get_bone_pose_position(bi)
    var local_xf: Transform3D = rest_xf * Transform3D(Basis(pose_rot), pose_pos)
    var parent_bi: int = skeleton.get_bone_parent(bi)
    if parent_bi >= 0:
        bone_globals[bi] = bone_globals[parent_bi] * local_xf
    else:
        bone_globals[bi] = local_xf
    skeleton.set_bone_global_pose_override(bi, bone_globals[bi], 1.0, true)
```

**Result:** Meshes now track the skeleton correctly! Rotation AND position work. The mesh deforms with animation.

### Skin rebinding approach (working)

The final working skin code is simple — duplicate the original GLB skin and remap bone indices:
```gdscript
var new_skin: Skin = orig_skin.duplicate()
for i in range(new_skin.get_bind_count()):
    var glb_bi: int = new_skin.get_bind_bone(i)
    var bone_name: String = glb_skeleton.get_bone_name(glb_bi)
    var shared_bi: int = shared_skel.find_bone(bone_name)
    new_skin.set_bind_bone(i, shared_bi)
mesh_instance.skin = new_skin
```

Key insight: GLB skins have `bind_bone` indices but NO `bind_name` (`orig_has_names=false`). Godot resolves by index when names aren't set. So we just remap the indices from GLB skeleton order to shared skeleton order. Bind poses (IBMs) stay unchanged since both skeletons have identical rest transforms.

### Remaining issues

- **Droopy face on Solarian feline** — Some collision volume bones (face, tail) don't line up. These were fixed previously but the fix may have been lost during the shared skeleton refactor. Likely related to CV rest transforms (rotation + scale) interacting with the global pose override.
- **Tail bend** — Same category as droopy face. CV bone rest basis with non-uniform scale.
- **godot-version.txt** — Still set to `Godot_v4.7-dev2_mono_win64`. Should revert to 4.4-stable if VR is needed.

### Current state (end of Phase 10)

- `object_manager.gd`: Shared skeleton with `set_bone_global_pose_override` — meshes deform correctly
- `mesh-converter.ts`: XML-derived skeleton + IBMs (unchanged from Phase 9)
- Skin: `orig.duplicate()` + bone index remap (simple, working)
- `_apply_joint_overrides()`: Still commented out
- Debug markers: Still active (red=standard, green=CV)

---

## Phase 10 — Joint Position Overrides (2026-03-11)

### Goal: Custom-skeleton meshes (animal avatars) should deform correctly

Animal avatars (e.g. My Little Pony, Solarian feline) use `alt_inverse_bind_matrix` in their mesh data to specify custom joint positions. Without applying these, all meshes render at human skeleton proportions.

### Key discovery: alt_inverse_bind_matrix format

Despite the name, `alt_inverse_bind_matrix` does NOT contain inverse bind matrices. Each entry is a **local joint transform** in SL row-major format. The translation at raw indices `[12,13,14]` is the custom LOCAL joint position in SL space `(x,y,z)`.

**Evidence:** Compared raw alt IBM data with XML skeleton positions:
- mTorso: XML local z=0.084, alt IBM raw[14]=0.084 (exact match)
- mPelvis: XML local z=1.067, alt IBM raw[14]=1.062 (close, with custom offset)
- mChest: XML local z=0.205, alt IBM raw[14]=0.241 (custom offset)

The `transformInverseBindMatrix()` function in node-metaverse was NEVER called and its math was never validated — do not use it.

### Key discovery: mesh vertices are in CUSTOM skeleton space

Mesh vertices are **already** at custom proportions, NOT at default/human proportions.

**Evidence (MLP pony leg mesh `7ec3c7e4`):**
- Vertex Y range: 0.379 to 0.509 (0.13 units tall)
- Custom pony skeleton: mKneeLeft at y≈0.459, mAnkleLeft at y≈0.398
- Default human skeleton: mKneeLeft at y≈0.535, mAnkleLeft at y≈0.067
- Vertex positions cluster around pony bone positions, NOT human positions

**Implication:** GLB must use consistent custom skeleton + custom IBMs (identity rest pose). Any attempt to use default IBMs to "reshape" the mesh from human→pony will produce severe distortion because the vertices don't need reshaping.

**Failed approach (do not retry):** Computing IBMs from default/XML joint world transforms while keeping skeleton at custom positions. This produced a spike/stretched mesh because `JW_custom * inverse(JW_default) * v_already_custom` double-transforms the vertices.

### Validation test

Added `scripts/test-glb-ibm.ts` — verifies `W * IBM ≈ identity` for all joints in a GLB. Run:
```bash
npx tsx scripts/test-glb-ibm.ts  # tests known pony meshes from cache
npx tsx scripts/test-glb-ibm.ts path/to/mesh.glb  # test any GLB
```

### Implementation: mesh-converter.ts

1. Parse alt IBM local positions: `raw[12], raw[13], raw[14]` → SL local `(x,y,z)`
2. Recompute joint world transforms using custom local positions (SL→Godot: `(x,z,-y)`)
3. For joints WITHOUT alt data, recompute using XML local position + (possibly overridden) parent world transform (fixes stale child bug)
4. Skeleton nodes and IBMs both use the custom joint world transforms (consistent)
5. `overriddenJointNames[]` tracks which joints have alt data, written to `.meta` file as `jointOverrides`

### Implementation: per-joint override filtering (Godot side)

1. `mesh_ready` bridge message includes `jointOverrides` array (from `.meta` file)
2. `asset_pipeline.gd` stores in `sm.mesh_joint_overrides[mesh_id]`
3. `_apply_joint_overrides(glb_skel, shared_skel, override_joints)` only modifies listed bones
4. Meshes WITHOUT alt IBMs skip the override step entirely — prevents resetting the shared skeleton back to default proportions

### Remaining issue: Godot viewer still shows human proportions

The GLBs are correct (verified in Blender — mesh at pony proportions with identity rest pose). The per-joint override filtering works (confirmed via logs). But the viewer still renders animal avatars at human proportions. The shared skeleton overrides are applied, but something in the Godot rendering pipeline isn't reflecting them. Investigation ongoing.

---

## Phase 11 — Hippolyzer Reference Implementation (2026-03-11)

### Goal: Understand proven llmesh→glb conversion and create a validated reference

Investigated Hippolyzer's `gltftools.py` / `mesh.py` / `mesh_skeleton.py` to understand how a known-working converter handles the llmesh→glb pipeline. Created a TypeScript port as a test script to validate against Blender and SL upload.

### Hippolyzer approach (key differences from our mesh-converter.ts)

1. **Blender compatibility mode**: Joint nodes store ONLY translation. Scale and rotation from the XML skeleton are split into a `fixup_matrix` that gets baked into the inverse bind matrices. This works around Blender's inability to handle bone scale/rotation in glTF IBMs correctly (see Blender issues T38660, T50412, glTF-Blender-IO#1305).

2. **Fixup baked into IBMs**: `IBM_gltf = coordConvert(fixup @ IBM_sl)`. The fixup matrix is the scale+rotation portion of the joint's local TRS from avatar_skeleton.xml. This means IBMs encode both the original inverse bind AND the bone's non-translation rest transform.

3. **Alt inverse bind matrix handling**: Extracts ONLY the translation component from alt IBMs (via `translation_from_matrix`). If the translation differs from the XML position by > 0.1mm, it replaces the joint's local translation. Scale and rotation stay from XML. This matches `mesh_skeleton.py:merge_mesh_skeleton()`.

4. **Bind shape matrix baked into vertices**: glTF has no bind shape matrix concept (unlike COLLADA). BSM is applied to all vertex positions and normals before coordinate conversion. Normal transform uses proper inverse-transpose of BSM upper 3x3.

5. **Coordinate conversion**: Two methods depending on data type:
   - Vectors: Multiplied by a -90° X rotation matrix (POINT_TO_GLTF_MAT)
   - Matrices: Decompose → swap Y↔Z axes in each component → negate Z translation → recompose. Equivalent to similarity transform `C * M * C^(-1)`.

6. **UV convention**: `[u, -v]` (negate V), not `[u, 1-v]` (complement V).

7. **Mesh node matrix cleared**: When skinned, `mesh_node.matrix = None` (identity). BSM is already in the vertices.

### Test script: `electron-ui/scripts/hippolize-llmesh.ts`

TypeScript port of Hippolyzer's conversion logic. Validated output in Blender — mesh displays correctly at proper proportions.

```bash
cd electron-ui && npx tsx scripts/hippolize-llmesh.ts [input.llmesh] [output.glb]
# Default: test-output/mlp_pony_leg.llmesh → test-output/mlp_pony_leg_hippolized.glb
```

Test result (MLP pony leg, 77 joints, 6 primitives):
- Blender import: correct mesh shape and proportions ✓
- All 77 skinned joints with proper hierarchy ✓
- Alt IBM overrides applied (77 joints with custom positions) ✓
- Non-identity BSM correctly baked into vertices ✓

### Implications for mesh-converter.ts

Our current mesh-converter.ts differs in several ways that may explain remaining rendering issues:

| Aspect | Hippolyzer (working) | Our mesh-converter.ts |
|--------|----------------------|----------------------|
| Joint node transform | Translation only | Full TRS from XML |
| IBM content | fixup @ raw_IBM | inverse(XML world transform) |
| Alt IBM handling | Translation override on XML joint | Raw indices [12,13,14] as local pos |
| BSM normal transform | Inverse-transpose of 3x3 | Upper 3x3 multiply + normalize |
| UV flip | -v | 1-v |
| `_apply_joint_overrides()` | N/A (in GLB) | Commented out |

The Hippolyzer approach produces GLBs that work in Blender and should upload to SL via Firestorm's glb importer. The test script serves as a reference for updating mesh-converter.ts.

---

## Phase 12 — CV Bone BSM Contamination Fix (2026-03-12)

### Problem: meshes with non-identity bind shape matrix render 100x too large

Maitreya Fitmesh body (and other meshes with non-identity BSM) rendered as a giant distorted shape in Blender. The mesh was ~100x too large and visually broken. Identity-BSM meshes were unaffected.

### Root cause: CV bone IBM-derived transforms in BSM space

`mesh-converter.ts` has a special path for collision volume bones: instead of using XML skeleton data, it derives the local transform from `inverse(rawIBM)` to capture the content creator's actual bind pose. The local transform is computed as:

```
worldXf = mat4Inverse(rawIBM)           // → BSM × jointWorld (for non-identity BSM)
parentWorld = getWorldPos(parentName)    // → XML world position (no BSM)
jMat = mat4FromTranslation(-parentWorld) * worldXf
```

For identity-BSM meshes, `inverse(rawIBM) = jointWorld` and this works fine.

For non-identity BSM meshes (like Maitreya with BSM scales of 32x/155x/96x), `inverse(rawIBM) = BSM × jointWorld`, producing world transforms ~100x the correct size. But `getWorldPos` returns the XML world position at normal SL scale. The two are in different coordinate systems, so the subtraction doesn't cancel — the result retains the BSM scale.

This produced:
- **Node translations**: world-space positions 100x too large (e.g., PELVIS: `[-1.0, -1.067, -104.7]` instead of `[-0.01, -0.02, 0.0]`)
- **IBMs**: identity scale with 100x translations (missing the fixup that should bake scale+rotation in)
- **In Blender**: 21 CV bone joints at wrong positions → mesh skinned incorrectly → giant distorted rendering

### Fix

Added `&& bsmIsIdentity` guard to the CV bone IBM-derived transform path:

```typescript
// Before:
if (skelJoint.isCollisionVolume && !jointOverrides.has(name) && rawIBMByName.has(name)) {

// After:
if (skelJoint.isCollisionVolume && !jointOverrides.has(name) && rawIBMByName.has(name) && bsmIsIdentity) {
```

When BSM is non-identity, CV bones now use XML-derived transforms + fixup (same as the Hippolyzer reference), avoiding the BSM contamination entirely.

### Testing methodology

Downloaded Maitreya Fitmesh body (mesh UUID `bf815768-4b11-dd04-5725-3a2a6bc2e539`, object UUID `1d684b64-92a7-aeae-988e-c380e4569b27`) and generated GLBs with three approaches:

1. **hippolized** — `hippolize-llmesh.ts` (Hippolyzer reference, proven correct in Blender)
2. **alpha** — committed mesh-converter.ts before fix (giant mesh in Blender)
3. **fixed** — mesh-converter.ts with `&& bsmIsIdentity` guard

Used `test-output/compare-glbs.ts` to structurally diff all three:
- **hippolized vs fixed**: `MATCH` — all structures, transforms, and IBMs match
- **hippolized vs alpha**: 42 diffs — 21 CV bone node transforms wrong (100x+), 21 CV bone IBMs wrong (scale 1.0 instead of 0.01)

Blender visual check: hippolized and fixed both render correctly at human proportions. Alpha renders as a giant distorted mesh.

### Test artifacts

- `test-output/maitreya-fitmesh.llmesh` — raw mesh from asset server
- `test-output/maitreya-fitmesh.hippolized.glb` — Hippolyzer reference
- `test-output/maitreya-fitmesh.alpha.glb` — pre-fix output (broken)

### Tools added

- `test-output/compare-glbs.ts` — Structural GLB comparison tool. Compares vertex bounds, skeleton node transforms, IBMs, joint indices. Exit code 0 = match, 1 = diffs. Use to validate mesh-converter output against Hippolyzer reference:
  ```bash
  cd electron-ui && npx tsx test-output/compare-glbs.ts reference.glb candidate.glb
  ```

### Failed approach: skip BSM baking for rigged meshes (do not retry)

An attempt was made to avoid baking BSM into vertex positions for rigged meshes, instead compensating by multiplying `IBM × BSM`. While mathematically valid in theory (`JM × IBM × BSM × v = JM × (IBM×BSM) × v`), the implementation had cascading issues:
- Orphan joint transforms computed as `inverse(IBM × BSM)` = `BSM⁻¹ × jointWorld` (wrong)
- Vertex positions stayed at tiny raw SL normalized coords ([-0.5, 0.5] instead of [-15, 16])
- The Hippolyzer reference (proven working) always bakes BSM into vertices — follow that approach

### Remaining issue: Godot rendering

The GLB is now correct (verified in Blender). Godot viewer still shows incorrect rendering for Maitreya. The issue is on the Godot side — likely in how `set_bone_global_pose_override` interacts with the BSM-scaled vertex positions, or how the shared skeleton rest transforms are applied during skin deformation.

---

## Phase 11 — Joint Override & Animation Priority Fixes (2026-03-13)

**Goal:** Fix hand bone positioning and per-channel animation priority.

### Fix 1: Joint override reference frame mismatch

**Problem:** `_apply_joint_overrides()` computed a world→local conversion that mixed two reference frames: the GLB skeleton's parent chain (XML defaults) vs the shared skeleton's parent chain (potentially modified by a different mesh). When a body mesh overrode ancestor bones (e.g. mChest), hand/finger bone overrides from a separate hand mesh would end up at wrong positions.

**Fix:** Copy the GLB skeleton's local rest transform directly to the shared skeleton instead of going through world→local conversion. The mesh-converter already sets each override bone's local rest from the `alt_inverse_bind_matrix`, so the GLB rest is authoritative. This matches SL's behavior where each mesh sets the bone's local position directly.

**Files:** `object_manager.gd` — `_apply_joint_overrides()`

### Fix 2: Per-channel animation priority

**Problem:** Animation priority was tracked per-joint, not per-channel. An animation that claimed a joint with position keys but no rotation keys (e.g. an ankle position override at pri=6) would block lower-priority animations from rotating that joint. This prevented toe-bending animations from working on avatars with ankle position animations.

**Fix:** Split priority arbitration into separate rotation and position channels. An animation only claims the rotation channel if it has rotation keyframes, and only claims the position channel if it has position keyframes. The merged result can now have rotation from one animation and position from another for the same joint.

**Files:** `object_manager.gd` — `_apply_pending_animations()`

**Outcome:** Hand bones position correctly on avatars wearing multiple rigged meshes. Toe/ankle animations play correctly even when a higher-priority animation repositions (but doesn't rotate) the ankle.

---

## Known Remaining Issues (as of 2026-03-13)

- **Prim attachments diverge during walk**: Anchor strategy is running but results are inconsistent. Rigged mesh positions and prim attachment positions can diverge, especially during locomotion animations that move mPelvis.
- **Half t-pose on some meshes**: Lel heads, some tail joints not fully resolved by hybrid skeleton. Degenerate-basis fix may improve this (affected bones now hold rest pose instead of garbage).
- **Degenerate CV bone poses**: Bones falling back to IDENTITY are held in their XML rest pose rather than animated. Correct fix would be ensuring `mesh-converter.ts` never produces zero-column local matrices (null check on `mat4Inverse` return).
- **Self-avatar animation batch not in Electron logs**: Self-avatar (own UUID) never appears in `[Animesh] Batch ready for localId=...`. May be going through a different code path or suppressed.
- **519 missing children on rescan**: `[GodotBridge] Rescan found 519 missing children` on startup — many attachment children not routed on initial load.
- **Debug logging still in place**: `[AttachDebug]`, `[AttachBone]`, `[AvatarHeight]`, `[AvatarDebug]`, `[Animesh-Skin]`, `[SelfAvatar]`, `[BoM]` prints still in place — remove when bugs resolved.
- **Phase 3 (shape sliders)**: Not started. Would parse `param_skeleton` from `avatar_lad.xml`.
