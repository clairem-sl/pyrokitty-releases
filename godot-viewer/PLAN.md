# Godot Viewer Sidecar — Plan

## Concept

A Godot 4.6 application that acts as a **render sidecar** to the existing PyroKitty stack. node-metaverse handles all SL protocol work (login, UDP, caps, object tracking, asset fetch). Godot receives scene commands over WebSocket and renders the 3D world. The Electron UI continues to handle chat, inventory, friends, groups, and map.

```
┌──────────────────────────────┐
│  Electron (React/TypeScript) │
│  Chat, Inventory, Friends,   │
│  Groups, Map, Login UI       │
├──────────────────────────────┤
│  node-metaverse (TypeScript) │
│  SL protocol, UDP, caps,     │
│  object tracking, avatars,   │
│  asset fetch, texture decode │
├──────────┬───────────────────┘
│    WebSocket IPC             │
├──────────┴───────────────────┐
│  Godot 4.6 sidecar           │
│  Scene tree, rendering,      │
│  camera, input forwarding    │
└──────────────────────────────┘
```

## IPC Protocol (WebSocket + JSON)

Godot runs a WebSocket (TCP) server on a local port (default 9100). node-metaverse connects as a client.

### node-metaverse → Godot

| Message | Purpose |
|---------|---------|
| `self_id` | Identify the bot's own avatar UUID so camera can follow it |
| `object_create` | New object: localId, uuid, parentId, position, rotation, scale, meshId, textureId, color, fullBright, doubleSided, repeatU/V, offsetU/V, texRotation |
| `object_update_batch` | Batched position/rotation/scale changes (coalesced every 50ms) |
| `object_kill` | Remove object from scene |
| `mesh_ready` | Mesh converted to GLB and written to cache |
| `texture_ready` | Texture decoded to WebP and written to cache |
| `avatar_create` | New avatar: id, name, position, rotation |
| `avatar_update` | Avatar position + rotation update |
| `avatar_kill` | Remove avatar |
| `terrain_ready` | Heightmap binary cached to disk, path + waterHeight |
| `environment_data` | Sun direction, sunlight color, ambient color from EEP |
| `region_info` | Region name, coordinates, flags *(future)* |

### Godot → node-metaverse

| Message | Purpose |
|---------|---------|
| `input_move` | WASD/E/C state + camera yaw → control flags + body rotation |
| `input_click` | Object click: localId, face, UV *(future)* |
| `camera_position` | Current camera world position *(future)* |
| `ready` | Godot finished loading, ready for data |

## Texture Pipeline

node-metaverse fetches J2C textures from SL CDN. A worker thread pool (8 threads) decodes each texture. On Windows, uses native `opj_decompress.exe` (no WASM heap overhead). On other platforms, lazy-loads the fixed WASM decoder (`pyrokitty64/openjpeg` fork — original had a multi-component pixel stride bug). Output is converted to WebP via sharp, then written to a shared cache folder:

```
godot-viewer/cache/textures/{uuid}.webp
```

Godot receives a `texture_ready` message with the UUID and path, loads the WebP into an ImageTexture, and applies it as a material_override. Materials are cached by a composite key of `{textureId}_{colorHex}_{fullBright}_{doubleSided}_{uvParams}`.

### Material properties
- `albedo_texture` = loaded ImageTexture
- `albedo_color` = face color tint from TextureEntry (multiplied with texture)
- `uv1_scale` = repeatU, repeatV (texture tiling)
- `uv1_offset` = offsetU, offsetV (texture offset)
- `transparency = ALPHA_SCISSOR` when alpha < 1.0 (threshold 0.5)
- `shading_mode = UNSHADED` when fullBright flag set
- `cull_mode = CULL_DISABLED` when GLTF doubleSided flag set, else `CULL_BACK`
- Placeholder material (solid color tint) shown while texture downloads

### Current scope
- Per-face texturing: bridge extracts up to 8 faces from TextureEntry, sends per-face info (textureId, color, UV, alpha mode)
- Godot applies per-surface override materials via `set_surface_override_material()`
- S3TC compression in Godot (`Image.compress(COMPRESS_S3TC)` + `generate_mipmaps()`) — 4:1 VRAM savings, GPU-native

### Missing / TODO
- **Texture rotation** — data is sent (`texRotation`) but not applied; `StandardMaterial3D` has no UV rotation property. Needs a custom shader.
- **Planar mapping** — `mappingType` enum available (Default=0, Planar=2, Spherical=4) but not sent or applied. Needs a custom shader that projects UVs from world-space position.
- **Texture animation** — `TextureAnim` UV scrolling not implemented.

## Mesh Pipeline

node-metaverse fetches SL mesh assets, converts to GLB (binary glTF 2.0) with hand-rolled encoder, writes to cache:

```
godot-viewer/cache/meshes/{uuid}.glb
```

