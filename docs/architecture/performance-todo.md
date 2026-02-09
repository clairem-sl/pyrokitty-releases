# Performance Optimization TODO

## High Impact Opportunities

### 1. Resolution Scaling + Upscaling - **DONE (FSR 1.0 EASU + CAS)**
**Potential: 2-4x framerate**

Render at 50-70% resolution, upscale with edge-aware filter, sharpen. This is what DLSS/FSR do (without the AI).

```
Render at 1080p instead of 1440p → FSR EASU (upscale) → CAS (sharpen) → output at 1440p
```

**Implementation:**
- `RenderResolutionMultiplier` (0.0-1.0) - Render at reduced resolution
- `RenderFSREnabled` (bool) - Enable FSR EASU edge-aware upscaling
- `RenderCASSharpness` (0.0-1.0) - CAS sharpening strength

**Default settings:**
```
RenderResolutionMultiplier = 0.7   // Render at 70% resolution
RenderFSREnabled = true            // Use FSR EASU upscaling
RenderCASSharpness = 0.5           // Apply moderate sharpening
```

**Location:** FSR EASU integrated into `postDeferredNoDoFF.glsl`, uniforms set in `pipeline.cpp:9108-9120`

**Remaining work:**
- Expose as user-friendly UI slider (Quality vs Performance)

### 2. Aggressive Avatar Impostors
**Potential: 30-50% faster in crowded scenes**

Avatars are expensive - rigged mesh skinning, 3 shadow passes each. The viewer has impostors but they could kick in closer:

| Current | Aggressive |
|---------|------------|
| Impostor at 20m+ | Impostor at 8-10m |
| Full mesh for 15 avatars | Full mesh for 5 nearest |

**Implementation notes:**
- Find impostor distance settings
- Add "max full-detail avatars" setting
- Consider impostor quality improvements (higher res sprites)
- Impostor update rate reduction for distant avatars

### 3. Alpha Draw Distance Culling - **DONE**
**Potential: 20-40% in particle-heavy scenes**

**Implemented:** Skip small alpha objects beyond 32m (pixelArea < 100).
Location: `lldrawpoolalpha.cpp:685-692`

### 4. GPU Occlusion Culling
**Potential: 30-50% in complex scenes**

Current occlusion culling is CPU-side. The viewer has GPU occlusion queries but they're conservative.

**Control Setting:** `LLPipeline::sUseOcclusion` (0=disabled, 1=read-only, 2=full)

**Current Bottlenecks:**
1. 1-4 frame latency for query results
2. Conservative fallback after `RenderOcclusionTimeout` (4) frames
3. One draw per query (each `glBeginQuery`/`glEndQuery` wraps single cube)
4. CPU still walks entire octree even with GPU queries

**Temporal Coherence — IMPLEMENTED (No FPS Impact):**
Setting `RenderOcclusionTemporalCoherence` (default 8) skips re-querying confirmed-occluded groups. Works correctly but no measurable FPS gain — occlusion queries themselves are trivially cheap. The real cost is CPU octree traversal.

**Key files:** `llvieweroctree.cpp` (query pool, checkOcclusion, doOcclusion), `pipeline.cpp:2784` (main entry)

#### GPU Frustum Culling — ATTEMPTED, REVERTED

Three versions attempted (v1 per-partition, v2 batched, v3 persistent buffer). All failed to improve performance.

**Why GPU frustum culling doesn't help in SL:**
- The CPU AABB-frustum test is only 5 dot products per group — trivially fast
- Even with GPU culling, the octree must still be traversed on CPU
- GPU dispatch + readback overhead exceeds the savings for ~3000-5000 groups
- Rate-limited collection (every 30 frames) eliminated traversal overhead but the stale data wasn't worth the complexity

**Files kept (dormant):** `llgpufrustumcull.h/cpp`, `frustumCullC.glsl`
**Debug setting:** `RenderGPUFrustumCull` (default FALSE)

