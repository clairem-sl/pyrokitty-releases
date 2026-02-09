# Shadow System Architecture

## Overview

The shadow system uses cascaded shadow mapping for sun shadows and additional passes for spot/projector lights. Shadow rendering can take significant time as it re-renders scene geometry multiple times.

## Key Files

- `indra/newview/pipeline.cpp` - Shadow generation and rendering (lines 10400-11600)
- `indra/newview/pipeline.h` - Shadow render targets, cameras, mMainShadow* state (lines 728, 749, 800-805)
- `indra/newview/lldrawpoolavatar.cpp` - Avatar shadow passes
- `indra/newview/lldrawpooltree.cpp` - Tree shadow rendering
- `indra/newview/lldrawpoolterrain.cpp` - Terrain shadow rendering
- `indra/newview/app_settings/shaders/class1/deferred/shadow*.glsl` - Shadow shaders

## Shadow Pass Count

The viewer performs up to **6 shadow passes** per frame:

| Pass Type | Count | Purpose |
|-----------|-------|---------|
| Sun Shadow (Cascaded) | 4 | Near to far distance splits |
| Spot Light Shadow | 2 | Dynamic projector lights |

Each pass re-renders scene geometry to a shadow map.

## Shadow Map Storage

```cpp
// pipeline.h
LLRenderTarget shadow[4];      // 4 Sun shadow maps (cascaded)
LLRenderTarget mSpotShadow[2]; // 2 Spot light shadow maps
LLCamera mShadowCamera[8];     // Shadow view cameras
glm::mat4 mSunShadowMatrix[6]; // Transform matrices
```

## RenderShadowDetail Setting

Controls which shadow features are enabled:

| Value | Effect | Passes |
|-------|--------|--------|
| 0 | No shadows | 0 |
| 1 | Sun shadows only, depth-only maps | 4 |
| 2 | Sun + Spot shadows, depth-only maps | 6 |
| 3 | Sun + Spot with VSM (soft edges via color) | 6 |

### Code References

```cpp
// pipeline.cpp:10848 - Skip all shadow generation
if (!sRenderDeferred || RenderShadowDetail <= 0)
    return;

// pipeline.cpp:11450 - Enable spot light shadows
bool gen_shadow = RenderShadowDetail > 1;

// pipeline.cpp:10488 - VSM uses color writes for soft shadows
if (shadow_detail <= 2)
    gGL.setColorMask(false, false);  // Depth only, faster
```

## RenderShadowSplits Setting

Controls number of cascade splits for sun shadows (0-3):

| Value | Cascades | Effect |
|-------|----------|--------|
| 0 | 1 | Single shadow map, fastest |
| 1 | 2 | Near + far split |
| 2 | 3 | Near + mid + far |
| 3 | 4 | Full quality (default) |

Reducing splits nearly halves shadow render time but reduces shadow precision at distance.

## All Shadow Settings

### Performance Settings

| Setting | Type | Default | Effect |
|---------|------|---------|--------|
| `RenderShadowDetail` | S32 | 2 | Feature level (0-3) |
| `RenderShadowSplits` | S32 | 3 | Cascade count (0-3) |
| `RenderShadowResolutionScale` | F32 | 1.0 | Shadow map size multiplier |
| `RenderShadowMinVertexCount` | U32 | 64 | Skip objects with fewer vertices |
| `RenderShadowUpdateRate` | U32 | 1 | Base frame skip rate (1=every frame, 2=every other) |
| `RenderShadowSplitRateScale` | F32 | 2.0 | Geometric growth per cascade (rate = base * scale^j) |
| `RenderShadowBlurSamples` | U32 | 4 | Blur samples (actual = value*2-1) |

### Quality Settings

| Setting | Type | Default | Effect |
|---------|------|---------|--------|
| `RenderShadowBlurSize` | F32 | 1.4 | Shadow edge softness |
| `RenderShadowGaussian` | Vec3 | 3,2,0 | Gaussian blur coefficients |
| `RenderShadowNoise` | F32 | -0.0001 | Dithering amount |

### Shadow Acne Prevention

