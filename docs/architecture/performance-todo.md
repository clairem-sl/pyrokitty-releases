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

Alpha-blended objects (particles, trees, water) are expensive because they can't use the depth buffer efficiently.

**Implemented:** Skip small alpha objects beyond 32m
- Location: `lldrawpoolalpha.cpp:685-692`
- Thresholds: distance > 32m AND pixelArea < 100
- Affects: trees, transparent attachments, glass, etc.
- Note: Particles already have separate distance culling in `llvopartgroup.cpp`

### 4. GPU Occlusion Culling
**Potential: 30-50% in complex scenes**

Current occlusion culling is CPU-side. Modern technique: render bounding boxes to depth buffer, read back visibility, skip hidden objects. The viewer has some of this but it's conservative.

#### Current Implementation Analysis (Investigated 2026-01)

The viewer DOES have GPU occlusion queries, but they're conservative and have latency issues.

**Control Setting:** `LLPipeline::sUseOcclusion`
- 0 = Disabled
- 1 = Read-only (queries run but results ignored)
- 2 = Full occlusion culling (default when enabled)

**How It Works:**
1. Octree spatial partitioning divides scene into `LLOcclusionCullingGroup` nodes
2. Each group can issue a GPU occlusion query (`GL_ANY_SAMPLES_PASSED`)
3. Query renders bounding box to depth buffer with color/depth write disabled
4. Result checked next frame(s) via `GL_QUERY_RESULT_AVAILABLE`
5. If 0 samples passed → group is occluded → skip rendering

**Key Files:**
| File | Function |
|------|----------|
| `llvieweroctree.cpp:799-818` | Query pool (1024 pre-allocated, recycled) |
| `llvieweroctree.cpp:1107-1170` | `checkOcclusion()` - async result readback |
| `llvieweroctree.cpp:1172-1294` | `doOcclusion()` - issue query, draw bounding box |
| `pipeline.cpp:2784-2875` | `doOcclusion()` - main entry, iterates occlusion groups |

**Current Bottlenecks:**
1. **1-4 frame latency**: Query results not available until next frame(s)
2. **Conservative fallback**: If result unavailable after `RenderOcclusionTimeout` (4) frames, renders anyway
3. **One draw per query**: Each `glBeginQuery`/`glEndQuery` wraps single cube draw
4. **CPU still walks tree**: Even with GPU queries, entire octree is traversed

**Hierarchical Optimization (Already Implemented):**
- Parent occlusion propagates to children (`llvieweroctree.cpp:1113-1117`)
- If parent occluded, children implicitly occluded (no query needed)

**What's Missing:**
- No Hi-Z (hierarchical Z-buffer) - would allow batch testing against depth pyramid
- No compute shader culling - `glDispatchCompute` is loaded but unused
- No indirect draw calls - could skip CPU entirely for occluded groups

#### Improvement Options

**Quick Wins (Low Effort):**
1. **Reduce `RenderOcclusionTimeout`** from 4 to 2 - faster occlusion response, risk of popping
2. **Increase query pool aggressiveness** - reuse queries more quickly

**Medium Effort (High Impact):**
1. **Batched query readback** - collect all pending queries, read in single batch
2. ~~**Temporal coherence** - assume groups that were occluded last frame are likely still occluded~~ **DONE**
3. **Early-out on visible parent** - if parent visible, skip child queries (inverse of current)

**High Effort (Highest Impact):**
1. **Hi-Z Culling** - build depth pyramid mipmap, test groups against it in compute shader
2. **GPU-Driven Rendering** - indirect draw calls, skip CPU for occluded geometry
3. **Compute shader frustum+occlusion** - batch test all groups in parallel on GPU

#### Temporal Coherence - IMPLEMENTED (No FPS Impact)

Groups that were confirmed occluded skip re-querying for N frames.

**Setting:** `RenderOcclusionTemporalCoherence` (default: 8 frames, 0 to disable)

**Result:** Works correctly (skips ~80% of queries) but **no measurable FPS improvement**.