**Conclusion:** Further optimization should target GPU-driven rendering (indirect draw calls, compute shader visibility) rather than moving individual tests to GPU.

#### Octree Traversal Throttling — ATTEMPTED, FAILED

Attempted to cache `LLCullResult` and skip `cull()` on most frames. Failed due to dangling pointers — `LLSpatialGroup`, `LLDrawable`, and `LLSpatialBridge` objects can be destroyed at any time (region crossing, object deletion, LOD changes). The render pipeline assumes fresh `sCull` data every frame.

Even when briefly working, performance improvement plateaued — octree traversal is NOT the main CPU bottleneck.

### 5. Shadow Draw Call Batching
**Potential: 20-30% of shadow time**

During shadow passes, we don't need textures. Could batch all untextured geometry into fewer draw calls regardless of material type. Investigate multi-draw indirect for modern GPUs.

---

## Already Implemented (FS:Pyrokitty)

### Per-Split Shadow Frame Skipping
Each cascade updates at a different frequency: `RenderShadowUpdateRate` (base) * `RenderShadowSplitRateScale^j`. Defaults: 1, 2, 4, 8 (near every frame, far every 8th). See [shadow-system.md](shadow-system.md) for full details.

### Shadow Optimizations
- **postSort skip** — Skip geometry rebuilding, alpha collection, and mesh updates during shadow passes. Location: `pipeline.cpp` (`!sShadowRender` checks in `stateSort`/`postSort`)
- **Small object culling** — `RenderShadowMinVertexCount` (default 64) and `RenderShadowMinSize` (default 0.25m) skip insignificant shadow casters. See [shadow-system.md](shadow-system.md).
- **Fixed alpha cutoff** — Shadow passes use fixed 0.5 cutoff instead of per-object `setMinimumAlpha()`, eliminating per-object `gGL.flush()`. See [shadow-system.md](shadow-system.md).
- **Shader bind tracking** — `renderAlphaObjects()` only calls `bind()` when switching shader types, reducing flush calls. See [shadow-system.md](shadow-system.md).

### FSR 1.0 Two-Pass Resolution Scaling (EASU + RCAS)
`RenderResolutionMultiplier` (default 0.7) + `RenderFSREnabled` (default true) + `RenderCASSharpness` (default 0.5). Two-pass: EASU upscale → RCAS sharpen. Location: `pipeline.cpp`, shaders in `deferred/postDeferredNoDoFF.glsl` and `deferred/fsrRCASF.glsl`.

### Auto-Tune Resolution (GPU-Bound Detection)
`AutoTuneResolutionEnabled` (default true) adjusts `RenderResolutionMultiplier` when GPU-bound. Uses `GL_TIME_ELAPSED` queries for accurate GPU frame time. Location: `llperfstats.cpp`, `pipeline.cpp`.

### Texture Priority Calculation Throttling
Reduced `updateImageDecodePriority` cost by ~52%. Offscreen face throttle (60 vs 10 frames), face cap (256 vs 1024), rigged face time gate (0.25s vs 0.1s), configurable `TextureFetchUpdateDivisor` (default 20). Location: `llviewertexturelist.cpp`, `llface.cpp`.

### GPU Texture Cache (DXT5 Compressed)
Stores textures in DXT5 for fast loading, bypassing J2C decode. `GPUTextureCacheEnabled` (default true), `GPUTextureCacheSize` (default 16GB). See [gpu-texture-cache.md](gpu-texture-cache.md) for architecture details.

### Impostor Optimizations
- Max resolution 512 → 128 (16x less VRAM) — `pipeline.cpp:11969`
- Skip second alpha depth pass — `pipeline.cpp:12019`
- Increased update intervals: 64/96/128 → 128/96/64 frames — `llvoavatar.cpp:5187`
- Reduced angle/distance sensitivity — `llvoavatar.cpp:3500,3514`

### OpenJPEG Multithreaded Decoding
Enabled per-decode threading via `opj_codec_set_threads(decoder, 2)`. Uses 2 threads per decode × 8 worker threads = up to 16 threads during heavy texture loading. Location: `llimagej2coj.cpp`.

