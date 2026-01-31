# GPU Frustum Culling Evolution

## Current Implementation: Persistent Buffer (v3)

The GPU frustum culling now uses a **persistent buffer approach** where groups register themselves once at creation, eliminating per-frame octree traversal entirely.

### How It Works

```
LLSpatialGroup Constructor
    │
    ▼
registerGroup() → Allocates slot in persistent GPU buffer
    │
    ▼
Group bounds change (rebound())
    │
    ▼
markGroupDirty() → Only this group uploaded to GPU
    │
    ▼
Each Frame:
    setFrustum() + dispatch() → GPU tests ALL groups in parallel
    │
    ▼
LLOctreeCull::frustumCheck()
    │
    ▼
getGroupVisibility() → Returns precomputed result (O(1) lookup)
    │
    ▼
LLSpatialGroup Destructor
    │
    ▼
unregisterGroup() → Frees slot for reuse
```

### Key Files

| File | Changes |
|------|---------|
| `llgpufrustumcull.h/cpp` | Persistent buffer singleton with slot allocation |
| `llspatialpartition.cpp:616` | Constructor calls `registerGroup()` |
| `llspatialpartition.cpp:138` | Destructor calls `unregisterGroup()` |
| `llspatialpartition.cpp:854` | `rebound()` calls `markGroupDirty()` |
| `llspatialpartition.cpp:1094` | `frustumCheck()` uses `getGroupVisibility()` |
| `pipeline.cpp:2700` | `setFrustum()` + `dispatch()` once per frame |

### API

```cpp
class LLGPUFrustumCull
{
public:
    // Called from LLSpatialGroup constructor - assigns slot in GPU buffer
    U32 registerGroup(LLSpatialGroup* group);

    // Called from LLSpatialGroup destructor - frees slot
    void unregisterGroup(LLSpatialGroup* group);

    // Called when bounds change - marks for upload
    void markGroupDirty(LLSpatialGroup* group);

    // Called once per frame
    void setFrustum(LLCamera& camera);
    void dispatch();

    // Called from frustumCheck() to get result
    S32 getGroupVisibility(LLSpatialGroup* group) const;
    // Returns: 0=culled, 1=partial, 2=fully inside, -1=not registered
};
```

### Benefits Over Batched Approach

| Aspect | Batched (v2) | Persistent Buffer (v3) |
|--------|--------------|------------------------|
| Per-frame octree traversal | Yes (to collect groups) | No |
| Upload frequency | All groups every frame | Only dirty groups |
| Group lookup | Hash map O(1) with overhead | Array index O(1) direct |
| Stale pointer risk | Yes (groups deleted between collections) | No (unregister on delete) |

### Debug Setting

```
RenderGPUFrustumCull = TRUE/FALSE (default: FALSE)
```

---

# Historical: Batched GPU Frustum Culling (v2)

The following documents the previous batched approach and lessons learned.

## Problem

The original GPU frustum culling implementation processed each spatial partition separately:
- `LLSpatialPartition::cull()` is called per-partition
- Each call uploads AABBs, dispatches compute shader, reads back results
- Most partitions have < 100 groups, falling back to CPU
- GPU overhead (upload/dispatch/readback) per partition negates benefits

**Result:** No measurable CPU savings despite working GPU code.

## Solution: Single Batched Dispatch

Move GPU frustum culling to a higher level and batch ALL groups from ALL partitions into a single GPU dispatch per frame.

### Performance Target
- Current: ~2000-5000 groups across all partitions, tested individually
- Goal: Single GPU dispatch testing all groups in ~0.1ms
- Expected CPU savings: 1-2ms per frame (frustum testing portion)

## Architecture Changes

### 1. New Frame Flow