**Why no improvement:** Occlusion queries are extremely cheap:
- `glBeginQuery` + draw 8-vertex cube + `glEndQuery` ≈ negligible GPU time
- The bottleneck is NOT the queries themselves
- Real costs: CPU octree traversal (still happens), actual geometry rendering, shadow passes

**Conclusion:** Further occlusion optimization should focus on:
1. Reducing CPU traversal overhead (compute shader culling)
2. Using occlusion results to skip more geometry earlier
3. GPU-driven rendering with indirect draw calls

**Files modified:**
- `llvieweroctree.h:333` - Added `mOcclusionConfirmed[NUM_CAMERAS]` member
- `llvieweroctree.cpp:879` - Initialize in constructor
- `llvieweroctree.cpp:1120-1128` - Skip in `checkOcclusion()`
- `llvieweroctree.cpp:1193-1202` - Skip in `doOcclusion()`
- `llvieweroctree.cpp:44` - Added `sOcclusionQueriesSkipped` stat counter
- `settings.xml` - Added `RenderOcclusionTemporalCoherence` setting
- `floater_stats.xml` - Added stat bar to view skipped count

### 5. Shadow Draw Call Batching
**Potential: 20-30% of shadow time**

During shadow passes, we don't need textures. Could batch all untextured geometry into fewer draw calls regardless of material type.

**Implementation notes:**
- Shadow passes already skip textures for most geometry
- Could merge draw pools during shadow rendering
- Investigate multi-draw indirect for modern GPUs

---

## Already Implemented (FS:Pyrokitty)

### FSR 1.0 Two-Pass Resolution Scaling (EASU + RCAS)
- `RenderResolutionMultiplier` - Render at reduced resolution (0.0-1.0, default 0.7)
- `RenderFSREnabled` - Enable FSR two-pass upscaling (default true)
- `RenderCASSharpness` - RCAS sharpening strength (0.0-1.0, default 0.5)
- Location: `pipeline.cpp` (two-pass rendering), shaders in `deferred/postDeferredNoDoFF.glsl` and `deferred/fsrRCASF.glsl`
- **Note:** After shader changes, must clear shader cache via **Developer > Rendering > Clear Shader Cache**

**Two-pass FSR 1.0 pipeline:**
1. **Pass 1 (EASU):** Edge-Adaptive Spatial Upsampling - upscales from reduced resolution to full resolution with edge-aware reconstruction
2. **Pass 2 (RCAS):** Robust Contrast Adaptive Sharpening - sharpens the upscaled result to recover fine detail

**When FSR is disabled:** Falls back to single-pass bilinear upscaling + CAS sharpening

**Buffer allocation:**
- `mFSREASUBuffer` - Intermediate buffer at full viewport resolution for EASU output
- Only allocated when `RenderResolutionMultiplier < 1.0`

### Auto-Tune Resolution (GPU-Bound Detection)
- `AutoTuneResolutionEnabled` - Enable automatic resolution scaling when GPU-bound (default true)
- `AutoTuneResolutionMin` - Minimum resolution (default 0.5)
- `AutoTuneResolutionMax` - Maximum resolution (default 1.0)
- `AutoTuneResolutionStep` - Adjustment step size (default 0.05)
- Location: `llperfstats.cpp` in `updateAvatarParams()`, GPU timing in `pipeline.cpp`
- Uses GL_TIME_ELAPSED queries to measure actual GPU frame time
- Compares GPU time vs CPU time to detect GPU bottleneck (GPU > CPU * 0.9)
- Only reduces resolution when GPU-bound; increases back when headroom available
- Integrates with existing AutoTune system (`AutoTuneFPS` enabled by default)

### Shadow Frame Skipping - REMOVED
- Previously attempted `RenderShadowUpdateRate` to skip shadow map rendering
- **Removed because:** Shadow maps become stale when anything moves (camera, objects, sun). Cascade frustums depend on camera position. Even with static camera, moving objects and sun movement cause incorrect shadows. This caused huge shadows appearing in wrong locations.
- Setting and code completely removed