Coordinate transform: SL (X,Y,Z) → Godot (X,Z,-Y). This is a det=+1 rotation (90° around X), so triangle winding is preserved (no swap needed). Normals are transformed by the same matrix.

### Fetch dedup
Both mesh and texture fetch queues track a `notified` set — each asset UUID is sent to Godot exactly once per session. Godot's `handle_object_create` checks its in-memory `mesh_cache`/`texture_cache` so objects arriving after the first load use the cached resource directly.

## Terrain Pipeline

Terrain heights are written as raw Float32LE binary (256KB) to:

```
godot-viewer/cache/terrain/heightmap.bin
```

Godot receives a `terrain_ready` message with path + waterHeight. The scene manager reads the binary file, builds an ArrayMesh (256×256 vertices, 130,050 triangles), and creates a water plane at the specified height.

### Missing / TODO
- **Terrain textures** — SL regions specify 4 terrain textures + height ranges for blending. Currently using a solid green-brown material.
- **Neighbor region terrain** — only current region terrain is loaded.
- **Terrain LOD** — full resolution everywhere; could use LOD for distant terrain.

## Prim Geometry

SL prims are defined by path type, profile, hollow, twist, taper, etc. These must be tessellated into triangle meshes client-side.

### Phased approach:

1. **Phase 1 — Box placeholder:** All prims render as scaled boxes.
2. **Phase 2 — Prim type mapping:** Map SL prim types to Godot built-ins (CylinderMesh, SphereMesh, etc.)
3. **Phase 3 — Accurate tessellation:** Port the path/profile sweep code from llvolume.cpp into a GDExtension (C++)

## Milestones

### M1 — Boxes in Space ✅
- [x] Godot 4.6.1 project with WebSocket TCP server (GDScript)
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
- [x] SL quaternion w-positive fix (wire format reconstructs w as always positive)
- **Victory:** Avatar box visually rotates with A/D, jumps with E, crouches with C

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
SL linksets have independent scale per prim — parent scale does NOT affect children. Godot's scene tree inherits scale from parent nodes, and with rotated non-uniform parents this causes shearing. The flat approach keeps all nodes as direct children of SceneManager, computing world positions manually from parent transform + child offset.

### M3 — Terrain + Water + Sky ✅
- [x] Terrain heightmap cached as binary, loaded by Godot from disk (not over WebSocket)
- [x] ArrayMesh terrain (256×256 vertices, computed normals, green-brown material)
- [x] Water plane (256×256m PlaneMesh, semi-transparent blue, at waterHeight)
- [x] ProceduralSkyMaterial from EEP sun direction + sunlight/ambient colors
- [x] DirectionalLight3D oriented to match SL sun direction
- [x] WebSocket buffer increased to 1MB for larger messages
- **Victory:** Standing on ground with water and sky, not floating in void

### M3.6 — Performance & Memory ✅
- [x] Fixed WASM J2K decoder bug (forked `pyrokitty64/openjpeg` — multi-component pixel stride was hardcoded to 3)
- [x] Platform-conditional decode: native `opj_decompress` on Windows (no WASM heap), lazy WASM fallback on other platforms
- [x] S3TC GPU texture compression in Godot (`Image.compress(COMPRESS_S3TC)` — 4:1 memory savings, GPU-native)
- [x] Asset ready batching: buffer texture_ready/mesh_ready, flush 50 per tick at 100-200ms intervals
- [x] Per-face textures: bridge sends up to 8 faces per object, Godot applies per-surface override materials
- [x] GLTF alpha mode support (OPAQUE, BLEND, MASK with cutoff) alongside SL standard alpha
- [x] Memory diagnostics logging (RSS, heap, external, arrayBuffers, object store, decode queue — every 30s)
- [x] Worker thread pool: 8 threads for parallel J2K→WebP decode
- **Victory:** Godot memory usage reasonable with S3TC; textures load without freezing

### M4 — Better Geometry
- [ ] Prim type mapping (cylinder, sphere, torus, tube, ring)
- [ ] GDExtension for accurate prim tessellation (port from llvolume)
- [ ] Sculpt map support
- **Victory:** World looks roughly correct geometrically

### M5 — Navigation & Movement
- [ ] Fly mode toggle (F key or double-jump)
- [ ] Minimap or coordinate display
- **Victory:** Can navigate a region freely

### M6 — Avatars
- [ ] Avatar capsule/placeholder at correct positions
- [ ] Skeleton + mesh rigging
- [ ] Bake textures for appearance
- [ ] Basic animations
- **Victory:** See other avatars moving around

### M7 — Interaction
- [ ] Click to select/touch objects
- [ ] Sit on objects
- [ ] Object hover highlight
- **Victory:** Can interact with the world