| Setting | Type | Default |
|---------|------|---------|
| `RenderShadowBias` | F32 | -0.002 |
| `RenderShadowOffset` | F32 | 0.01 |
| `RenderShadowBiasError` | F32 | -0.007 |
| `RenderShadowOffsetError` | F32 | 0.0 |
| `RenderSpotShadowBias` | F32 | -0.0002 |
| `RenderSpotShadowOffset` | F32 | 0.04 |

### Cascade Distribution

| Setting | Type | Default | Effect |
|---------|------|---------|--------|
| `RenderShadowSplitExponent` | Vec3 | 3,0.5,0 | Controls cascade split distribution |
| `RenderShadowProjOffset` | F32 | 2.0 | Virtual origin scale |
| `RenderShadowProjExponent` | F32 | 0.5 | Ortho/perspective transition |
| `RenderShadowErrorCutoff` | F32 | 5.0 | Ortho projection threshold |
| `RenderShadowFOVCutoff` | F32 | 0.8 | FOV-based projection threshold |
| `RenderShadowSlopeThreshold` | F32 | 0.0 | Slope-based culling |

## Shadow Rendering Optimizations

### Current Optimizations

1. **No textures** - Shadow passes render with `texture = false` for most geometry
2. **Simple shaders** - Shadow shaders only output depth (or depth+variance for VSM)
3. **Frustum culling** - Each shadow camera culls to its own frustum
4. **Reflection probe optimization** - Reduces splits from 4 to 2 during cube baking

```cpp
// pipeline.cpp:11062-11066
if (gCubeSnapshot) {
    // Reduce shadow splits for reflection probes
    mSunClipPlanes.mV[1] = mSunClipPlanes.mV[2];
}
```

### NOT Currently Optimized

1. **No shadow-specific LOD** - Objects use same LOD as main view (see notes below)
2. **Occlusion culling disabled** - `sUseOcclusion = 0` during shadow passes

**Note:** Frame skipping is available via `RenderShadowUpdateRate` - see below.

## RenderShadowMinVertexCount Setting

Skips small objects during shadow rendering based on vertex count.

| Value | Effect |
|-------|--------|
| 0 | Disabled - all objects cast shadows |
| 64 | Skip batches with < 64 vertices (default) |
| 256 | Skip batches with < 256 vertices (aggressive) |

### Implementation

Located in `lldrawpool.cpp` in `pushUntexturedBatch()`:

```cpp
// <FS:Pyrokitty> Skip small batches during shadow rendering
if (LLPipeline::sShadowRender && LLPipeline::RenderShadowMinVertexCount > 0)
{
    U32 vertex_count = params.mEnd - params.mStart + 1;
    if (vertex_count < LLPipeline::RenderShadowMinVertexCount)
    {
        return;
    }
}
// </FS:Pyrokitty>
```

This skips rendering small objects in shadow passes. Small objects contribute minimally to shadows but still consume draw calls.

## RenderShadowUpdateRate and RenderShadowSplitRateScale

Controls how often shadow maps are regenerated, with per-cascade granularity. Near shadows update frequently while far shadows can update much less often without visible quality loss.

### Settings

| Setting | Type | Default | Effect |
|---------|------|---------|--------|
| `RenderShadowUpdateRate` | U32 | 1 | Base frame skip rate |
| `RenderShadowSplitRateScale` | F32 | 2.0 | Geometric growth factor per cascade |

**Effective rate for cascade j** = `base_rate * scale^j`

### Examples

| Base | Scale | Split 0 (near) | Split 1 | Split 2 | Split 3 (far) |
|------|-------|-----------------|---------|---------|----------------|
| 1 | 1.0 | every frame | every frame | every frame | every frame |
| 1 | 2.0 | every frame | every 2nd | every 4th | every 8th |
| 1 | 4.0 | every frame | every 4th | every 16th | every 64th |
| 2 | 2.0 | every 2nd | every 4th | every 8th | every 16th |

Set `RenderShadowSplitRateScale = 1.0` for uniform behavior (all cascades same rate).

### Implementation

Located in `pipeline.cpp` in `generateSunShadow()`.