### Shadow Small Object Culling
- `RenderShadowMinVertexCount` - skip small objects in shadow passes
- Location: `lldrawpool.cpp` in `pushUntexturedBatch()`

### Impostor Optimizations
- **Max resolution reduced** from 512 to 128 (16x less VRAM) - `pipeline.cpp:11969`
- **Skip second alpha depth pass** - no re-render for alpha mask - `pipeline.cpp:12019`
- **Increased update intervals** - 64/96/128 frames instead of 32/48/64 - `llvoavatar.cpp:5187`
- **Reduced angle/distance sensitivity** - fewer updates on camera movement - `llvoavatar.cpp:3500,3514`

### Alpha Distance Culling
- Skip small alpha objects beyond 32m (pixelArea < 100)
- Location: `lldrawpoolalpha.cpp:685-692`
- Affects trees, transparent attachments, glass, etc.

### FPS Display Responsiveness Fix
- Status bar FPS was using median over all 200 recorded periods
- Median smoothing hid sudden frame drops (showed 30 FPS while actual was <1 FPS)
- Changed to use 30-period window, matching other performance displays (50 periods)
- Location: `llstatusbar.cpp:621`, `llviewerwindow.cpp:525`

### OpenJPEG Multithreaded Decoding
- Enabled per-decode threading via `opj_codec_set_threads(decoder, 2)`
- OpenJPEG 2.5.3 supports internal multithreading but it was disabled
- Uses 2 threads per decode (conservative since ImageDecode pool has 8 workers)
- Helps large textures decode faster without oversubscribing CPU
- Location: `llimagej2coj.cpp` in `initDecode()` and `decode()`

**Texture decode architecture:**
- `LLImageDecodeThread` has ThreadPool with 8 workers (`llimageworker.cpp:70`)
- Multiple textures decode in parallel (up to 8)
- Each decode now uses 2 internal OpenJPEG threads
- Total: up to 16 threads during heavy texture loading

### Batched Shadow Frustum Culling (REMOVED)
~~Traverse octree once for all 4 shadow cascades instead of 4 times.~~

**Status:** Removed - did not provide performance benefit.

**Why it failed:**
1. Batching requires two-phase approach: setup all cameras first, then render
2. The camera setup for each cascade involves complex light-space matrix calculations
3. Two-phase overhead negated the savings from reduced octree traversal
4. The octree traversal was not the actual bottleneck

**Better alternative:** Reduce `RenderShadowSplits` (0-3) to skip distant cascades entirely. Each cascade skipped saves ~25% of shadow rendering cost.

### GPU Texture Cache (DXT5 Compressed)
Stores textures in DXT5 format for direct GPU upload without CPU decode.

**Settings:**
- `GPUTextureCacheEnabled` - Enable/disable (default: true)
- `GPUTextureCacheSize` - Cache size in MB (default: 2048)

**How it works:**
1. After J2C decode → raw RGBA → compress to DXT5 → write to cache
2. Future loads (TODO): Check GPU cache first → direct upload to GL

**Files:**
- `llgputexturecache.h/cpp` - Cache manager with LRU eviction
- `llimagedxt.cpp` - Added `encodeCompressedDXT5()` using stb_dxt
- `stb_dxt.h` - Public domain DXT compression library
- `lltexturefetch.cpp` - Write to GPU cache after decode

**Cache structure:**
```
cache/gpucache/
├── gpu_cache_index.llsd    # Index with LRU tracking
└── [0-f]/                  # 16 subdirs by UUID first char
    └── {UUID}.dxt          # DXT5 compressed + header
```

**File format (.dxt):**
- 32-byte header: magic, version, format, dimensions, mip count
- DDS data: DXT5 compressed with all mip levels

**Stats (in floater_stats.xml):**
- GPU Cache Hits/Misses
- GPU Cache Size (MB)

**TODO:**
- Add read path: Check GPU cache before J2C cache for instant loading
- Consider BC7 for higher quality (requires modern GPU)

---

## Impostor TODO

### Skip deferred attachments for distant impostors
- Don't allocate normal/specular maps for far impostors
- Requires shader changes to handle missing textures
- Medium effort, medium VRAM savings