```
Frame Start
    │
    ▼
┌─────────────────────────────────────┐
│  GPU Cull Collection Phase          │
│  (LLPipeline::collectForGPUCull)    │
│                                     │
│  For each SpatialPartition:         │
│    Traverse octree                  │
│    Add groups to global buffer      │
│    Record partition + group mapping │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  GPU Cull Dispatch                  │
│  (LLGPUFrustumCull::dispatch)       │
│                                     │
│  Single compute shader dispatch     │
│  for ALL collected groups           │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Per-Partition Cull (modified)      │
│  (LLSpatialPartition::cull)         │
│                                     │
│  Look up pre-computed GPU results   │
│  Skip CPU frustum test              │
│  Still do occlusion queries         │
└─────────────────────────────────────┘
    │
    ▼
Frame Render
```

### 2. Data Structures

```cpp
// In LLGPUFrustumCull - expanded to track source
struct GroupEntry
{
    LLVector4a center;
    LLVector4a extent;
    LLSpatialGroup* group;      // Pointer back to source group
    U32 partitionIndex;         // Which partition this came from
};

// Results indexed by group pointer for O(1) lookup
std::unordered_map<LLSpatialGroup*, U32> mVisibilityResults;
```

### 3. Modified Classes

#### LLGPUFrustumCull (expanded role)
```cpp
class LLGPUFrustumCull
{
public:
    // Called once at start of frame, before any cull() calls
    void beginFrameCollection();

    // Called by pipeline to add groups from all partitions
    void addGroupsFromPartition(LLSpatialPartition* partition);

    // Called once after collection, before cull() calls
    void dispatchAll();

    // Called by cull() to get pre-computed result
    U32 getGroupVisibility(LLSpatialGroup* group) const;

    // Called at end of frame
    void endFrame();

private:
    std::vector<GroupEntry> mAllGroups;
    std::unordered_map<LLSpatialGroup*, U32> mResults;
    bool mCollectionPhase;
    bool mResultsValid;
};
```

#### LLPipeline (orchestration)
```cpp
// In LLPipeline::updateCull() or similar
void LLPipeline::updateCull(LLCamera& camera)
{
    // Phase 1: Collect all groups for GPU culling
    if (LLGPUFrustumCull::instance().isEnabled())
    {
        LLGPUFrustumCull::instance().beginFrameCollection();
        LLGPUFrustumCull::instance().setFrustum(camera);

        for (auto& partition : mPartitions)
        {
            LLGPUFrustumCull::instance().addGroupsFromPartition(partition);
        }

        LLGPUFrustumCull::instance().dispatchAll();
    }

    // Phase 2: Per-partition cull (now uses pre-computed results)
    for (auto& partition : mPartitions)
    {
        partition->cull(camera);
    }

    if (LLGPUFrustumCull::instance().isEnabled())
    {
        LLGPUFrustumCull::instance().endFrame();
    }
}
```

#### LLSpatialPartition::cull() (modified)
```cpp
S32 LLSpatialPartition::cull(LLCamera& camera)
{
    LLGPUFrustumCull& gpuCull = LLGPUFrustumCull::instance();

    if (gpuCull.isEnabled() && gpuCull.hasResults())
    {
        // Use pre-computed GPU results
        LLOctreeGPUResultApplier applier(&camera, gpuCull);
        applier.traverse(mOctree);
        return 0;
    }

    // Fallback to CPU path
    // ... existing CPU culling code ...
}
```

### 4. GPU Buffer Layout