**Per-split rate computation** (before cascade loop):
```cpp
static LLCachedControl<F32> shadow_split_rate_scale(gSavedSettings, "RenderShadowSplitRateScale", 2.0f);
static LLCachedControl<U32> shadow_update_rate(gSavedSettings, "RenderShadowUpdateRate", 1);
U32 split_rates[4];
{
    F32 scale = llmax(1.0f, (F32)shadow_split_rate_scale);
    U32 base = llmax(1u, (U32)shadow_update_rate);
    F32 rate_f = (F32)base;
    for (S32 i = 0; i < 4; i++)
    {
        split_rates[i] = llmax(1u, (U32)rate_f);
        rate_f *= scale;
    }
}
```

**Per-split skip** (inside cascade loop):
```cpp
if (!gCubeSnapshot && split_rates[j] > 1 && (gFrameCount % split_rates[j]) != 0)
{
    // Reuse previous shadow map, just update view-to-shadow matrix
    mSunShadowMatrix[j] = trans * mMainShadowProjection[j] * mMainShadowModelview[j] * inv_view;
    continue;
}
```

**Per-split save** (after `mRT->shadow[j].flush()` inside loop):
```cpp
if (!gCubeSnapshot)
{
    mMainShadowModelview[j] = mShadowModelview[j];
    mMainShadowProjection[j] = mShadowProjection[j];
}
```

**Spot light save** (end of function, indices 4-5 only):
```cpp
if (!gCubeSnapshot)
{
    for (U32 j = 4; j < 6; j++)
    {
        mMainShadowModelview[j] = mShadowModelview[j];
        mMainShadowProjection[j] = mShadowProjection[j];
    }
}
```

**Members in `pipeline.h`:**
```cpp
glm::mat4  mMainShadowModelview[6];
glm::mat4  mMainShadowProjection[6];
```

### Key design decisions

- **Clip planes always fresh** — by removing the early return, `mSunClipPlanes` is computed every frame. No saved copy needed.
- **Spot lights always render** — indices 4-5 are cheap (only 2 passes), always local, and not clobbered by probes.
- **Skip at loop top** — skips all per-split work (frustum, point cloud, projection, render) for maximum perf gain.
- **`gCubeSnapshot` guard** — probes only render 2 cascades and shouldn't use skip logic.

### Why dedicated mMainShadow* arrays are needed

The critical discovery: **reflection probe rendering overwrites pipeline shadow state**.

**Frame order:**
1. `display()` — generates shadows for main camera, renders scene
2. `mReflectionMapManager.update()` — runs AFTER display, bakes reflection probes

