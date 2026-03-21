# Projection Lights in Godot 4 — Pain Log

## The Core Problem

Godot 4 **requires shadows to be enabled** for `light_set_projector()` to work on spot lights. Without `light_set_shadow(true)`, the projector texture is silently ignored. SL projection lights don't cast real shadows — they only project a texture. So we're forced to enable a shadow system we don't want just to get texture projection.

## Problem 1: Light Bleeding Through Walls

**Symptom:** Projection texture passes through walls as if they don't exist.

**Cause:** Original workaround set `SHADOW_OPACITY = 0.01` to hide shadow acne artifacts. This made shadows invisible, which also made wall occlusion invisible.

**Fix:** Set `SHADOW_OPACITY = 1.0` so walls actually block the projection.

## Problem 2: Circle Shadow in Center of Projection

**Symptom:** Dark circle appears in the center of the projected texture on the target surface. Gets BIGGER when shadow bias is reduced, smaller (but still present) when bias is increased.

**Root cause:** The **target surface self-shadows**. The spot light renders the target prim into its shadow map. When shading that same surface, the fragment depths match the shadow map depths exactly (same geometry!). The shadow test `fragment_depth > shadow_depth` is a coin flip — shadow acne. At the center of the cone where light hits perpendicular, the effect is worst, creating a circular pattern.

### Failed approaches

- **`SHADOW_OPACITY = 0.01`** — Hides self-shadowing but also hides wall occlusion (Problem 1).
- **High `SHADOW_BIAS` (0.1-0.2)** — Reduces the circle but doesn't eliminate it. Too-high values cause peter-panning (shadows detach from casters).
- **High `SHADOW_NORMAL_BIAS` (2.0)** — At the cone center where light is perpendicular to the surface, normal bias shifts the shadow lookup along the surface normal toward the light. If the bias exceeds the light-to-surface distance (e.g., 2.0m bias vs 1.43m distance), the lookup goes **behind the light**, outside the shadow frustum, and reads as shadowed. Creates a smaller but very visible circle.
- **Very low bias (0.02 / 0.1)** — Makes the shadow HUGE because there's almost no offset to prevent self-shadowing. The entire surface fails the depth test.
- **`SHADOW_CASTING_SETTING_OFF` on emitter prim** — Necessary but insufficient. Prevents the projector prim from casting into its own projection, but doesn't help with the target surface self-shadowing.
- **Disabling shadow casting on linkset siblings** — Wrong diagnosis. Tested with MCP tools: the projector and target were standalone prims, not linked.
- **`RenderingServer.light_set_reverse_cull_face()` via RS** — The method exists in C++ (PR #77238, merged Godot 4.1) but is **NOT exposed to GDScript** in Godot 4.4. Parse error at compile time. Also not callable via `Object.call()` — not in ClassDB bindings. Not in the RenderingServer XML docs. Internal C++ only.
- **`RenderingServer.call(&"light_set_reverse_cull_face", rid, true)`** — Confirmed NOT bound: "Invalid call. Nonexistent function 'light_set_reverse_cull_face (via call)' in base 'RenderingServer'."

### Working fix: SpotLight3D Nodes

`shadow_reverse_cull_face` IS available on the **SpotLight3D node** (it calls the internal RS method from C++). The fix is to use SpotLight3D nodes for spot lights instead of raw RenderingServer RIDs.

```gdscript
var spot = SpotLight3D.new()
spot.shadow_enabled = true
spot.shadow_reverse_cull_face = true   # Back faces in shadow map
spot.shadow_opacity = 1.0              # Walls block projection
spot.shadow_bias = 0.03
spot.shadow_normal_bias = 1.0
spot.light_projector = padded_texture
```

This renders **back faces** into the shadow map instead of front faces. For closed meshes (boxes, spheres, cylinders — all SL prims):

- Front-facing surfaces are always closer to the light than their own back faces, so they **never self-shadow**.
- Walls still block the projection because the wall's back face IS in the shadow map. Fragments behind the wall have depth > back-face depth = correctly shadowed.

## Architecture (scene_manager.gd)

The `RSLight` wrapper class now has two modes:

- **Spot lights** → `SpotLight3D` node (added as child of SceneManager). Gives access to `shadow_reverse_cull_face`. All properties set via node API.
- **Omni lights** → Raw `RenderingServer` RIDs (no node needed, no projection/shadow concerns).

```
RSLight
├── node: SpotLight3D   (spot only — has shadow_reverse_cull_face)
├── light_rid: RID      (omni only)
└── instance_rid: RID   (omni only)
```

`_apply_light_params()` branches on `rsl.node != null` to use node properties vs RS calls.

Plus:
- `SHADOW_CASTING_SETTING_OFF` on the emitter prim (so it doesn't shadow its own projection)
- `spot_angle_attenuation = 0.01` for near-uniform brightness across the cone (SL projectors have no angular falloff)
- Projector texture padded to sqrt(2)x with black border (square inscribed in Godot's circular cone)
- `light_cull_mask = 1` (layer 1 only, excludes water on layer 2)

## Other Light Facts

- SL projects along local **-Z**. Godot spot shines along **-Z**. Basis rotated -90 deg around X to map correctly.
- `spotFov` from SL is the **full FOV** in radians. Godot's `spot_angle` is a **half-angle in degrees**. Cone widened to diagonal: `atan(sqrt(2) * tan(half_fov))`.
- Max 64 active lights, distance-culled at 64m, sweep every 2s.
- Light data cached in `_object_light_data` for recreation after distance cull.
- `_get_projector_texture()` returns `ImageTexture` (not RID) — used directly as `node.light_projector`.

## Debugging

Test objects in Lon Lon Ranch (bonniebelle81):
- Projector: UUID `b689bb63-a6e8-bd0c-bca6-2c8c7363eaa3` (localId 651851795) — standalone prim, spot light, 90 deg FOV, radius 10m, projects texture `5e64917a-6288-6633-300f-d2ff396318e6`
- Target: UUID `20e8bb65-d568-3f91-a1f5-c3a595277ecc` (localId 652194695) — standalone prim, 1.43m from projector