```
AABB Buffer (all partitions combined):
┌────────────────────────────────────────────────┐
│ Partition 0 groups: [center,extent] pairs      │
├────────────────────────────────────────────────┤
│ Partition 1 groups: [center,extent] pairs      │
├────────────────────────────────────────────────┤
│ ...                                            │
├────────────────────────────────────────────────┤
│ Partition N groups: [center,extent] pairs      │
└────────────────────────────────────────────────┘

Visibility Buffer (same order):
┌────────────────────────────────────────────────┐
│ uint visibility[totalGroupCount]               │
└────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Refactor LLGPUFrustumCull
1. Add collection phase methods
2. Add group-to-result mapping
3. Increase MAX_AABBS to 32768 (handle all partitions)
4. Add partition traversal helper

### Phase 2: Integrate with LLPipeline
1. Find the right hook point (likely `LLPipeline::updateCull`)
2. Add collection loop over all partitions
3. Call dispatch before per-partition culling

### Phase 3: Modify LLSpatialPartition::cull
1. Check for pre-computed GPU results
2. Create result applier class (traverses octree, applies results)
3. Keep CPU fallback for when GPU unavailable

### Phase 4: Optimization
1. Persistent mapped buffers (avoid per-frame allocation)
2. Triple buffering for async readback
3. Consider frustum coherence (skip unchanged regions)

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Pipeline integration complexity | Start with explicit opt-in via setting |
| Result lookup overhead | Use pointer-based hash map, not index |
| Memory for large scenes | Cap at MAX_AABBS, fall back to CPU for overflow |
| Async timing issues | Initially use sync readback, optimize later |

## Success Metrics

1. **Primary:** CPU time in `LLSpatialPartition::cull` reduced by 50%+
2. **Secondary:** Total frame time reduction of 1-2ms in complex scenes
3. **Validation:** GPU cull results match CPU cull results (no visual differences)

## Files Modified

- `indra/newview/llgpufrustumcull.h` - Expanded API
- `indra/newview/llgpufrustumcull.cpp` - Collection/dispatch logic
- `indra/newview/pipeline.cpp` - Integration point in `updateCull()`
- `indra/newview/llspatialpartition.cpp` - Use pre-computed results in `cull()`
- `indra/newview/app_settings/shaders/class1/deferred/frustumCullC.glsl` - Compute shader

---

## Implementation Lessons Learned (January 2025)

### Key Finding: Overhead Exceeds Savings

**The batched GPU frustum culling implementation works correctly but initially provided no performance benefit.** In fact, it was ~15 FPS slower than CPU culling.

### Why GPU Culling Was Slower

1. **Octree Traversal Overhead**
   - CPU culling traverses octree once, testing AABBs inline
   - GPU culling traverses octree to collect groups, THEN tests on GPU
   - Same traversal work, plus upload/readback overhead

2. **Per-Frame Collection Cost**
   - Collecting ~3000 groups every frame = ~0.5ms overhead
   - The CPU AABB-frustum test is only 5 dot products per plane
   - Collection overhead exceeded any GPU parallelism benefit

3. **Hash Map Overhead**
   - Original implementation used `std::unordered_map<LLSpatialGroup*, U32>`
   - 3000+ hash insertions/lookups per frame added significant overhead

4. **Synchronous GPU Readback**
   - Initial implementation blocked CPU waiting for GPU results
   - Created pipeline stalls even though GPU work was fast (~0.1ms)

### Optimizations Applied

#### 1. Async Readback (1-Frame Delay)
```cpp
// Frame N: dispatch compute, start async readback
// Frame N+1: use results from Frame N-1, dispatch new work
// No CPU stall waiting for GPU
```

#### 2. Direct Array Indexing (No Hash Map)
```cpp
// Store (group, index) pairs per partition
std::unordered_map<LLSpatialPartition*, std::vector<std::pair<LLSpatialGroup*, U32>>> mGroupsByPartition;

// Direct visibility lookup by index
std::vector<U32> mVisibilityResults;

// In cull(): O(1) array access instead of hash lookup
if (idx < visResults.size() && visResults[idx] > 0)
```

#### 3. Rate-Limited Collection (Critical)
```cpp
// Only collect every 30 frames (~2x per second at 60 FPS)
const U32 MIN_FRAMES_BETWEEN_COLLECTION = 30;

