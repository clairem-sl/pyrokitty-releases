# GPU ID-Buffer Object Picking

Pixel-perfect object identification for all mesh types — static, skinned, animated — using a GPU-rendered ID color buffer. Replaces physics-only picking which couldn't hit deformed skinned meshes.

## Problem

Physics-based picking uses bind-pose trimesh shapes. Skinned meshes (avatars, animesh) deform on the GPU via skeleton — the physics shape doesn't follow. Clicks on animated meshes miss entirely.

## Architecture

### SubViewport + Pick Camera

A dedicated SubViewport renders the scene at 1/4 resolution with flat ID-color materials. The pick camera mirrors the main camera (desktop) or the VR controller ray (xr_rig).

- **SubViewport**: shared `world_3d`, 1/4 resolution, `UPDATE_ALWAYS`, all AA disabled
- **Camera3D**: `cull_mask = 1 << 20` (render layer 21, outside default cull_mask `0xFFFFF`)
- **Environment**: `BG_COLOR` black, `TONE_MAPPER_LINEAR`, ambient disabled — background = ID 0 = no hit

### Dual-Instance Rendering

Every object gets a pick instance invisible to the main camera:

- **Static objects**: lightweight RS instance duplicate. Same mesh RID (shared, no extra VRAM). Layer mask `1 << 20`. Transform synced via `on_transform_pushed` callback.
- **Skinned objects**: MeshInstance3D under the same Skeleton3D with same mesh + skin. GPU skins both visible and pick instances identically. No CPU skinning needed. No physics body (bind-pose shape is useless for deformed meshes).

### Shader

Simple flat unshaded shader, 24-bit object ID as RGB:

```glsl
shader_type spatial;
render_mode unshaded, cull_back, depth_draw_opaque, fog_disabled;
uniform vec3 id_color;
void fragment() { ALBEDO = id_color; }
```

- **R, G, B**: 24-bit object ID (16.7M max). Encoded as `(id >> 16) & 0xFF`, `(id >> 8) & 0xFF`, `id & 0xFF`.
- 24-bit capacity supports 60K+ pick instances across multiple sims.

## Pick Flow

### Identification (pixel-perfect)

1. Read the pick viewport texture at the target pixel
2. Decode 24-bit ID from RGB channels
3. Look up UUID from `_id_to_uuid` dictionary

### Distance

Distance is determined separately from identification:

1. **Static objects**: physics raycast gives exact surface distance. `pick_object` uses physics distance when the physics UUID matches the ID buffer UUID.
2. **Skinned objects**: physics body doesn't exist. `_estimate_distance()` finds the nearest skeleton bone to the ray using `_nearest_bone_distance()`. Projects each bone's world position onto the ray, returns the distance to the closest one. 159 bones = trivial cost.
3. **Fallback**: `rsi.pos` (object anchor position) for objects without a skeleton.

### Detailed Pick (face/UV/normal)

1. ID buffer identifies the object
2. Physics raycast provides face index, UV, normal for the identified object
3. If physics hits the same UUID → return physics detail
4. Otherwise → return ID buffer result with default face/UV/normal

### Desktop vs VR

- **Desktop**: pick camera mirrors main camera each frame. On click, project ray into pick camera screen space, read that pixel.
- **VR**: xr_rig aims pick camera along controller ray each frame via `update_pick_camera_ray()`. On pick, read center pixel.

## Hover Highlight

A material overlay is applied to the hovered object for visual feedback:

- Static objects: `RenderingServer.instance_geometry_set_material_overlay()`
- Skinned objects: `MeshInstance3D.material_overlay`
- Semi-transparent blue, unshaded
- Updates at pick rate (~20Hz from VR laser)
- No laser dot — the highlight IS the visual feedback

## Performance

- **GPU**: 1/4 resolution, flat unshaded shader, no lighting = ~0.5-1ms per frame
- **CPU**: `get_texture().get_image()` readback every 50ms (VR pick interval)
- **Memory**: extra RS instances (lightweight RIDs, mesh data shared) + flat-color ShaderMaterials

## Known Issues

### SubViewport Camera View Matrix Bug (Godot 4.7-dev2)

A Camera3D under a SubViewport does not propagate its translation to the shader's `VIEW_MATRIX` / `INV_VIEW_MATRIX`. The camera rotation is correct (objects appear at correct screen positions) but the translation is wrong. This prevents shader-based depth computation — attempted workaround with a global shader uniform (`pick_cam_pos`) produced correct depth in VR but we chose the skeleton bone approach instead for simplicity and full 24-bit ID space.

Verified by setting the camera transform via GDScript, then reading `INV_VIEW_MATRIX[3]` in the shader — values don't match. Tried `Camera3D.global_transform`, `RenderingServer.camera_set_transform`, RS-only camera via `viewport_attach_camera`, physics interpolation mode OFF — none fixed it. Traced through Godot source (`camera_3d.cpp` → `renderer_scene_cull.cpp` → `render_scene_data_rd.cpp`).

## Files

- `godot-viewer/src/object_picker.gd` — all pick logic, ID buffer, hover highlight, debug overlay, skeleton distance
- `godot-viewer/src/object_manager.gd` — `create_pick_resources()` / `create_pick_instance_skinned()` call sites
- `godot-viewer/src/scene_manager.gd` — `update_pick_camera()` in `_process()`, pick API delegation
- `godot-viewer/src/xr_rig.gd` — VR laser, `update_pick_camera_ray()`, trigger handling
- `godot-viewer/src/main.gd` — F10 keybind for debug overlay toggle
- `godot-viewer/tests/test_object_picker.gd` — unit tests for ID allocation, encoding round-trip, lifecycle