### FPS Display Responsiveness Fix
Changed from median over 200 periods to 30-period window. Location: `llstatusbar.cpp:621`, `llviewerwindow.cpp:525`.

---

## CPU vs GPU Bottlenecks

### Why Shadows Are CPU-Heavy

Each shadow cascade requires a complete scene traversal — the actual GPU shadow map rendering is cheap (depth-only, no textures). The cost is **CPU walking the octree 4-6 times** with different frustums, plus sequential draw call submission (~4000 calls for 1000 objects × 4 passes).

OpenGL's single-threaded GL context limitation means only one thread can submit draw calls, leaving other cores idle.

### What Would Fix It: GPU-Driven Rendering

Modern engines use `glMultiDrawElementsIndirect` — a compute shader tests all AABBs against the frustum, writes visible object IDs to an indirect buffer, and one call renders everything. The viewer can't do this because each object has its own vertex buffer (designed ~15 years ago before GPU-driven rendering existed).

### Practical Path Forward

**Short term (settings):** Reduce `RenderShadowSplits`, `RenderShadowDetail`, `MaxNonImpostors`
**Medium term (code):** Parallel octree traversal, shadow-specific LOD
**Long term (architecture):** Unified vertex buffer, GPU-driven rendering with indirect draw calls

---

## Impostor TODO

### Skip deferred attachments for distant impostors
- Don't allocate normal/specular maps for far impostors
- Requires shader changes to handle missing textures

### Lower default MaxNonImpostors
- Change from 12 to 6 - more avatars render as impostors

### Skip small attachments during generation
- Don't render tiny attachments when generating impostor

### Pool render targets
- Reuse FBOs instead of one per avatar - reduces VRAM churn

---

## Research Needed

### Temporal Reprojection
Cache and reproject previous frame for static geometry. Challenges: motion vectors, disocclusion artifacts, ghosting.

### Mesh LOD Improvements
More aggressive LOD at distance. Shadow-specific LOD (blocked — LOD calculated once per frame).

### Texture Streaming Improvements
Reduce stalls from texture loading. Better prioritization of visible textures.

### Parallel/Async Rendering
Better multi-threading of scene traversal. Async GPU command buffer building.

---

## Automatic Resolution Scaling - IMPLEMENTED (Option 2)

### Goal
Automatically adjust `RenderResolutionMultiplier` to maintain target FPS, reducing GPU load when needed.

### Implementation Status: COMPLETE
Option 2 (Total GPU Frame Timer) has been implemented. See "Auto-Tune Resolution" in Already Implemented section above.

### Original AutoTune Limitation (Now Fixed)
The existing AutoTune system (`llperfstats.cpp`) could not reliably distinguish CPU vs GPU bottlenecks:
- Used CPU frame time as primary metric
- Only had GPU timing for avatars (not geometry, shadows, post-FX)
- Resolution scaling only helps GPU-bound scenarios

**Solution:** Added `GL_TIME_ELAPSED` query around entire render pass to measure true GPU frame time.

### Implementation Options (Historical)

| Option | Effort | Accuracy | Status |
|--------|--------|----------|--------|
| 1. Simple Frame Time | Low | Poor | Not used |
| 2. Total GPU Frame Timer | Medium | Good | **Implemented** |
| 3. Heuristic - Avatar GPU Ratio | Low | Moderate | Not used |
| 4. Shader Time Aggregation | Medium-High | Very Good | Future |

### Tuning Parameters

```
AutoTuneResolutionEnabled = true   // Enable resolution auto-tuning
AutoTuneResolutionMin = 0.5        // Never go below 50%
AutoTuneResolutionMax = 1.0        // Never exceed 100%
AutoTuneResolutionStep = 0.05      // Adjust by 5% per step
```

Resolution scaling at 0.7x reduces GPU pixel work by ~50% with minimal visual impact when FSR EASU + CAS sharpening is enabled.
