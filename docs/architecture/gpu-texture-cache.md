# GPU Texture Cache

## Overview

The GPU Texture Cache stores textures in DXT5 (BC3) compressed format for fast loading. When a texture is first decoded from J2C (JPEG2000), it's compressed to DXT5 and saved to disk. On subsequent loads, the pre-compressed DXT5 data is loaded directly, bypassing the expensive J2C decode step.

## Performance Benefits

- **J2C decode bypass**: J2C decoding is CPU-intensive. DXT5 decompression is trivial by comparison.
- **Smaller file sizes**: DXT5 is 1 byte per pixel (vs 4 bytes for raw RGBA), reducing disk I/O.
- **GPU-ready format**: DXT5 can be uploaded directly to GPU (though we currently decompress to RGBA for compatibility).

## File Format

Cache files use a custom `.dxt` format with a simple header:

```cpp
struct FSGPUCacheHeader {
    U32 magic;      // 'FSDX' = 0x58445346
    U32 version;    // Format version (1)
    U32 format;     // DXT5=1, BC7=2
    U32 width;      // Original width
    U32 height;     // Original height
    U32 mip_levels; // Number of mip levels
    U32 flags;      // hasAlpha, sRGB, etc.
    U32 data_size;  // Size of compressed data
};
```

Followed by raw DXT5 block data (16 bytes per 4x4 pixel block).

## Directory Structure

Cache location: `AppData\Local\PyroKittyOS_x64\gpucache\`

Uses 256 subdirectories (00-ff) based on the first two hex characters of the texture UUID. This keeps each directory under ~10K files for optimal NTFS performance at 16GB cache size.

```
gpucache/
  00/
    0009f11e-e71c-2bc6-686e-e3f9329f3c37.dxt
    00326b8e-387f-5285-1deb-f6a883045dc8.dxt
    ...
  01/
  02/
  ...
  ff/
```

## Architecture

### Key Files

- `firestorm/indra/newview/llgputexturecache.h` - Header with cache API
- `firestorm/indra/newview/llgputexturecache.cpp` - Implementation
- `firestorm/indra/newview/lltexturefetch.cpp` - Integration point in texture pipeline

### Thread Safety

The cache operates across multiple threads:

1. **Worker threads** (texture fetch): Call `readTexture()` and `writeTexture()`
2. **Background write thread**: Handles async disk writes to avoid I/O stalls
3. **Main thread**: Samples stats via `getAndResetDeltas()`

Thread safety is achieved through:
- `LLMutex mMutex` for cache entry access
- `std::mutex mWriteQueueMutex` for the async write queue
- `std::atomic<U32>` for delta counters (stats)

### Async Writes

Writes are queued and processed by a background thread to avoid disk I/O blocking the texture fetch threads:

```cpp
void writeTexture(id, raw_image)
    -> Compress to DXT5 in-memory
    -> Queue FSGPUCacheWriteRequest
    -> Background thread writes to disk
```

### DXT5 Compression/Decompression

Uses `stb_dxt.h` for compression (called from worker threads).

Decompression is implemented inline in `llgputexturecache.cpp`:
- Alpha block: 8 bytes encoding 16 alpha values via interpolation
- Color block: 8 bytes encoding RGB565 endpoints + 2-bit indices

## Integration Points

### Texture Fetch Pipeline (lltexturefetch.cpp)

**Read path** (DECODE_IMAGE state):
```cpp
if (gpu_cache_enabled && discard == 0 && !mNeedsAux) {
    if (LLGPUTextureCache::getInstance()->readTexture(mID, cached_image)) {
        // Cache hit - skip J2C decode
        mRawImage = cached_image;
        setState(DECODE_IMAGE_UPDATE);
        return;
    }
}
// Cache miss - proceed with normal J2C decode
```

**Write path** (after successful decode):
```cpp
if (mDecodedDiscard == 0 && mRawImage->getComponents() == 4) {
    LLGPUTextureCache::getInstance()->writeTexture(mID, mRawImage);
}
```

### Statistics (llviewertexturelist.cpp)

Stats are sampled from the main thread every frame:

```cpp
U32 hits, misses;
LLGPUTextureCache::getInstance()->getAndResetDeltas(hits, misses);
add(GPU_CACHE_HITS, hits);
add(GPU_CACHE_MISSES, misses);
sample(GPU_CACHE_SIZE, cache_size_mb);
```

Stats appear in the Statistics floater under Texture section.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `GPUTextureCacheEnabled` | true | Enable/disable the cache |
| `GPUTextureCacheSize` | 16384 | Max cache size in MB |

## LRU Eviction

When the cache exceeds `GPUTextureCacheSize`, least-recently-used entries are evicted. Each entry tracks:
- `last_access` - Frame number of last access
- `access_count` - Number of times accessed

## Limitations

- Only caches full-resolution textures (discard level 0)
- Only caches 4-component (RGBA) textures
- Does not cache auxiliary data (normal maps, specular)
- Currently decompresses to RGBA rather than uploading DXT5 directly to GPU

## Future Improvements

- Direct GPU upload of DXT5 data (requires GL format support checks)
- BC7 compression for higher quality (slower compression, same decompression speed)
- Mipmap chain storage
- Auxiliary texture caching
