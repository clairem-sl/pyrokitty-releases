# Shadow System Architecture

## Overview

The shadow system uses cascaded shadow mapping for sun shadows and additional passes for spot/projector lights. Shadow rendering can take significant time as it re-renders scene geometry multiple times.

## Key Files

- `indra/newview/pipeline.cpp` - Shadow generation and rendering (lines 10400-11600)
- `indra/newview/pipeline.h` - Shadow render targets and cameras (lines 728, 749, 800-805)
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
| `RenderShadowUpdateRate` | U32 | 1 | Frame skip rate (1=every frame, 2=every other) |
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

## RenderShadowUpdateRate Setting

Controls how often shadow maps are regenerated. Instead of rendering shadows every frame, this setting allows reusing shadow maps from previous frames.

| Value | Effect |
|-------|--------|
| 1 | Every frame (default) |
| 2 | Every other frame (50% shadow GPU cost) |
| 3 | Every 3rd frame (33% shadow GPU cost) |
| 4 | Every 4th frame (25% shadow GPU cost) |

### Implementation

Located in `pipeline.cpp` in `generateSunShadow()`:

```cpp
// <FS:Pyrokitty> Skip shadow map rendering based on RenderShadowUpdateRate
// When skipping, we still need to update the shadow matrices because they depend on
// the current camera position (they transform from view space to shadow texture space).
if (RenderShadowUpdateRate > 1 && (gFrameCount % RenderShadowUpdateRate) != 0)
{
    // Update shadow matrices with current camera's inverse view matrix
    glm::mat4 inv_view = glm::inverse(get_current_modelview());
    glm::mat4 trans(...); // [-1,1] to [0,1] conversion

    for (U32 j = 0; j < 4; j++)
        mSunShadowMatrix[j] = trans * mShadowProjection[j] * mShadowModelview[j] * inv_view;

    return;  // Reuse existing shadow map textures
}
// </FS:Pyrokitty>
```

**Why shadow matrices must be updated every frame:**
- `mSunShadowMatrix` transforms from **current view space** to shadow texture space
- It contains `inv_view` (inverse of current camera matrix) which changes when camera moves
- Shadow map textures are in "sun space" and don't need updating
- But the matrices mapping from camera view to those textures must stay current

Shadow maps persist in render targets (`shadow[4]` and `mSpotShadow[2]`), so skipping shadow generation simply reuses the previous frame's maps while still updating the view-to-shadow transforms.

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
RenderShadowUpdateRate = 2       // Update every other frame
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

### Potential Future Optimizations

1. **Per-cascade LOD** - Use progressively lower LOD for distant cascades
2. **Reduced avatar passes** - Simplify from 3 passes to 1-2