if (mFramesSinceCollection >= MIN_FRAMES_BETWEEN_COLLECTION || !mBatchedResultsReady)
{
    mNeedsCollection = true;
    mFramesSinceCollection = 0;
}
```

This is the key optimization. By collecting only every 30 frames:
- 29/30 frames have zero octree traversal overhead
- Culling data is up to ~0.5s stale, but visually imperceptible

### Debug Setting

Enable/disable via debug setting:
```
RenderGPUFrustumCull = TRUE/FALSE
```

### Performance Characteristics

| Scenario | GPU Cull ON | GPU Cull OFF | Notes |
|----------|-------------|--------------|-------|
| Static camera | Similar | Similar | Collection skipped |
| Moving camera | ~2 FPS drop | Baseline | Collection every 30 frames |
| Initial implementation | -15 FPS | Baseline | Before optimizations |

### When GPU Frustum Culling Helps

GPU culling is most beneficial when:
1. Scene has 10,000+ groups (our test was ~3000)
2. CPU is the bottleneck (not GPU)
3. Frustum tests are more complex (hierarchical, multi-frustum)

For typical SL scenes with ~3000 groups, CPU AABB testing is already fast enough that the overhead of GPU offloading exceeds the savings.

### Recommendations

1. **Default OFF** - Set `RenderGPUFrustumCull = FALSE` by default
2. **User testing** - Let users enable for specific scenarios
3. **Future work** - Consider GPU culling for shadow cascades (multiple frustums) where benefit is higher

### Shader Notes

The compute shader (`frustumCullC.glsl`) must be in `class1/deferred/` because the shader loader searches downward from the current shader level. Key details:

```glsl
// Skip far plane (plane 5) to match CPU behavior
for (int i = 0; i < 5; i++)  // NOT 6

// Use int for aabbCount uniform (not uint)
uniform int aabbCount;  // compatible with uniform1i

// Plane math: planes point OUTWARD
// Culled if dot(normal, minCorner) + d > 0
```

---

## Evolution Summary

| Version | Approach | Problem | Status |
|---------|----------|---------|--------|
| v1 | Per-partition dispatch | Too few groups per dispatch, overhead exceeded benefit | Abandoned |
| v2 | Batched collection + single dispatch | Octree traversal to collect groups was the real bottleneck | Replaced |
| v3 | **Persistent buffer** | Groups register once, no per-frame collection | Current |

The key insight was that **the octree traversal itself was the bottleneck**, not the frustum test. The CPU AABB-frustum test is only ~5 dot products - trivially fast. By having groups register themselves at creation and only upload when bounds change, we eliminate the traversal overhead entirely.

### v3 Persistent Buffer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GPU Persistent Buffer                     │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┐        │
│  │ Slot 0  │ Slot 1  │ Slot 2  │  ...    │ Slot N  │        │
│  │center,  │center,  │center,  │         │center,  │        │
│  │extent   │extent   │extent   │         │extent   │        │
│  └─────────┴─────────┴─────────┴─────────┴─────────┘        │
│       ↑         ↑                   ↑                        │
│       │         │                   │                        │
│  Group A    Group B    ...     Group N                       │
│  (stores    (stores             (stores                      │
│   mGPUCullIndex=0) mGPUCullIndex=1)  mGPUCullIndex=N)        │
└─────────────────────────────────────────────────────────────┘

Per Frame:
1. Upload only dirty slots (bounds changed)
2. Dispatch compute shader (tests all slots in parallel)
3. Async readback results
4. LLOctreeCull::frustumCheck() uses getGroupVisibility()
```

### Files Modified (v3)

- `llgpufrustumcull.h` - Persistent buffer API
- `llgpufrustumcull.cpp` - Slot allocation, dirty tracking, async readback
- `llspatialpartition.h:387` - Added `mGPUCullIndex` member
- `llspatialpartition.cpp:616` - Register in constructor
- `llspatialpartition.cpp:138` - Unregister in destructor
- `llspatialpartition.cpp:854` - Mark dirty in rebound()
- `llspatialpartition.cpp:1094` - Use GPU results in frustumCheck()
- `pipeline.cpp:2700` - setFrustum() + dispatch() per frame