### Lower default MaxNonImpostors
- Change from 12 to 6 - more avatars render as impostors
- Trivial change, high impact in crowded scenes

### Skip small attachments during generation
- Don't render tiny attachments when generating impostor
- Medium effort, medium impact

### Pool render targets
- Reuse FBOs instead of one per avatar
- High effort, reduces VRAM churn

---

## CPU to GPU Opportunities

### 1. Particle Updates (HIGH PRIORITY)
**Current:** CPU sequential loop in `llviewerpartsim.cpp:276-469`
- Per-particle aging, wind, velocity, position updates
- Color/scale interpolation
- Trivially parallelizable - ideal for compute shaders

**GPU approach:** Compute shader with particle buffer
- All particles updated in parallel
- Position, velocity, color in GPU buffers
- Only read back for culling decisions

### 2. Frustum Culling - ATTEMPTED, REVERTED
**Current:** CPU octree traversal in `llspatialpartition.cpp`
- AABB vs frustum plane tests inline during traversal
- Sequential tree walk - already fast (5 dot products per group)

**GPU approaches attempted (January 2025):**
1. **v1 (Batched):** Collected groups every frame → 15 FPS slower (octree traversal overhead)
2. **v2 (Rate-limited):** Collected every 30 frames → crashes from stale pointers
3. **v3 (Persistent buffer):** Groups register on creation → no culling happened, still slower

