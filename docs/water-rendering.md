# Water Rendering in Godot Viewer

## Current Setup: OceanFFT + SSR Hybrid
- **Wave simulation**: tessarakkt.oceanfft addon — FFT-based displacement, QuadTree3D LOD
- **Reflections**: Custom SSR ray-march spliced into `SurfaceVisual.gdshader`
- **Refraction**: Screen-texture UV offset by world-space wave normals
- **Old approach**: `water_ssr.gdshader` (noise waves + SSR) is kept on disk as reference but no longer loaded
- **Render layer**: Water on layer 2 (set recursively on QuadTree3D children), lights on layer 1 only — prevents blocky shadow artifacts
- **Underwater fog**: GPU shader (`underwater_fog.gdshader`) — fullscreen quad samples the live FFT displacement textures at the camera's XZ position, applies depth-based exponential fog when camera is below the local wave surface. No CPU readback needed — fog color/density driven by EEP uniforms.

## OceanFFT Configuration (scene_manager.gd)
```
fft_resolution: 128, horizontal_dimension: 256
wind_speed: 12.0, wind_direction_degrees: 45.0
choppiness: 0.6, time_scale: 1.0, simulation_frameskip: 1
heightmap_sync_frameskip: -1  (disabled — no GPU→CPU readback)
QuadTree: lod_level=5, quad_size=4096, mesh_vertex_resolution=64, morph_range=0.3
LOD ranges: [48, 96, 192, 384, 768, 1536]
```
- `simulation_enabled = true` — Ocean3D.simulate() gates on this flag internally
- Must call `initialize_simulation()` — sets up compute shaders on RenderingDevice
- Must guard `simulate()` and `get_wave_height()` on `_ocean.initialized` — the init defers to the render thread, so `initialized` is false for a frame or two

## SSR (Screen-Space Reflections)
- Custom ray-march in fragment shader — Godot's built-in SSR doesn't work on transparent surfaces
- ReflectionProbes also don't work with this custom shader
- **Coarse march + binary refinement**: 0.25m steps up to 20m travel, then 10 binary iterations (~0.00024m precision)
- **Dithered ray start**: `fract(sin(dot(FRAGCOORD.xy, ...)))` jitters the initial ray position per-pixel, converting staircase aliasing into imperceptible noise
- `ssr_max_diff = 0.5` — tighter depth comparison reduces false-positive bands at depth discontinuities (was 1.5, caused sawtooth artifacts)
- `ssr_mix_strength = 0.7` — flat blend, no fresnel modulation (SSR represents object reflections, not sky)
- **Distance fade**: `smoothstep(max_travel * 0.5, max_travel, hit_distance)` fades distant hits to avoid jarring pop-in at SSR range limit
- Screen border fadeout prevents hard cutoff at screen edges
- `textureLod(..., 0.0)` in ray-march loop — avoids undefined mipmap gradients with `filter_linear_mipmap`
- **Alpha boost**: `ALPHA = max(shore_alpha, ssr_blend)` ensures reflections are visible even on transparent shoreline water
- `FRAGCOORD` is only available in `fragment()`, not in helper functions — pass as parameter to `get_ssr_color()`

## Refraction
- `refracted_uv = SCREEN_UV - world_normal.xz * refraction_factor`
- **Must use world-space normals** via a `varying vec3 world_normal` set in `vertex()`. Godot auto-transforms `NORMAL` to view space for `fragment()`, and view-space `NORMAL.xz` depends on camera angle, not wave shape.
- `refraction_factor = clamp(water_column_depth * depth_factor, min, max) * shore_atten`
- `refraction_depth_factor = 0.03`, `refraction_factor_max = 0.15`
- **Water must be opaque past shoreline** for refraction to work. If `ALPHA < 1`, the compositor blends the refracted ALBEDO with the raw un-refracted background, canceling out the refraction effect. Shore fade (transparent → opaque over `shore_fade_depth`) is the only alpha reduction.

