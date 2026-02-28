# Prim Mesh UV Generation — Learnings & Remaining Work

## Key Files
- **Mesh UVs**: `godot-viewer/src/prim_mesh_generator.gd` — baked into ArrayMesh vertices
- **Planar UV shader**: `godot-viewer/src/planar_map.gdshader` — computes UVs from vertex position, ignores mesh UVs
- **Standard UV shader**: `godot-viewer/src/standard_uv.gdshader` — uses mesh UVs with SL xform()

## SL Reference Code
- Side UV: `LLVolumeFace::createSide()` in `indra/llmath/llvolume.cpp` (~line 6841)
- Cap UV: `LLVolumeFace::createUnCutCubeCap()` in `indra/llmath/llvolume.cpp` (~line 6009)
- Planar projection: `planarProjection()` in `indra/newview/llface.cpp` (lines 96-129)

## Box Face Ordering (matches SL TE)
Surface 0: PATH_BEGIN cap → **top** (TE face 0 = +Z) — face_id=0, renders last path step
Surface 1: OUTER_SIDE_0 — face_id=5
Surface 2: OUTER_SIDE_1 — face_id=6
Surface 3: OUTER_SIDE_2 — face_id=7
Surface 4: OUTER_SIDE_3 — face_id=8
Surface 5: PATH_END cap → **bottom** (TE face 5 = -Z) — face_id=1, renders first path step

**Key insight**: SL's TextureEntry face 0 = top of a box, face 5 = bottom. The scene_manager maps TE face index → ArrayMesh surface index directly (no remapping). Since PATH_BEGIN cap is first in the face list (surface 0), it must render the top geometry (last path step, z=+0.5). This is why `is_top = (face_id == 0)` with `path_idx = path_len-1`.

Order determined by: `addCap(PATH_BEGIN)` first, then 4x `addFace(OUTER_SIDE_N)`, then `addCap(PATH_END)`. All use `vector_append` (push to back).

## FIXED: Side Face S Coordinate (faces 2-4 were wrong)
**Problem**: Raw profile.z values for flat faces were [0,1], [1,2], [2,3], [3,4]. With non-unit repeat/offset/rotation, the xform centers around 0.5, producing wrong results for faces with S > 1.

**SL's approach** (llvolume.cpp:6841,6881):
```cpp
F32 begin_stex = floorf(profile[mBeginS][2]);
ss = profile[index][2] - begin_stex;  // flat faces only
```

**Fix applied**: Added `begin_stex` subtraction in `_build_side()` for `face.is_flat` faces. Each flat face now gets S in [0,1]. Non-flat faces (cylinder/sphere) are unaffected — they use raw profile.z per SL.

## FIXED: Cap UV convention mismatch (both caps were wrong)

**Problem**: Cap UVs were stored in SL convention, but the standard_uv shader expects Godot convention (V flipped from SL). The shader does `1.0 - UV.y` to convert Godot→SL before applying xform. Side UVs correctly use Godot convention (`V = 1.0 - tt`), but cap UVs were stored as raw SL values. This caused the shader to double-flip, producing wrong SL UVs for xform and wrong final display.

**SL cap UV formulas** (llvolume.cpp `createUnCutCubeCap`, lines 6040-6066):
- Base: `U = p.x + 0.5, V = 0.5 - p.y`
- Top cap: corners 0↔3 and 1↔2 swapped → effectively `V_top = p.y + 0.5`

**Godot convention** (mesh must store `1.0 - V_sl`):
- **Top cap**: `V_mesh = 1.0 - (p.y + 0.5) = 0.5 - p.y`
- **Bottom cap**: `V_mesh = 1.0 - (0.5 - p.y) = p.y + 0.5`

Note: the top and bottom formulas appear "swapped" from the SL originals because of the Godot V-flip convention. The `standard_uv.gdshader` recovers the correct SL UV via `1.0 - UV.y` before applying xform.

**Fix**: `_cap_uv_from_profile(p, is_top)` returns Godot-convention V per cap. Applied in `_cap_uv`, `_build_fan_cap`, and `_build_centroid_cap`.

**Note on winding**: Godot's `generate_normals()` uses `(v0-v2)×(v0-v1)` (Plane constructor convention), opposite to standard `(v1-v0)×(v2-v0)`. Reversed winding for top (center→v1→v0) → +Y normal; forward for bottom (center→v0→v1) → -Y normal. Both correct.

## FIXED: Planar UV — flipped on bottom cap face

**Symptom**: Bottom cap face of a planar-mapped box prim showed a mirror/flip compared to Firestorm. The shader math matched SL's `planarProjection()` (llface.cpp:96-129) exactly, but the output was in SL UV convention (V=0 at image bottom) while Godot textures use Vulkan convention (V=0 at image top).

**Root cause**: Missing SL→Godot UV convention conversion. The `standard_uv.gdshader` converts after xform via `1.0 - uv.y`, but `planar_map.gdshader` was outputting raw SL-convention UVs. On the bottom cap, the natural V-reversal from planar projection combined with the convention mismatch created a visible mirror. Other faces were also technically wrong but less noticeable with typical textures.

**Fix**: Added `planar_uv = vec2(uv.x, 1.0 - uv.y)` at the end of the vertex shader, matching the `standard_uv.gdshader` convention conversion.

## FIXED: Shader variant split — opaque vs alpha-blend

**Problem**: Both `planar_map.gdshader` and `standard_uv.gdshader` unconditionally wrote `ALPHA = tex_color.a * albedo_color.a`. In Godot 4, any shader that writes `ALPHA` anywhere forces the engine to route ALL faces through the transparent pipeline (alpha-sorted, no depth prepass), even fully opaque ones. This caused z-sorting artifacts and performance loss.

**Fix**: Split each shader into two variants:
- **Opaque** (`planar_map.gdshader`, `standard_uv.gdshader`): No `ALPHA` write, no `blend_mix`. Used for `resolved_mode` 0 (opaque) and 2 (mask). Mask mode uses `discard` with `alpha_scissor_threshold`.
- **Alpha-blend** (`planar_map_alpha.gdshader`, `standard_uv_alpha.gdshader`): `render_mode blend_mix`, writes `ALPHA`. Used for `resolved_mode` 1 (blend) and -1 with semi-transparent color.

**Double-sided**: `render_mode cull_back` vs `cull_disabled` is also compile-time. Instead of 4 extra shader files, `_get_double_sided_shader()` in scene_manager does string replacement (`cull_back` → `cull_disabled`) on the shader code and caches the result.

## Prim Mesh Cache
- In-memory only (`var _cache: Dictionary` in prim_mesh_generator.gd)
- Keyed by shape parameter hash string
- Cleared on Godot process restart — no disk persistence
- UVs are baked into ArrayMesh at generation time