**Why GPU frustum culling doesn't help:**
- The CPU AABB-frustum test is only 5 dot products - trivially fast
- Even with GPU culling, we still traverse the octree (that's where the real cost is)
- GPU dispatch + readback overhead exceeds the savings
- For ~5000 groups, CPU is already fast enough

**Conclusion:** GPU frustum culling adds complexity with no benefit. The octree traversal is the bottleneck, not the frustum test itself.

**Files kept (dormant, for future GPU-driven rendering):**
- `llgpufrustumcull.h/cpp` - Compute shader infrastructure
- `frustumCullC.glsl` - Compute shader (works, just not useful for this)

**Debug setting kept:**
- `RenderSkipFrustumCull` - Skip all frustum culling (useful for testing)

**Future direction:** GPU-driven shadow rendering is more promising because shadows test against 4 cascade frustums, and the shadow pass uses a single depth-only shader.

**Update (January 2026):** Batched shadow frustum culling was attempted but removed - the two-phase approach required for correct shadows added overhead that negated the traversal savings. Better optimization: reduce `RenderShadowSplits` to skip distant cascades.

### 2b. Octree Traversal Throttling - ATTEMPTED, FAILED (January 2026)

**Goal:** Skip expensive `LLSpatialPartition::cull()` and `culler.traverse()` calls on most frames, doing full cull every N frames.

**Approach:**
1. Cache the `LLCullResult` state (groups, drawables, bridges, render maps) after a full cull
2. On skip frames, restore cached state instead of traversing octree
3. Force full cull when camera moves significantly or groups change

**Implementation attempts:**

| Attempt | Description | Result |
|---------|-------------|--------|
| Per-partition cache | Each LLSpatialPartition stores cached groups | Segfault - dangling pointers when groups destroyed |
| Pipeline-level save/restore | Save/restore sCull at pipeline level | "Stale LLDrawInfo's in LLCullResult!" assertion |
| Destructor invalidation | Set sCullDirty=true in group/drawable destructors | Still segfaults even at throttle=1 |
| Always clear sCull | Clear render maps but restore groups | Rendering breaks on skip frames |

**Why it fails fundamentally:**

1. **Dangling pointers everywhere**: LLSpatialGroup, LLDrawable, and LLSpatialBridge objects can be destroyed at any time (region crossing, object deletion, LOD changes). Caching pointers to these objects across frames leads to use-after-free crashes.

2. **Render maps must be fresh**: `sCull->mRenderMap` (indexed draw batches) is populated during `stateSort()`, not during cull. These contain `LLDrawInfo*` pointers that become stale. The viewer asserts if stale DrawInfo objects are detected.

3. **sCull->clear() breaks restoration**: The clear operation must happen every frame to reset render maps, but this also clears the group/drawable lists we want to preserve. Can't selectively clear.

4. **Static destruction order**: Even with destructor hooks to invalidate cache, `sCullDirty` static variable may be accessed after destruction in certain shutdown sequences.

5. **14 partition types per region**: VOLUME, AVATAR, TREE, GRASS, PARTICLE, CLOUD, VOIDWATER, WATER, TERRAIN, BRIDGE, HUD, SKY, WL_SKY, NONE. Each maintains separate state, complicating cache coherence.

**Key finding: Limited benefit even when working**

When the throttle briefly worked at higher values (4-5 frames), performance improvement leveled off. This indicates:
- **Octree traversal is NOT the main CPU bottleneck**
- Real costs are elsewhere: stateSort(), shadow passes, draw call submission
- The ~5000 groups traverse quickly due to spatial coherence

**Conclusion:** Caching cull results across frames is not viable due to object lifetime issues. The render pipeline assumes fresh `sCull` data every frame. Future optimization should focus on:
1. GPU-driven rendering with indirect draw calls
2. Compute shader visibility testing
3. Shadow pass optimization (separate frustums, depth-only rendering)

**Files modified (reverted):**
- `llspatialpartition.h/cpp` - saveGroupState/restoreGroupState methods
- `pipeline.h/cpp` - sCullDirty, sLastCullFrame statics, throttle logic
- `lldrawable.cpp` - destructor invalidation hooks
- `settings.xml` - RenderCullThrottleFrames setting

### 3. LOD Calculation (MEDIUM)
**Current:** Per-object CPU calculation in `llvovolume.cpp:1557-1774`
- Distance calculation, LOD level selection
- Done every frame for every visible object

**GPU approach:** Batch compute
- Upload object positions + sizes
- Compute distances + LOD levels in parallel
- Could combine with frustum culling

### 4. Avatar Skinning (LOWER PRIORITY)
**Current:** Mixed - CPU fallback in `llviewerjointmesh.cpp:456-508`
- GPU vertex shaders exist (`avatarSkinV.glsl`, `objectSkinV.glsl`)
- CPU path used when shader level = 0

**GPU approach:** Already mostly there
- Could force GPU-only path on modern hardware
- Remove CPU skinning fallback

---

## Research Needed

### Temporal Reprojection
Could we cache and reproject the previous frame for static geometry? Challenges:
- Motion vectors needed
- Disocclusion artifacts (newly visible areas)
- Ghosting on moving objects

### Mesh LOD Improvements
- More aggressive LOD at distance
- Shadow-specific LOD (blocked by current architecture - LOD calculated once per frame)

### Texture Streaming Improvements
- Reduce stalls from texture loading
- Better prioritization of visible textures

### Parallel/Async Rendering
- Better multi-threading of scene traversal
- Async GPU command buffer building

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

### Implementation Options

#### Option 1: Simple Frame Time (Like Current AutoTune)
**Effort:** Low (1-2 days)
**Accuracy:** Poor for resolution tuning

Use total frame time without distinguishing CPU/GPU:
```cpp
if (frame_time > target) resolution -= 0.05;
if (frame_time < target * 0.8) resolution += 0.05;
```

| Pros | Cons |
|------|------|
| Simple, reuses existing infrastructure | May reduce resolution when CPU-bound (no benefit) |
| Works within AutoTune framework | Can oscillate if CPU and GPU loads vary |
| No new GL queries needed | Wastes visual quality in CPU-bound scenes |

**Performance impact:** 0ms overhead, but may apply wrong fix 30-50% of the time

---

#### Option 2: Total GPU Frame Timer
**Effort:** Medium (3-5 days)
**Accuracy:** Good

Add `GL_TIME_ELAPSED` query around entire render pass in `LLPipeline::renderGeom()` or `display()`:
```cpp
// Start of frame
glBeginQuery(GL_TIME_ELAPSED, mFrameGPUQuery);

// ... all rendering ...

// End of frame
glEndQuery(GL_TIME_ELAPSED);
// Read previous frame's result (async)
glGetQueryObjectui64v(mPrevFrameQuery, GL_QUERY_RESULT, &gpu_time_ns);
```

| Pros | Cons |
|------|------|
| Accurate GPU-bound detection | 1 frame latency for query results |
| Only adjusts resolution when GPU is bottleneck | Slight GPU overhead (~0.1ms) |
| Can report GPU vs CPU to user | Need to manage query double-buffering |

**Decision logic:**
```cpp
bool gpu_bound = (gpu_frame_time > cpu_frame_time * 0.9);
if (gpu_bound && frame_time > target) resolution -= 0.05;
```

**Performance impact:** ~0.1ms GPU overhead for query, but correct decisions save 2-5ms when applied appropriately

---

#### Option 3: Heuristic - Avatar GPU Ratio
**Effort:** Low (1 day)
**Accuracy:** Moderate

Use existing avatar GPU time as a proxy:
- If avatar GPU time is < 30% of frame time, assume scene/GPU bottleneck
- If avatar GPU time is > 50% of frame time, avatar tuning is more effective

```cpp
float avatar_ratio = avatar_gpu_time / frame_time;
bool likely_scene_gpu_bound = (avatar_ratio < 0.3) && (frame_time > target);
if (likely_scene_gpu_bound) resolution -= 0.05;
```

| Pros | Cons |
|------|------|
| No new GL queries | Inaccurate in avatar-heavy scenes |
| Zero overhead | Doesn't account for shadow/post-FX load |
| Quick to implement | May conflict with avatar tuning |

**Performance impact:** 0ms overhead, correct ~60-70% of the time

---

#### Option 4: Shader Time Aggregation
**Effort:** Medium-High (4-6 days)
**Accuracy:** Very Good

Aggregate existing per-shader `mTimeElapsed` values by category:
```cpp
U64 geometry_gpu_time = 0;
U64 shadow_gpu_time = 0;
U64 postfx_gpu_time = 0;

for (auto& shader : geometry_shaders) geometry_gpu_time += shader.mTimeElapsed;
for (auto& shader : shadow_shaders) shadow_gpu_time += shader.mTimeElapsed;
for (auto& shader : postfx_shaders) postfx_gpu_time += shader.mTimeElapsed;
```

| Pros | Cons |
|------|------|
| Granular - knows WHERE GPU time goes | Requires shader categorization |
| Can tune specific systems (shadows vs geometry) | More complex aggregation logic |
| Already has per-shader timing infrastructure | Timing not always enabled |

**Performance impact:** ~0.2ms if shader timing enabled, but provides detailed breakdown

---

### Recommended Approach

**Phase 1:** Option 2 (Total GPU Frame Timer)
- Best accuracy-to-effort ratio
- Single query gives clean GPU vs CPU determination
- Integrate with existing AutoTune as new tunable

**Phase 2:** Option 4 (Shader Aggregation) for advanced users
- Add GPU breakdown to performance floater
- Allow per-category tuning (e.g., reduce shadows before resolution)

### Tuning Parameters (Proposed)

```
AutoTuneResolution = true          // Enable resolution auto-tuning
AutoTuneResolutionMin = 0.5        // Never go below 50%
AutoTuneResolutionMax = 1.0        // Never exceed 100%
AutoTuneResolutionStep = 0.05      // Adjust by 5% per step
AutoTuneResolutionPriority = 1     // 0=last resort, 1=before draw distance, 2=first
```

### Expected Performance Gains

| Scenario | Current | With Auto Resolution |
|----------|---------|---------------------|
| GPU-bound, crowded scene | 20 FPS | 35-45 FPS (at 0.6-0.7 res) |
| CPU-bound scene | 30 FPS | 30 FPS (no change, correct) |
| Mixed load | 25 FPS | 30-35 FPS (partial resolution reduction) |

Resolution scaling at 0.7x reduces GPU pixel work by ~50% with minimal visual impact when FSR EASU + CAS sharpening is enabled.
