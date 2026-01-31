# CPU vs GPU Bottlenecks in Rendering

## Overview

This document explains why certain rendering operations (shadows, scene traversal) consume significant CPU resources despite the GPU being underutilized, and what architectural changes would be needed to address this.

## Why Shadows Are CPU-Heavy

### 1. Scene Traversal Per Cascade (4-6x)

Each shadow cascade requires a complete scene traversal:

```
Main render:     traverse octree → frustum cull → build draw list
Shadow pass 0:   traverse octree → frustum cull → build draw list  (near)
Shadow pass 1:   traverse octree → frustum cull → build draw list  (mid)
Shadow pass 2:   traverse octree → frustum cull → build draw list  (far)
Shadow pass 3:   traverse octree → frustum cull → build draw list  (very far)
Spot light 0:    traverse octree → frustum cull → build draw list
Spot light 1:    traverse octree → frustum cull → build draw list
```

The actual GPU rendering of shadow maps is cheap (depth-only, no textures). The cost is **CPU walking the octree 6 times** with different frustums.

### 2. Draw Call Submission

Each visible object in each shadow pass requires:
- CPU gathers vertex buffer, index buffer, transforms
- CPU calls `glDrawElements()` or similar
- Driver validates and queues the command

With 1000 objects × 4 shadow passes = 4000 draw calls, all sequentially submitted from one thread.

### 3. Single-Threaded GL Context

OpenGL has a fundamental limitation: **one GL context per thread**. All draw calls must be submitted from the main render thread. Even if you had 8 cores, only one can talk to GL.

```
Thread 1 (render): glBindBuffer → glDrawElements → glBindBuffer → glDrawElements...
Thread 2-8:        (idle, can't help with GL calls)
```

## Why We Can't "Just Use GPU"

### The GPU IS Doing the Work... Eventually

The GPU renders shadow maps extremely fast. The bottleneck is:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    CPU      │ ──► │   Driver    │ ──► │    GPU      │
│  (slow)     │     │  (queues)   │     │  (fast)     │
└─────────────┘     └─────────────┘     └─────────────┘
   Traversal          Command            Actual
   Draw calls         buffer             rendering
   ~5-10ms            ~1ms               ~1ms
```

### What Would Fix It: GPU-Driven Rendering

Modern engines (UE5, Unity DOTS) solve this with **indirect draw calls**:

```cpp
// Traditional (CPU submits each draw)
for (object in visible_objects) {
    glBindBuffer(object.vbo);
    glDrawElements(...);  // CPU → GPU round trip
}

// GPU-Driven (GPU decides what to draw)
glBindBuffer(ALL_OBJECTS_VBO);
glMultiDrawElementsIndirect(GL_TRIANGLES, GL_UNSIGNED_INT,
                            indirectBuffer,  // GPU fills this
                            objectCount, 0);
// ONE call draws everything
```

With GPU-driven rendering:
1. Compute shader tests all AABBs against shadow frustum
2. Compute shader writes visible object IDs to indirect buffer
3. Single `glMultiDrawIndirect` renders everything
4. CPU does almost nothing

### Why Firestorm Doesn't Have This

| Requirement | Status |
|-------------|--------|
| OpenGL 4.3+ compute shaders | ✅ Available |
| `glMultiDrawElementsIndirect` | ✅ Available |
| Bindless textures | ⚠️ Optional |
| Unified vertex buffer | ❌ Objects have separate VBOs |
| Indirect buffer management | ❌ Not implemented |

The viewer was designed ~15 years ago when GPU-driven rendering didn't exist. Each object has its own vertex buffer, materials are set per-object, etc. Retrofitting would be a massive undertaking.

## Quick Wins Without GPU-Driven Rendering

### 1. Parallel CPU Traversal
Walk octree on multiple threads, merge draw lists. Requires careful synchronization around the final draw list.

### 2. Cached Shadow Draw Lists
If nothing moved, reuse last frame's list. The `RenderShadowUpdateRate` approach attempted this but had issues with stale shadow matrices when the camera moved.

### 3. Coarser Shadow LOD
Use lower LOD meshes for shadow passes. Not currently implemented - LOD is calculated once per frame for all passes.

### 4. Fewer Cascades
`RenderShadowSplits = 1` cuts shadow passes nearly in half (2 cascades instead of 4).

### 5. GPU Frustum Culling
The compute shader frustum culling prototype (`llgpufrustumcull.cpp`) could be extended to shadow frustums, reducing what CPU needs to traverse.

## The Path Forward

### Short Term (Settings Tuning)
- Reduce `RenderShadowSplits` from 3 to 1
- Reduce `RenderShadowDetail` from 2 to 1 (sun only)
- Lower `MaxNonImpostors` to reduce avatar shadow passes

### Medium Term (Code Changes)
- GPU frustum culling for main view and shadow passes
- Parallel octree traversal with thread-safe draw list building
- Shadow-specific LOD (use lower detail for shadow casters)

### Long Term (Architecture)
- Unified vertex buffer (all geometry in one large VBO)
- GPU-driven rendering with indirect draw calls
- Compute shader visibility culling writing to indirect buffers

The fundamental fix is GPU-driven rendering, but that's effectively an engine rewrite. The practical path is incrementally reducing how much work the CPU does per frame through the short and medium term improvements.

## Related Files

| File | Purpose |
|------|---------|
| `pipeline.cpp:10400-11600` | Shadow generation |
| `llspatialpartition.cpp:1447` | Scene traversal/culling |
| `llvieweroctree.cpp` | Octree structure and traversal |
| `llgpufrustumcull.cpp` | GPU compute frustum culling prototype |

## References

- [GPU-Driven Rendering Pipelines](https://advances.realtimerendering.com/s2015/aaltonenhaar_siggraph2015_combined_final_footer_220dpi.pdf) - Wihlidal/Ubisoft, SIGGRAPH 2015
- [Rendering of Call of Duty: Infinite Warfare](https://research.activision.com/publications/archives/rendering-of-call-of-dutyinfinite-warfare) -�ctivision, 2017
