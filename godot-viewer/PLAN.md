# Godot Viewer Sidecar — Plan

## Concept

A Godot 4.4 application that acts as a **render sidecar** to the existing PyroKitty stack. node-metaverse handles all SL protocol work (login, UDP, caps, object tracking, asset fetch). Godot receives scene commands over WebSocket and renders the 3D world. The Electron UI continues to handle chat, inventory, friends, groups, and map.

```
┌──────────────────────────────┐
│  Electron (React/TypeScript) │
│  Chat, Inventory, Friends,   │
│  Groups, Map, Login UI       │
├──────────────────────────────┤
│  node-metaverse (TypeScript) │
│  SL protocol, UDP, caps,     │
│  object tracking, avatars,   │
│  asset fetch, texture decode, │
│  GPU BC1/BC3 compression     │
├──────────┬───────────────────┘
│    WebSocket IPC             │
├──────────┴───────────────────┐
│  Godot 4.4 sidecar           │
│  Scene tree (RS RIDs),       │
│  rendering, camera, VR,      │
│  input forwarding            │
└──────────────────────────────┘
```

## IPC Protocol (WebSocket + JSON)

Godot runs a WebSocket (TCP) server on a local port (default 9100). node-metaverse connects as a client.

### node-metaverse → Godot

| Message | Purpose |
|---------|---------|
| `self_id` | Identify the bot's own avatar UUID so camera can follow it |
| `object_create` | New object: localId, uuid, parentId, position, rotation, scale, meshId, shape, faces[], light |
| `object_update_batch` | Batched position/rotation/scale changes for static objects (coalesced every 50ms) |
| `object_update_physics` | Batched updates for moving objects: includes velocity, acceleration, angular velocity for interpolation |
| `object_update_faces` | Face/material update after initial create (PBR materials resolved asynchronously) |
| `object_kill` | Remove object from scene |
| `object_properties` | Object name + description (response to `request_object_properties`) |
| `mesh_ready` | Mesh converted to GLB and written to cache |
| `texture_ready` | Texture decoded to .bctex (or WebP fallback) and written to cache |
| `avatar_create` | New avatar: id, name, position, rotation |
| `avatar_update` | Single avatar position + rotation update |
| `avatar_update_batch` | Batched avatar position/rotation updates |
| `avatar_kill` | Remove avatar |
| `terrain_ready` | Heightmap binary cached to disk, path + waterHeight |
| `environment_data` | Sun direction, sunlight color, ambient color from EEP |
| `planar_debug` | Toggle planar UV debug visualization mode (F9) |

### Godot → node-metaverse

| Message | Purpose |
|---------|---------|
| `input_move` | WASD/E/C/QE state + camera yaw + fly toggle + running flag → control flags + body rotation |
| `quit` | Godot window closed, Electron should terminate the sidecar |
| `pipeline_stats` | Object/texture/mesh/material counts, FPS, finalize timing (every 5s) |
| `input_click` | Object click: localId, face, UV |
| `camera_position` | Current camera world position |
| `request_object_properties` | Request name + description for an object (by localId) |
| `set_object_name` | Set object name (from inspector panel) |
| `set_object_description` | Set object description (from inspector panel) |

## Rendering Architecture

All objects and avatars use lightweight `RSInstance` wrappers around RenderingServer RIDs — no MeshInstance3D nodes in the scene tree. This eliminates scene tree overhead (notification propagation, transform inheritance) and allows thousands of objects without GDScript bottlenecks.

- `RSInstance` holds: RID, position, rotation, scale, mesh reference
- Transform pushed via `RenderingServer.instance_set_transform()`
- Materials applied via `instance_geometry_set_material_override()` or `instance_set_surface_override_material()`
- Visibility range: objects fade from (far - margin) to far, then are culled
  - Desktop: 128m far, 32m fade margin
  - VR: 32m far, 8m fade margin

### Physics Object Interpolation

Objects with velocity/acceleration (`object_update_physics`) are extrapolated between server updates:

- Velocity + acceleration integrated at 45 Hz physics timestep
- Angular velocity applied via incremental quaternion rotation
- Blend correction: when a new server update arrives, the position snap is smoothed over 0.25s (or instant if >10m)
- Phase-out: extrapolation fades to zero over 2s if no new update arrives (max 3s)
- Sequence numbers (`_fseq`) prevent stale batched updates from overwriting fresh physics data

## Texture Pipeline

### Decode & Compress (Electron side)

node-metaverse fetches J2C textures from SL CDN. A worker thread pool (8 threads) decodes each texture. On Windows, uses native `opj_decompress.exe` (no WASM heap overhead). On other platforms, lazy-loads the fixed WASM decoder (`pyrokitty64/openjpeg` fork).

Decoded RGBA is then GPU-compressed via WebGPU compute shaders (BC1 for opaque, BC3 for alpha) in a hidden BrowserWindow. Mipmap chain is generated progressively (each level from previous via sharp lanczos3). Output is written as `.bctex` files:

```
asset-cache/textures/{uuid}.bctex
```

`.bctex` format: 32-byte header (magic `0x42435458`, version 1, width, height, format, mipCount, flags, dataSize) + concatenated mip data. Falls back to WebP if WebGPU is unavailable.

### Load & Apply (Godot side)

Godot receives a `texture_ready` message with the UUID and path. 16 dedicated OS threads (bypassing WorkerThreadPool's low-priority cap) load images from disk:

- `.bctex`: loaded directly via `_load_bctex()` — already has mipmaps and BC1/BC3 compression
- `.webp` fallback: loaded via `Image.load()`, then `generate_mipmaps()` + `compress(COMPRESS_S3TC)` on the worker thread

Results are pushed to main thread via mutex-guarded queue, finalized within an adaptive time budget (60% of remaining frame time). `ImageTexture.create_from_image()` runs on main thread, then materials are applied to all pending objects.

### Material system

Materials are cached by a composite key: `{textureId}_{colorHex}_{fullBright}_{doubleSided}_{uvParams}_{alphaMode}_{pbrParams}_{mappingType}`. UV params rounded to 2 decimal places to collapse near-duplicates from protocol noise.

**Shader variants** (custom ShaderMaterial, not StandardMaterial3D) for UV mapping:
- `standard_uv.gdshader` / `standard_uv_alpha.gdshader` — texture rotation support (StandardMaterial3D has no UV rotation property)
- `planar_map.gdshader` / `planar_map_alpha.gdshader` — SL's `planarProjection()` + `xform()` algorithm
- Double-sided variants generated at runtime by replacing `cull_back` → `cull_disabled` in shader source

**Placeholder materials** (solid color tint) shown while textures download, cached by `{colorHex}_{fullBright}_{doubleSided}`.

### Alpha handling

- **GLTF OPAQUE** (mode 0): no transparency
- **GLTF BLEND** (mode 1): smooth alpha blending
- **GLTF MASK** (mode 2): alpha scissor with explicit cutoff
- **SL standard** (mode -1): alpha scissor at 0.5 for textures, smooth blend for semi-transparent color
- Known-opaque textures (DXT1/BC1) promoted to mode 0, skipping the transparency pipeline entirely

## PBR Material Pipeline

Three-layer priority system for material resolution:

1. **renderMaterialData** (highest) — fetch full material asset from SL CDN
2. **gltfMaterialOverrides** — inline overrides from object's ExtraParams
3. **Legacy TextureEntry** (lowest) — diffuse texture + color tint

`MaterialFetchQueue` downloads `AssetType.Material=57`, parses via `LLGLTFMaterial` (LLSD binary → glTF JSON), extracts per-face PBR properties. Results sent to Godot via `object_update_faces` message.

**PBR properties applied in Godot:**
- Albedo texture + base color tint
- Normal map (`normal_enabled`, `normal_texture`)
- ORM texture (R=ambient occlusion, G=roughness, B=metallic) — single texture, per-channel routing
- Metallic/roughness factors
- Emissive color + emissive texture
- Texture transforms from `KHR_texture_transform` (offset, scale, rotation) — glTF `scale` = SL `repeat`

**Race condition guard:** Legacy textures for faces with `renderMaterialData` are not queued — otherwise they arrive later and overwrite PBR. Stale `_pending_by_texture` entries purged in `handle_update_faces`.

## Mesh Pipeline

node-metaverse fetches SL mesh assets, converts to GLB (binary glTF 2.0) with hand-rolled encoder, writes to cache:

```
asset-cache/meshes/{uuid}.glb
```

Coordinate transform: SL (X,Y,Z) → Godot (X,Z,-Y). This is a det=+1 rotation (90° around X), so triangle winding is preserved (no swap needed). Normals are transformed by the same matrix.

GLB files are parsed on WorkerThreadPool threads (`GLTFDocument.append_from_file()`), then `ImporterMesh.get_mesh()` runs on main thread (creates RS resources). Up to 16 concurrent mesh tasks.

### Fetch dedup

Both mesh and texture fetch queues track a `notified` set — each asset UUID is sent to Godot exactly once per session. Godot's `mesh_cache`/`texture_cache` provide a second layer of dedup. Failed loads tracked in `mesh_load_failed`/`texture_load_failed` to avoid retries.

## Sculpt Pipeline

Sculpt maps (texture-encoded vertex data) are handled by `SculptFetchQueue`:

1. Bridge detects `extraParams.sculptData` on prim objects
2. Sculpt texture UUID + type fetched, decoded to RGBA
3. `sculpt-converter.ts` interprets pixel data as vertex positions, generates GLB
4. Mesh ID = hash of `{textureUuid}_{sculptType}`, cached and reused
5. Sent to Godot via `mesh_ready`, same as regular meshes

## Prim Geometry

SL prims are defined by path type, profile, hollow, twist, taper, etc. `prim_mesh_generator.gd` is a GDScript port of the LLVolume path/profile sweep algorithm.

- Shape params sent from bridge for non-mesh/non-sculpt prims
- Box, cylinder, sphere, prism, torus, tube, ring with correct face count
- Meshes cached by shape parameter hash (most scenes have <100 unique shapes)
- SL→Godot coordinate conversion via `_sl_to_godot()` with correct winding
- Face ordering matches SL (verified by headless tests)

### Implemented prim features
- [x] Hollow prims (all profile types)
- [x] Profile/path cuts (begin/end)
- [x] Twist, taper, shear, skew, revolutions, radius offset

### Missing prim features
- [ ] Spherical UV mapping (mappingType=4)

## Light Pipeline

SL point and spot lights are rendered via RenderingServer light RIDs (`RSLight` wrapper).

- **Omni lights**: color, intensity, radius, falloff (SL exponential → Godot attenuation curve)
- **Spot lights**: above + FOV (SL full FOV radians → Godot half-angle degrees) + focus
- **Projection textures**: rectangular image padded to square inscribed in circle (sqrt(2) border) for Godot's circular spot cone
- **Distance culling**: max 64 active lights, swept every 2s. Nearest lights within 64m created; far lights destroyed. Light data preserved for re-creation when camera moves closer.
- **Shadow avoidance**: lights on layer 1 only, water on layer 2 — prevents shadow map artifacts
- Lights track parent object transform, updated on `object_update_batch`

## Water

### OceanFFT + Custom SSR

Production water uses the `tessarakkt.oceanfft` addon for FFT-based wave displacement with QuadTree3D LOD, plus custom screen-space reflections spliced into `SurfaceVisual.gdshader`.

- FFT resolution 128, horizontal dimension 256m, wind speed 12 m/s
- QuadTree LOD: 5 levels, quad size 4096, LOD ranges [48, 96, 192, 384, 768, 1536]
- Custom SSR ray-march: 0.25m steps + binary refinement, dithered ray start, distance fade
- Refraction via screen-texture UV offset by world-space wave normals
- Depth-based color: `mix(background, deep_blue, depth²)` + fresnel sky blend
- Shore fade: transparent → opaque over `shore_fade_depth`
- Underwater fog via `_update_underwater_fog()` using `Ocean3D.get_wave_height()`
- Water on render layer 2 (set recursively on QuadTree3D children)

Flat water fallback (`_build_flat_water()`) exists for when OceanFFT is unavailable.

See `docs/water-rendering.md` for shader details, pitfalls, and depth reconstruction fix.

## Terrain

Terrain heights are written as raw Float32LE binary (256KB) to cache. Godot builds an ArrayMesh (256x256 vertices, 130,050 triangles) with computed normals.

### Missing / TODO
- [ ] Terrain textures (4-texture blend based on height ranges)
- [ ] Neighbor region terrain
- [ ] Terrain LOD for distant terrain

## Frame Budget System

Adaptive time budgeting prevents asset finalization from causing frame drops:

- **Desktop**: 33.3ms target (30 fps floor). Min 2ms finalize budget when on-target; 8ms when already over budget (no point protecting FPS that's already bad).
- **VR**: 13.9ms target (72 Hz). Zero finalize budget when frame is already late — adding CPU work only makes the next frame late too.
- Budget split: 60% textures / 40% meshes (textures are cheaper per-item)
- WebSocket message processing: 12ms budget (both VR and desktop). High-priority messages (avatar updates, self_id) bypass budget and are always dispatched immediately.
- Light constants also centralized: `MAX_ACTIVE_LIGHTS` (64), `LIGHT_CULL_DISTANCE` (64m), `LIGHT_CULL_INTERVAL` (2s), `MAX_SHADOW_LIGHTS` (4 nearest spots).
- All constants in `frame_budget.gd` so the two competing budgets (message processing in main.gd, finalization in scene_manager.gd) can't silently drift apart.

## VR Support

OpenXR integration via Godot's XR interface, triggered by `--vr` command-line flag.

**Working:**
- [x] XROrigin3D + XRCamera3D positioning at avatar eye height
- [x] OpenXR initialization with session state logging
- [x] 72 Hz refresh rate (Quest 3 lowest rate = largest frame budget)
- [x] 1.5x render target supersample for thin geometry anti-aliasing
- [x] MSAA disabled (XR swapchain lacks STORAGE_BIT for compute resolve)
- [x] VSync disabled (OpenXR controls frame pacing via xrEndFrame)
- [x] Self avatar hidden in first-person
- [x] Tighter visibility range (32m) and finalize budgets
- [x] XR pose threshold gating (5mm / 0.06°) to keep ATW reprojection stable

**Known issue:** Godot 4.6.x and 4.7-dev1 have an OpenXR regression causing whole-screen black flicker on Quest 3 via PC Link. Use Godot 4.4-stable for VR.

**TODO:**
- [ ] Motion controller input (movement, interaction)
- [ ] VR-appropriate UI panels

## Milestones

### M1 — Boxes in Space ✅
- [x] Godot 4.4 project with WebSocket TCP server (GDScript)
- [x] GodotBridge (TypeScript) spawns Godot, connects WebSocket, streams data
- [x] Initial snapshot of all root prims sent on connect
- [x] Live object create/update/kill via event subscriptions + batched terse updates
- [x] SL→Godot coordinate conversion (X,Z,-Y position; X,Z,-Y,W quaternion)
- [x] BoxMesh instances at received positions with correct scale
- [x] Avatar tracking (create/update/kill with 500ms polling)
- [x] Orbit camera (right-drag to orbit, scroll to zoom)
- [x] Camera follows self avatar (self_id message, smooth lerp tracking)
- [x] WASD movement (input_move → ControlFlags + body rotation → AgentUpdate)
- [x] Full Electron integration (Godot button in AccountList, IPC wiring)
- [x] Kill sweep for deleted objects (2s polling fallback)
- **Victory:** Walk around a region as colored cubes with third-person camera

### M1.5 — Mesh Objects ✅
- [x] MeshFetchQueue: concurrent mesh download (max 4) with dedup and disk caching
- [x] LLMesh → GLB converter (hand-rolled binary glTF 2.0 encoder)
- [x] GLB loaded in Godot via GLTFDocument, replaces box placeholder
- [x] Correct winding order (det=+1 rotation preserves winding, no swap)
- **Victory:** Modern SL mesh content renders with correct geometry

### M2 — Textures ✅
- [x] TextureFetchQueue: concurrent texture download (max 8) with dedup and disk caching
- [x] J2C → WebP decode via opj_decompress + sharp (was PNG, switched for ~5-10x size savings)
- [x] Extract default-face texture info (textureId, color, fullBright) from TextureEntry
- [x] Extract doubleSided flag from GLTF material overrides
- [x] Godot loads WebP → ImageTexture, cached material with color tint + alpha scissor + unshaded
- [x] Placeholder materials (solid color) while textures download
- [x] Proper backface culling: CULL_BACK default, CULL_DISABLED when doubleSided
- [x] Texture material preserved when mesh replaces box placeholder
- [x] UV repeat/offset from TextureEntry applied via uv1_scale/uv1_offset
- [x] Fetch dedup: each asset UUID notified to Godot exactly once per session
- **Victory:** Recognizable textured world

### M2.5 — Avatar Movement ✅
- [x] Avatar rotation sent from bridge (getRotation() quaternion)
- [x] Avatar boxes rotate in scene_manager (both create and update)
- [x] Self avatar rotates instantly from local A/D yaw (no server round-trip)
- [x] Jump (E key → AGENT_CONTROL_UP_POS)
- [x] Crouch (C key → AGENT_CONTROL_UP_NEG)
- [x] Fly toggle (F key → fly state sent via input_move)
- [x] Always-run toggle + double-tap W sprint
- [x] Strafing (Q/E)
- [x] SL quaternion w-positive fix (wire format reconstructs w as always positive)
- **Victory:** Avatar box visually rotates with A/D, jumps, crouches, flies, runs

### M3 — Terrain + Water + Sky ✅
- [x] Terrain heightmap cached as binary, loaded by Godot from disk (not over WebSocket)
- [x] ArrayMesh terrain (256×256 vertices, computed normals, green-brown material)
- [x] OceanFFT water with QuadTree3D LOD and custom SSR reflections + refraction
- [x] ProceduralSkyMaterial from EEP sun direction + sunlight/ambient colors
- [x] DirectionalLight3D oriented to match SL sun direction
- [x] Underwater fog detection via wave height
- [x] WebSocket buffer increased to 1MB for larger messages
- **Victory:** Standing on ground with animated water and sky, not floating in void

### M3.5 — Linksets (Child Prims) ✅
- [x] Bridge sends child prims with `parentId` field in `object_create`
- [x] Recursive `sendChildren()` walks `obj.children[]` from `getAllObjects`
- [x] Avatar attachments skipped (parent `PCode === 47`) — no avatar mesh yet
- [x] Late-arriving children handled: when new root arrives, check for already-buffered children
- [x] Flat hierarchy in Godot (all objects direct children of SceneManager, no node parenting)
- [x] Child world position = `parent_pos + parent_rot * child_offset` (avoids Godot scale inheritance/shearing)
- [x] Root movement propagates to children via `_update_children_transforms()`
- [x] Pending children buffer: children arriving before their parent are reparented when parent arrives
- [x] Recursive cleanup on object kill (children cleaned up with parent)
- [x] Rescan for late-arriving children every 2s (node-metaverse doesn't fire events for children)
- **Victory:** Linksets (buildings, furniture, vehicles) render fully, not just root prims

#### Why flat hierarchy?
SL linksets have independent scale per prim — parent scale does NOT affect children. Godot's scene tree inherits scale from parent nodes, and with rotated non-uniform parents this causes shearing. The flat approach keeps all RSInstances independent, computing world positions manually from parent transform + child offset.

### M3.6 — Performance & Memory ✅
- [x] Fixed WASM J2K decoder bug (forked `pyrokitty64/openjpeg` — multi-component pixel stride was hardcoded to 3)
- [x] Platform-conditional decode: native `opj_decompress` on Windows (no WASM heap), lazy WASM fallback on other platforms
- [x] GPU BC1/BC3 texture compression via WebGPU compute shaders (`.bctex` output) — 4:1 VRAM savings, GPU-native
- [x] S3TC fallback compression in Godot for WebP textures
- [x] Asset ready batching: buffer texture_ready/mesh_ready, flush within adaptive time budget
- [x] Per-face textures: bridge sends up to 8 faces per object, Godot applies per-surface override materials
- [x] GLTF alpha mode support (OPAQUE, BLEND, MASK with cutoff) alongside SL standard alpha
- [x] Memory diagnostics logging (VRAM textures/buffers, object/avatar/light counts, cache sizes — every 10s)
- [x] 16 dedicated OS threads for texture loading (bypasses WorkerThreadPool low-priority cap)
- [x] 16 concurrent mesh tasks via WorkerThreadPool
- [x] Adaptive frame budget: desktop (33ms target, aggressive when over) vs VR (13.9ms, zero when late)
- [x] RenderingServer RID instances replace MeshInstance3D nodes (eliminates scene tree overhead)
- [x] Known-opaque texture promotion (DXT1 → skip transparency pipeline entirely)
- [x] Material cache key rounding (2 decimal UV params to collapse near-duplicates)
- **Victory:** Godot renders thousands of objects at 30+ fps desktop, 72 fps VR

### M4 — Better Geometry ✅
- [x] Procedural prim mesh generator (`prim_mesh_generator.gd`) — port of LLVolume path/profile sweep
- [x] Shape params sent from bridge (`godot-bridge.ts`) for non-mesh/non-sculpt prims
- [x] Box, cylinder, sphere, prism, torus, tube, ring with correct face count
- [x] Mesh cached by shape parameter hash (most scenes have <100 unique shapes)
- [x] SL→Godot coordinate conversion via `_sl_to_godot()` with correct winding
- [x] Face ordering matches SL (verified by headless tests)
- [x] Sculpt map support (sculpt texture → GLB via SculptFetchQueue)
- [x] Planar UV mapping shader (`planar_map.gdshader`) — SL's `planarProjection()` + `xform()`
- [x] Standard UV shader with texture rotation support (`standard_uv.gdshader`)
- [x] Hollow prims (all profile types)
- [x] Profile/path cuts (begin/end)
- [x] Twist, taper, shear, skew, revolutions, radius offset
- [ ] Spherical UV mapping (mappingType=4)
- **Victory:** Prims render with full geometry parameters; only spherical UV mapping remains

### M4.5 — PBR Materials ✅
- [x] MaterialFetchQueue: download material assets (AssetType 57), parse LLSD binary → glTF JSON
- [x] Three-layer priority: renderMaterialData > gltfMaterialOverrides > legacy TextureEntry
- [x] `object_update_faces` message for async PBR material resolution
- [x] Normal maps, ORM textures (AO/roughness/metallic), emissive color + texture
- [x] Metallic/roughness factors from glTF material
- [x] KHR_texture_transform (offset, scale, rotation) for PBR textures
- [x] Race condition guard: legacy textures not queued for faces with renderMaterialData
- **Victory:** PBR content renders with correct metallic/rough/normal/emissive

### M4.6 — Lights ✅
- [x] Point lights (omni) and spot lights via RenderingServer RIDs
- [x] Projection textures with sqrt(2) padding for circular cone mapping
- [x] SL falloff → Godot attenuation conversion
- [x] SL spotFov (full FOV radians) → Godot half-angle degrees
- [x] Distance culling: max 64 active, swept every 2s, nearest-first priority
- [x] Light data preserved for re-creation when camera approaches
- [x] Light transforms track parent object movement
- **Victory:** Lit environments with projection textures and spot lights

### M5 — Navigation & Movement (partially done)
- [x] Fly mode toggle (F key)
- [x] Run mode (always-run toggle + double-tap W sprint)
- [x] Strafing (Q/E keys)
- [x] Avatar interpolation (smooth lerp/slerp with velocity extrapolation)
- [x] Physics object interpolation (velocity/acceleration extrapolation with blend correction)
- [x] Teleport support (via minimap and world map)
- [ ] Coordinate display
- [ ] Region crossing
- **Victory:** Can navigate a region freely

### M6 — Avatars (mesh body focus, no legacy system avatar)

Modern SL avatars are a skeleton + pile of rigged mesh attachments + baked textures.
Reuses existing animesh pipeline (skeleton, bone eval, GLB rigged mesh).
Shape sliders deferred to Phase 2 — default skeleton shape is acceptable for first pass.

**Other viewers to study:** Crystal Frost, SL mobile viewer, LibreMetaverse — may have
pre-extracted shape param tables or simplified appearance pipelines.

#### Phase 1 — Skeleton + Attachments (IN PROGRESS)
- [x] Create skeleton root Node3D per avatar in `handle_avatar_create` (registered in `animesh_roots`)
- [x] Route rigged mesh attachments to avatar skeleton (parentId = avatarLocalId → animesh pipeline)
- [x] Track attachments via `Avatar.getAttachments()` + `onAttachmentAdded` subscription
- [x] HUD attachment filtering (points 34-41 skipped via `isHudAttachment()`)
- [x] Avatar animations: `subscribeToAvatarAnimation()` forwards AvatarAnimation circuit messages
- [x] Attachment linkset child prims: grandchildren registered via `_register_animesh_descendants()`
- [x] Non-rigged attachment positions follow avatar (recursive `_update_children_world_pos()`)
- [x] Compute-once bone eval: reference skeleton computes poses, others get cached results by bone name
- [x] Per-root skeleton list cache (`animesh_root_skeletons`) for O(1) process_animesh lookup
- [x] Animation batching: bridge-side dedup + batch (`updateAnimSet` → `animations_batch` message). Replaces old 3-message flow. System animations (STAND, WALK) are regular server assets, not packaged.
- [x] Initial snapshot attachment routing: `getObjectsByParent(avatarLocalId)` instead of relying on `getAllObjects()` which only returns root parents
- [x] Blue box avatar placeholder (smaller 0.3x1.4x0.3 so rigged attachments visible around it)
- [x] RSI fall-through fix: `_apply_mesh_to_pending` now `continue`s after animesh instantiation instead of setting rigged mesh on RSI (was rendering a second giant unskinned copy)
- [x] Object creation: animesh children with rigged meshes get placeholder box on RSI, not the rigged mesh
- [x] Non-animated bone fix: bones without animation keyframes skip pose computation instead of lossy SL↔Godot round-trip (was distorting collision volume bones)
- [ ] **BUG: Giant heads** — Head attachment root prim UUID `da211b7c-8f3d-df3e-d176-f39ca5b4a2b3`, child mesh prim `2306d424-fb38-2389-b2a1-161400df7c0e`. Neither UUID appears in bridge or Godot logs — node-metaverse doesn't have them in its object store. The head that IS rendering comes from attachment point 2 (skull), objects like 653391379/380/381 with mesh UUIDs f017afae/5af14003/02637ddf (54/54/28 bones). These meshes span the FULL skeleton (pelvis to toes, including collision volume bones HEAD, NECK, CHEST etc). Ruled out causes: (1) RSI fall-through rendering unskinned copy — fixed, head still giant. (2) Non-animated bone rest pose distortion — fixed, head still giant. (3) Missing attachments — our avatar gets 10 non-HUD attachments, 26 rigged meshes instantiated, 5 animations applied. Pipeline is working. **Still unsolved.** Likely cause: BSM (Bind Shape Matrix) scale in the GLB, or the MeshInstance3D under Skeleton3D rendering at wrong transform. Need to inspect actual vertex positions / AABB of the instantiated head MeshInstance3D vs what SL expects.
- [ ] **BUG: Animation jitter** — reduced by batching but not eliminated. Avatar still sideways on first load.
- [ ] **BUG: Standing T-pose** — rest pose is T-pose for joints not covered by active animations.
- [ ] **BUG: Textures missing** — need BoM Phase 2 for real textures.
- [ ] **NOTE: `onAttachmentAdded` never fires** — zero events for ANY avatar in logs. All attachments come from `getAttachments()` at avatar creation time or `getObjectsByParent()` in rescan. Late-arriving attachments via subscription path are not working.
- [ ] **NOTE: Diagnostic logging active** — `[AvatarDebug]` lines in object_manager.gd, asset_pipeline.gd, scene_manager.gd, godot-bridge.ts. Remove when bugs are resolved.
- [ ] Display names (floating labels above avatar)
- [ ] Send attachment point info for non-rigged attachment bone positioning
- [ ] Clean up debug logging in asset_pipeline.gd and object_manager.gd
- **Victory:** Avatars render as their actual mesh body + clothes + hair on default skeleton

#### Phase 2 — Bakes on Mesh (BoM)
- [ ] Parse baked texture UUIDs from `AvatarAppearance` message TextureEntry (faces 0-10)
- [ ] BoM substitution: detect 11 magic bake UUIDs on attachment faces, replace with actual baked texture
- [ ] Send baked texture UUIDs to Godot per avatar, fetch/decode/apply them
- [ ] Handle `AvatarAppearance` updates (outfit changes mid-session)
- **Victory:** Mesh bodies show correct skin/makeup/tattoo layers

#### Phase 3 — Shape Sliders
- [ ] Parse `param_skeleton` sections from `avatar_lad.xml` (~30 skeleton-affecting params)
- [ ] Or pre-extract to JSON (see `scripts/content_tools/skel_tool.py` for reference parser)
- [ ] Apply visual param values (0-255) → bone position offsets + scale changes
- [ ] Handle driver params (primary params that control secondary params)
- [ ] Send shape data to Godot per avatar from `AvatarAppearance.VisualParam[]`
- **Victory:** Avatars have correct height, proportions, body shape

#### BoM Magic UUIDs (for reference)
```
IMG_USE_BAKED_HEAD      5a9f4a74-30f2-821c-b88d-70499d3e7183
IMG_USE_BAKED_UPPER     ae2de45c-d252-50b8-5c6e-19f39ce79317
IMG_USE_BAKED_LOWER     24daea5f-0539-cfcf-047f-fbc40b2786ba
IMG_USE_BAKED_EYES      52cc6bb6-2ee5-e632-d3ad-50197b1dcb8a
IMG_USE_BAKED_SKIRT     43529ce8-7faa-ad92-165a-bc4078371687
IMG_USE_BAKED_HAIR      09aac1fb-6bce-0bee-7d44-caac6dbb6c63
IMG_USE_BAKED_LEFTARM   ff62763f-d60a-9855-890b-0c96f8f8cd98
IMG_USE_BAKED_LEFTLEG   8e915e25-31d1-cc95-ae08-d58a47488251
IMG_USE_BAKED_AUX1      9742065b-19b5-297c-858a-29711d539043
IMG_USE_BAKED_AUX2      03642e83-2bd1-4eb9-34b4-4c47ed586d2d
IMG_USE_BAKED_AUX3      edd51b77-fc10-ce7a-4b3d-011dfc349e4f
```

### M7 — Interaction (partially done)
- [x] Right-click object picking with raycast
- [x] Debug inspector panel (object name, description, geometry info)
- [x] Object name/description editing via inspector
- [x] Basic touch (click to trigger script events)
- [ ] Sit on objects
- [ ] Object hover highlight
- **Victory:** Can interact with the world

### M8 — Visual Polish (ongoing)
- [ ] Terrain textures (4-texture blend based on height ranges)
- [ ] Neighbor region terrain
- [ ] Spherical UV mapping
- [ ] Texture animation (TextureAnim UV scrolling)
- [ ] Particles
- [ ] Flexi prims
- [ ] Alpha sorting
- [ ] Windlight/EEP day cycle animation
- [ ] Shadows + lighting improvements
- [ ] Draw distance / LOD tuning
- [x] Animesh rigged mesh support (non-avatar rigged objects)
- [ ] Distance-based texture fetch priority
- [ ] Texture LOD / mipmap size selection
- [ ] Underwater view (camera below water surface)

### M9 — VR Support (partially done)
- [x] OpenXR integration via Godot's XR interface
- [x] Head-tracked camera (XROrigin3D + XRCamera3D at avatar eye height)
- [x] VR frame budgets and visibility range tuning
- [x] Supersample + anti-aliasing for thin geometry
- [ ] Motion controller input (movement, interaction)
- [ ] VR-appropriate UI panels

## Resolved Questions

- **Embedded or separate window?** Separate window. Godot runs as its own process, Electron spawns it.
- **Which Godot version?** 4.4-stable. Godot 4.6.x has an OpenXR regression (black flicker on Quest 3). Version controlled by `godot-version.txt`.
- **GDExtension language?** C++ for prim tessellation (closest to existing llvolume code), GDScript for everything else. Currently all GDScript.
- **Scene tree or RenderingServer?** RenderingServer RIDs via `RSInstance` wrappers. MeshInstance3D nodes caused scene tree overhead at scale.
- **Camera ownership?** Godot owns camera locally for responsiveness, sends yaw back to node-metaverse for body rotation in AgentUpdate.
- **Movement model?** Godot sends key state (WASD + Q/E + jump/crouch) + camera yaw + fly toggle + running flag. Bridge sets ControlFlags on agent and mutates bodyRotation quaternion directly. Agent auto-sends AgentUpdate every 1s; we also call sendAgentUpdate() immediately on input change.
- **Texture format?** GPU-compressed `.bctex` (BC1/BC3 via WebGPU compute) is primary. WebP via sharp is fallback when WebGPU unavailable. Godot loads both natively.
- **JPEG2000 decoder?** Platform-conditional: native `opj_decompress.exe` on Windows (in `electron-ui/bin/`), WASM on other platforms. The WASM decoder uses a fork (`pyrokitty64/openjpeg`) that fixes a multi-component pixel stride bug in the original `@abasb75/jpeg2000-decoder`.
- **Linkset parenting?** Flat hierarchy — all RSInstances are independent. SL prims have independent scale (parent scale doesn't affect children), but Godot's scene tree inherits scale from parents, causing shearing with rotated non-uniform parents. World positions are computed manually: `parent_pos + parent_rot * child_offset`.
- **Winding order?** SL→Godot transform is det=+1 (rotation), so winding preserved.
- **Backface culling?** Respect GLTF doubleSided flag from material overrides. Default is CULL_BACK (single-sided).
- **Terrain delivery?** Binary file cache (not JSON over WebSocket) — avoids 1009 message-too-large errors.
- **SL quaternion wire format?** Only x,y,z sent; w reconstructed as sqrt(1-x²-y²-z²) so always positive. Must negate all components when w<0 before sending.
- **Water rendering?** OceanFFT addon for FFT wave simulation + QuadTree3D LOD. Custom SSR ray-march in shader (Godot built-in SSR doesn't work on transparent surfaces). See `docs/water-rendering.md`.

## File Structure

```
godot-viewer/
  PLAN.md                ← this file
  project.godot          ← Godot 4.4 project config (forward_plus renderer)
  godot-version.txt      ← Engine version string (read by godot-bridge.ts)
  main.tscn              ← Main scene (Node3D + SceneManager + Camera3D + XROrigin3D + light + env)
  Godot_v4.4-stable_win64/  ← Godot engine binary
  addons/
    tessarakkt.oceanfft/   ← OceanFFT addon (FFT wave simulation, QuadTree3D LOD)
      shaders/SurfaceVisual.gdshader  ← Water shader (FFT + custom SSR + refraction)
      Ocean.tres           ← Material resource with shader parameter defaults
  shaders/
    water_ssr.gdshader     ← Old standalone SSR water shader (reference only, not loaded)
  tests/
    test_prim_mesh.gd/.tscn         ← Prim mesh face ordering, normals, vertex bounds
    test_shader_materials.gd/.tscn  ← Shader compilation, material creation
    test_camera_controller.gd/.tscn ← Camera input, orbit, follow
    test_main.gd/.tscn              ← WebSocket server, message dispatch
    test_xr_rig.gd/.tscn            ← VR rig positioning
    test_water_setup.gd/.tscn       ← Shader compilation, Ocean3D initialization guards
  src/
    main.gd              ← WebSocket TCP server (1MB buffer), message dispatch, VR init, frame budget
    scene_manager.gd     ← RSInstance-based object/avatar CRUD, flat linkset hierarchy, terrain/water/sky,
                           texture/material/mesh/light pipelines, PBR materials, frame-budgeted finalization
    prim_mesh_generator.gd ← Procedural prim geometry from SL shape params (port of LLVolume), cached by param hash
    camera_controller.gd ← Orbit camera with avatar follow, WASD+Q/E+F input, fly/run/sprint, self-avatar yaw,
                           right-click object picking, debug inspector panel
    xr_rig.gd            ← XROrigin3D positioning at avatar eye height (VR mode)
    frame_budget.gd      ← Central timing constants for VR (72Hz) and desktop (30fps) budgets, light limits, shadow caps
    standard_uv.gdshader ← Custom shader for texture rotation + UV transform (opaque)
    standard_uv_alpha.gdshader ← Same with alpha blending
    planar_map.gdshader  ← Custom shader for SL planar UV projection (opaque)
    planar_map_alpha.gdshader ← Same with alpha blending

electron-ui/src/main/
  godot-bridge.ts        ← Spawns Godot, WebSocket client, streams objects/avatars/terrain/environment,
                           handles input_move, queues projection texture fetches, kills on shader errors
  mesh-fetch-queue.ts    ← Concurrent mesh download queue with dedup, disk caching, and notify-once
  mesh-converter.ts      ← LLMesh → GLB (binary glTF 2.0) converter
  sculpt-fetch-queue.ts  ← Sculpt texture fetch + conversion to GLB mesh
  sculpt-converter.ts    ← Sculpt map pixel data → vertex positions → GLB
  texture-fetch-queue.ts ← Concurrent texture download queue with J2C decode, disk caching, and notify-once
  decode-pool.ts         ← Worker thread pool (8 workers) for parallel J2K decode
  texture-decode-worker.ts ← Worker thread: native opj_decompress (Windows) or WASM (other) → sharp
  material-fetch-queue.ts ← PBR material asset download, LLSD binary parse → glTF JSON, override layering
  gpu-compress-queue.ts  ← Queues RGBA textures for GPU compression, writes .bctex output
  gpu-compress-window.ts ← Hidden BrowserWindow hosting WebGPU compute shader for BC1/BC3 compression

electron-ui/src/gpu-compress/
  compress.ts            ← WebGPU compute shader orchestration (BC1/BC3 block encoding)
  bc-compress.wgsl       ← WGSL compute shader for BC1/BC3 block compression
  bctex-format.ts        ← .bctex file format: header + mip chain serialization
  index.html             ← Minimal HTML for hidden BrowserWindow WebGPU context
```