During step 2, each reflection probe calls `generateSunShadow()` again with a different camera (the probe's cube face camera). This overwrites:
- `mShadowModelview[6]` — now contains probe camera values
- `mShadowProjection[6]` — now contains probe projection values

On the next frame's skip, if we read from `mShadowModelview`/`mShadowProjection`, we get the **probe's** shadow state, not the main camera's. This causes:
- Far shadows flickering (wrong projection matrices)
- Avatar shadows disappearing (wrong projection matrices)

**Solution:** The `!gCubeSnapshot` guard ensures we only save state from the main camera render, not from probe renders. On skip frames, we read from `mMainShadow*` arrays which always contain the correct main camera state.

### Why shadow matrices must be updated every frame

- `mSunShadowMatrix` transforms from **current view space** to shadow texture space
- It contains `inv_view` (inverse of current camera matrix) which changes when camera moves
- Shadow map textures are in "sun space" and don't need updating
- But the matrices mapping from camera view to those textures must stay current

Shadow maps persist in render targets (`shadow[4]` and `mSpotShadow[2]`), so skipping shadow generation simply reuses the previous frame's maps while still updating the view-to-shadow transforms.

### Previous failed attempt

An earlier version of shadow frame skipping was implemented and removed because shadows appeared in wrong locations. The root cause was reading from `mShadowModelview`/`mShadowProjection` directly, which were being clobbered by reflection probe rendering between frames. The fix (dedicated `mMainShadow*` arrays + `!gCubeSnapshot` guard) resolved this.

### Trade-offs

- **Pro:** Significant performance improvement, especially at high RenderShadowDetail
- **Con:** Moving objects/avatars have slightly delayed shadows
- **Con:** Fast camera movement may show shadow lag

Values of 2-3 are generally imperceptible in normal gameplay. Higher values may cause noticeable shadow delay.

## Shadow Shaders

Located in `indra/newview/app_settings/shaders/class1/deferred/`:

### Vertex Shaders
- `shadowV.glsl` - Basic vertex transform
- `shadowSkinnedV.glsl` - Rigged/avatar geometry
- `shadowAlphaMaskV.glsl` - Alpha-tested geometry

### Fragment Shaders
- `shadowF.glsl` - Outputs white (depth written by hardware)
- `shadowAlphaMaskF.glsl` - Discards transparent pixels

### Sampling
- `shadowUtil.glsl` - PCF filtering, cascade blending

## Draw Pool Shadow Passes

Different geometry types have different shadow pass counts:

| Pool | Shadow Passes | Notes |
|------|---------------|-------|
| Avatar | 3 | Opaque, alpha blend, alpha mask |
| Tree | 1 | Alpha-masked foliage |
| Terrain | 1 | Ground geometry |
| Default | 0 | Uses generic shadow pass |

### Avatar Shadow Passes

```cpp
// lldrawpoolavatar.cpp:68-71
enum {
    SHADOW_PASS_AVATAR_OPAQUE,
    SHADOW_PASS_AVATAR_ALPHA_BLEND,
    SHADOW_PASS_AVATAR_ALPHA_MASK,
    NUM_SHADOW_PASSES = 3
};
```

## Performance Tuning

### Quick Settings for Better Performance

```
RenderShadowDetail = 1           // Sun shadows only (no spot)
RenderShadowSplits = 1           // 2 cascades instead of 4
RenderShadowResolutionScale = 0.5  // Half resolution
RenderShadowMinVertexCount = 256 // Skip small objects
RenderShadowUpdateRate = 1       // Base rate (1=every frame)
RenderShadowSplitRateScale = 2.0 // Near every frame, far every 8th
RenderShadowBlurSamples = 2      // Fewer blur samples
```

## Shadow Performance Tuning

The most effective way to improve shadow performance is reducing `RenderShadowSplits`:
- **3** (default): All 4 cascades, full distance shadows
- **2**: 3 cascades, skip farthest ~25% CPU savings
- **1**: 2 cascades, near/mid shadows only ~50% CPU savings
- **0**: 1 cascade, near shadows only ~75% CPU savings

Each cascade requires full camera setup, octree culling, and shadow map rendering. Reducing cascades eliminates all that work for skipped cascades.

### Abandoned: Batched Shadow Frustum Culling

An attempt was made to optimize shadow culling by traversing the octree once for all 4 cascades instead of 4 separate times. While this reduced traversal overhead, it required a two-phase approach (setup all cameras, then render all cascades) that added overhead negating the savings. The camera setup for each cascade involves complex light-space matrix calculations that cannot be simplified.

**Lesson learned:** The octree traversal is not the bottleneck for shadow rendering. The camera setup and actual shadow map rendering dominate the cost. Reducing `RenderShadowSplits` is a more effective optimization.

### RenderShadowMinSize Setting

Skips small objects during shadow rendering based on object scale (meters).

| Value | Effect |
|-------|--------|
| 0 | Disabled - all objects cast shadows |
| 0.25 | Skip objects smaller than 0.25m (default) |
| 0.5 | Skip objects smaller than 0.5m (aggressive) |

**Implementation:**
- In `llvovolume.cpp`: Sets `mSkipShadow` flag on `LLDrawInfo` based on drawable scale
- In `lldrawpool.cpp` and `pipeline.cpp`: Checks `mSkipShadow` and skips rendering

```cpp
// llvovolume.cpp - When creating DrawInfo
static LLCachedControl<F32> RenderShadowMinSize(gSavedSettings, "RenderShadowMinSize", 0.25f);
if (RenderShadowMinSize > 0.f && drawable)
{
    const LLVector3& scale = drawable->getScale();
    F32 maxScale = llmax(scale.mV[VX], scale.mV[VY], scale.mV[VZ]);
    draw_info->mSkipShadow = (maxScale < RenderShadowMinSize);
}
```

### Fixed Alpha Cutoff Optimization

Shadow passes now use a fixed 0.5 alpha cutoff instead of per-object `mAlphaMaskCutoff` values.

**Problem:** `setMinimumAlpha()` calls `gGL.flush()` internally, causing a CPU-intensive draw call submission per object. This breaks batching.

**Solution:** Comment out per-object `setMinimumAlpha()` calls in shadow loops and use fixed 0.5 cutoff set once per shader bind.

**Files modified:**
- `lldrawpool.cpp`: `pushMaskBatches()` and `pushRiggedMaskBatches()` - removed per-object setMinimumAlpha
- `pipeline.cpp`: `renderAlphaObjects()` - setMinimumAlpha only called on shader change

**Visual impact:** Minimal - 0.5 is the default cutoff for most objects. Some alpha-masked textures with non-default cutoffs may have slightly different shadow edges.

### Shader Bind Optimization in renderAlphaObjects

The `renderAlphaObjects()` function now tracks which shader was last bound and only calls `bind()` when switching between GLTF and non-GLTF shaders.

**Problem:** `LLGLSLShader::bind()` always calls `gGL.flush()` even when the shader is already bound (line 1055 in `llglslshader.cpp`). The original code called `bind()` for every draw call.

**Solution:** Track last shader type and only bind when switching:
```cpp
enum ShaderType { SHADER_NONE, SHADER_GLTF, SHADER_MASK };
ShaderType lastShader = SHADER_NONE;

// In loop:
if (pparams->mGLTFMaterial)
{
    if (lastShader != SHADER_GLTF)
    {
        gDeferredShadowGLTFAlphaBlendProgram.bind(rigged);
        // Set uniforms only once per shader switch
        LLGLSLShader::sCurBoundShaderPtr->uniform1i(LLShaderMgr::SUN_UP_FACTOR, sun_up);
        LLGLSLShader::sCurBoundShaderPtr->uniform1f(LLShaderMgr::DEFERRED_SHADOW_TARGET_WIDTH, (float)target_width);
        LLGLSLShader::sCurBoundShaderPtr->setMinimumAlpha(ALPHA_BLEND_CUTOFF);
        lastShader = SHADER_GLTF;
    }
    LLRenderPass::pushGLTFBatch(*pparams);
}
```

This significantly reduces the number of `flush()` calls when draw calls are grouped by shader type.

### Skip postSort Work During Shadow Passes

Shadow passes call `stateSort()` which internally calls `postSort()`. Many operations in these functions are only needed for the main view, not shadows:

**Skipped during shadow passes (`sShadowRender == true`):**
1. Geometry rebuilding (`rebuildGeom()`, `rebuildMesh()`) - Main view handles this
2. Alpha group collection and distance updates - Shadows don't need alpha sorting
3. Priority group rebuilding - Not needed for depth-only shadow maps
4. Delayed mesh updates (`mMeshDirtyGroup`) - Main view handles this

**Implementation:**
Added `!sShadowRender` checks in `pipeline.cpp`:
- `postSort()` line 3727: Skip drawable geometry rebuild
- `postSort()` line 3770: Skip inline rebuildGeom for dirty groups
- `postSort()` line 3795: Skip alpha group collection
- `postSort()` line 3849: Skip delayed mesh rebuilding
- `stateSort()` line 3300: Skip rebuildMesh in visibility loop

**Impact:** Reduces CPU time spent in `postSort` during shadow passes (previously ~6% of frame time with 4 cascades).

### Per-Cascade LOD Culling (ATTEMPTED - REVERTED)

Attempted to skip high-LOD objects in distant shadow cascades. Theory: objects far from camera (high LOD value) don't contribute visible shadows in distant cascades.

**Why it was reverted:**
- Too aggressive at hiding shadows, causing noticeable visual artifacts
- The overhead of checking LOD per-object still traverses all draw calls
- Not as effective as `RenderShadowSplits` which eliminates entire cascades

**Better alternative:** Use `RenderShadowSplits` (0-3) to skip distant cascades entirely. Each cascade skipped saves ~25% of shadow work without visual artifacts from selective culling.

### Potential Future Optimizations

1. **Reduced avatar passes** - Simplify from 3 passes to 1-2