### M8 — Visual Polish (ongoing)
- [ ] Terrain textures (4-texture blend based on height ranges)
- [ ] Neighbor region terrain
- [ ] Texture rotation via custom shader
- [ ] Planar/spherical UV mapping via custom shader
- [ ] Texture animation (TextureAnim UV scrolling)
- [ ] Particles
- [ ] Flexi prims
- [ ] Alpha sorting
- [ ] Windlight/EEP day cycle animation
- [ ] Shadows + lighting improvements
- [ ] Draw distance / LOD tuning
- [ ] Rigged mesh support
- [ ] PBR/glTF material overrides
- [ ] Distance-based texture fetch priority
- [ ] Texture LOD / mipmap size selection
- [ ] Electron memory optimization (object store, worker overhead)
- [ ] Send TURN_LEFT/TURN_RIGHT control flags during A/D rotation

### M9 — VR Support (future)
- [ ] OpenXR integration via Godot's XR interface
- [ ] Head-tracked camera (replace orbit camera)
- [ ] Motion controller input (movement, interaction)
- [ ] VR-appropriate UI panels

## Resolved Questions

- **Embedded or separate window?** Separate window. Godot runs as its own process, Electron spawns it.
- **Which Godot version?** 4.6.1 stable (mono build for potential C# use).
- **GDExtension language?** C++ for prim tessellation (closest to existing llvolume code), GDScript for everything else.
- **Camera ownership?** Godot owns camera locally for responsiveness, sends yaw back to node-metaverse for body rotation in AgentUpdate.
- **Movement model?** Godot sends key state (WASD + E/C) + camera yaw. Bridge sets ControlFlags on agent and mutates bodyRotation quaternion directly. Agent auto-sends AgentUpdate every 1s; we also call sendAgentUpdate() immediately on input change.
- **Texture format?** WebP via sharp (switched from PNG for ~5-10x disk savings). Godot loads both natively via Image.load(). Legacy PNG cache entries still work as fallback.
- **JPEG2000 decoder?** Platform-conditional: native `opj_decompress.exe` on Windows (in `electron-ui/bin/`), WASM on other platforms. The WASM decoder uses a fork (`pyrokitty64/openjpeg`) that fixes a multi-component pixel stride bug in the original `@abasb75/jpeg2000-decoder` — the pixel copy loop hardcoded stride 3, garbling 4-component (RGBA) textures.
- **Linkset parenting?** Flat hierarchy — all Godot nodes are direct children of SceneManager. SL prims have independent scale (parent scale doesn't affect children), but Godot's scene tree inherits scale from parents, causing shearing with rotated non-uniform parents. World positions are computed manually: `parent_pos + parent_rot * child_offset`.
- **Winding order?** SL→Godot transform is det=+1 (rotation), so winding preserved. Original winding swap was incorrect and has been removed.
- **Backface culling?** Respect GLTF doubleSided flag from material overrides. Default is CULL_BACK (single-sided).
- **Terrain delivery?** Binary file cache (not JSON over WebSocket) — avoids 1009 message-too-large errors.
- **SL quaternion wire format?** Only x,y,z sent; w reconstructed as sqrt(1-x²-y²-z²) so always positive. Must negate all components when w<0 before sending.

## File Structure

```
godot-viewer/
  PLAN.md                ← this file
  project.godot          ← Godot 4.6.1 project config (forward_plus renderer)
  main.tscn              ← Main scene (Node3D + SceneManager + Camera3D + light + env)
  Godot_v4.6.1-stable_mono_win64/  ← Godot engine binary
  cache/
    textures/            ← decoded texture cache (WebP files)
    meshes/              ← converted mesh cache (GLB files)
    terrain/             ← heightmap data (Float32LE binary)
  src/
    main.gd              ← WebSocket TCP server (1MB buffer), message dispatch
    scene_manager.gd     ← object/avatar CRUD (flat hierarchy with manual child transforms), terrain/water/sky, SL→Godot coord conversion, texture/material caching
    camera_controller.gd ← orbit camera with avatar follow, WASD+E/C input, self-avatar yaw

electron-ui/src/main/
  godot-bridge.ts        ← Spawns Godot, WebSocket client, streams objects/avatars (incl. linkset children), terrain/environment, handles input_move
  mesh-fetch-queue.ts    ← Concurrent mesh download queue with dedup, disk caching, and notify-once
  mesh-converter.ts      ← LLMesh → GLB (binary glTF 2.0) converter
  texture-fetch-queue.ts ← Concurrent texture download queue with J2C→WebP decode, disk caching, and notify-once
  decode-pool.ts         ← Worker thread pool (8 workers) for parallel J2K→WebP decode
  texture-decode-worker.ts ← Worker thread: native opj_decompress (Windows) or WASM (other) → sharp WebP
  j2k-converter.ts       ← J2C↔PNG conversion via native opj_decompress/opj_compress, J2C→WebP via sharp
```