## Depth Reconstruction Bug (Fixed)
The original OceanFFT shader had:
```glsl
vec4 view = INV_PROJECTION_MATRIX * vec4(vec3(SCREEN_UV, depth), 1.0);  // WRONG
```
`SCREEN_UV` is [0,1] but `INV_PROJECTION_MATRIX` expects NDC [-1,1]. Fixed by reusing the SSR helper:
```glsl
vec3 depth_view = get_view_position_from_uv(SCREEN_UV, depth, INV_PROJECTION_MATRIX);
// which does: vec4((uv * 2.0) - 1.0, depth, 1.0)
```
This was the root cause of `water_column_depth` being garbage, breaking both refraction and depth-based color.

## Color Pipeline (Rewritten)
Old pipeline destroyed refracted colors through 3 layers:
1. `background * shallow_color(R=0) * 0.2` — killed red channel
2. `* fresnel_sky_color` — unpredictable rescale
3. `HDR(..., 0.01)` — crushed to 1% brightness

New pipeline:
1. `background_color` from refracted screen_texture — full fidelity
2. `mix(background, deep_color, depth²)` — tints toward deep blue with water depth
3. `mix(underwater_view, fresnel_sky, fresnel)` — fresnel blends between refraction (looking down) and sky (glancing angles)

## Pitfalls & Lessons Learned

### SSR Artifacts
- **Sawtooth/staircase on reflection edges**: Coarse ray-march step creates discrete hit/miss boundaries. Fix: dither ray start position per-pixel (converts staircase to noise).
- **Hall of mirrors / zigzag banding**: Too-large step size (was 1.0m). Fix: 0.25m + binary refinement.
- **Jarring pop-in**: SSR reflections appear/disappear abruptly at range limit. Fix: distance fade via smoothstep.
- **Weak/invisible reflections**: (1) `fresnel_power = 5` made SSR ~0.2% at 45° viewing angle. Fix: flat blend with no fresnel modulation. (2) Low ALPHA meant compositor blended away the SSR color. Fix: `ALPHA = max(shore_alpha, ssr_blend)`.

### Refraction Invisible — Three Independent Causes
1. **Wrong normal space**: `NORMAL.xz` in fragment() is view-space (Godot transforms after vertex()). Fix: `varying vec3 world_normal` captured in vertex().
2. **Broken depth reconstruction**: Missing `* 2.0 - 1.0` NDC conversion made `water_column_depth` garbage. Fix: reuse `get_view_position_from_uv()`.
3. **Alpha cancellation**: With `ALPHA < 1`, refracted ALBEDO blends with raw un-refracted background — they cancel. Fix: water opaque past shoreline.

### Mesh & Rendering
- **PlaneMesh + cull_disabled = Z-fighting**: Front/back at identical depth. Use BoxMesh for two-sided water.
- QuadTree3D creates its own MeshInstance3D children — set layer 2 recursively with `_set_layer_recursive()`.
- `FRAGCOORD` not available in helper functions — only in `fragment()`. Pass via parameter.
- `gl_FragCoord` doesn't exist in Godot shaders — use `FRAGCOORD`.

### Ocean3D Gotchas
- `Ocean3D.simulate()` gates on `simulation_enabled` — must be `true` or simulation won't run
- `initialize_simulation()` defers to render thread — `initialized` is false for 1-2 frames
- Headless mode (`--headless`): `RenderingDevice` is null, `initialize_simulation()` fails. Tests must skip GPU-dependent tests.
- `.tres` material is preloaded and shared — `set_shader_parameter()` works but verify values aren't overridden by `.tres` defaults. Set values in both `.tres` and runtime code for safety.

## Key Files
- `godot-viewer/addons/tessarakkt.oceanfft/shaders/SurfaceVisual.gdshader` — main water shader (FFT waves + SSR + refraction)
- `godot-viewer/addons/tessarakkt.oceanfft/Ocean.tres` — material resource with shader parameter defaults
- `godot-viewer/src/terrain_environment.gd` — `_build_water_plane()`, Ocean3D/QuadTree3D setup, fog quad creation
- `godot-viewer/src/underwater_fog.gdshader` — GPU underwater fog (samples FFT displacement textures)
- `godot-viewer/tests/test_water_setup.gd` — headless tests for shader compilation, initialization guards, material params
- `electron-ui/src/main/godot-bridge.ts` — kills Godot process on `SHADER ERROR` in stdout
