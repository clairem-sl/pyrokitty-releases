# Viewer Capabilities

## Overview

Capabilities ("caps") are URLs provided by the simulator that the viewer uses to access various services. They're obtained during region handshake and stored in `LLViewerRegion`.

## ViewerAsset Capability

The primary capability for downloading assets (textures, meshes, sounds, animations, etc.).

### URL Structure

```
{ViewerAsset_cap_url}/?{type_name}_id={uuid}
```

**Construction** (`llviewerassetstorage.cpp:640-644`):
```cpp
std::string LLViewerAssetStorage::getAssetURL(const std::string& cap_url, const LLUUID& uuid, LLAssetType::EType atype)
{
    std::string type_name = LLAssetType::lookup(atype);
    std::string url = cap_url + "/?" + type_name + "_id=" + uuid.asString();
    return url;
}
```

### Asset Type Query Parameters

From `llassettype.cpp:70-103`:

| Asset Type | Type Name | Query Parameter |
|------------|-----------|-----------------|
| `AT_TEXTURE` | `texture` | `?texture_id=` |
| `AT_SOUND` | `sound` | `?sound_id=` |
| `AT_ANIMATION` | `animatn` | `?animatn_id=` |
| `AT_MESH` | `mesh` | `?mesh_id=` |
| `AT_LANDMARK` | `landmark` | `?landmark_id=` |
| `AT_CLOTHING` | `clothing` | `?clothing_id=` |
| `AT_BODYPART` | `bodypart` | `?bodypart_id=` |
| `AT_GESTURE` | `gesture` | `?gesture_id=` |
| `AT_NOTECARD` | `notecard` | `?notecard_id=` |
| `AT_SETTINGS` | `settings` | `?settings_id=` |
| `AT_MATERIAL` | `material` | `?material_id=` |
| `AT_GLTF` | `gltf` | `?gltf_id=` |
| `AT_GLTF_BIN` | `glbin` | `?glbin_id=` |
| `AT_LSL_TEXT` | `lsltext` | `?lsltext_id=` |

### Key Files

| File | Purpose |
|------|---------|
| `llviewerassetstorage.cpp` | `getAssetURL()` builds URLs, `mViewerAssetUrl` storage |
| `llviewerregion.cpp:3663-3702` | Stores `mViewerAssetUrl` from capability response |
| `llviewerregion.h:430` | `getViewerAssetUrl()` accessor |
| `lltexturefetch.cpp:1399-1412` | Texture fetch URL construction |
| `llmeshrepository.cpp:1500-1504` | Mesh fetch URL construction |
| `llassettype.cpp:70-103` | Asset type name mappings |

### Example URLs

```
http://simhost.example.com:12046/cap/abc123.../?texture_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890
http://simhost.example.com:12046/cap/abc123.../?mesh_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890
http://simhost.example.com:12046/cap/abc123.../?animatn_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### Legacy Capabilities

Firestorm also supports legacy asset capabilities (FS:Ansariel [UDP Assets]):

| Capability | Purpose |
|------------|---------|
| `GetTexture` | Legacy texture downloads |
| `GetMesh` | Legacy mesh downloads (version 1) |
| `GetMesh2` | Mesh downloads (version 2) |

Code checks for ViewerAsset first, falls back to legacy:
```cpp
// llmeshrepository.cpp:1480-1496
if (gAgent.getRegion()->meshRezEnabled())
{
    res_url = gAgent.getRegion()->getViewerAssetUrl();
    if (res_url.empty())
    {
        res_url = mGetMesh2Capability;  // fallback to GetMesh2
    }
    if (res_url.empty())
    {
        res_url = mLegacyGetMeshCapability;  // fallback to GetMesh
    }
}
```

## Common Capabilities

Retrieved via `LLViewerRegion::getCapability(name)`:

| Capability | Purpose |
|------------|---------|
| `ViewerAsset` | Asset downloads (textures, mesh, sounds, etc.) |
| `ViewerMetrics` | Upload viewer metrics/stats |
| `GetTexture` | Legacy texture downloads |
| `GetMesh` / `GetMesh2` | Legacy mesh downloads |
| `ChatSessionRequest` | Group chat operations |
| `ObjectMedia` | Media on a prim |
| `ParcelPropertiesUpdate` | Update parcel settings |
| `UpdateAvatarAppearance` | Bake/upload appearance |
| `AvatarRenderInfo` | Avatar complexity info |
| `UpdateScriptTask` | Upload scripts to objects |
| `GetDisplayNames` | Fetch display names |
| `AvatarPickerSearch` | Search for avatars |
| `ServerReleaseNotes` | Region release notes |
| `RemoteParcelRequest` | Get parcel info by location |

## Capability Storage

```cpp
// llviewerregion.h
class LLViewerRegion {
    std::string mViewerAssetUrl;  // Cached ViewerAsset capability
    std::string mHttpUrl;         // Legacy HTTP asset URL (FS)

    std::string getViewerAssetUrl() const { return mViewerAssetUrl; }
    std::string getCapability(const std::string& name) const;
};
```

## HTTP Policy Classes

Asset downloads use specific HTTP policy classes for connection pooling:

| Policy Class | Purpose | File |
|--------------|---------|------|
| `AP_TEXTURE` | Texture downloads | `llappcorehttp.h:95` |
| `AP_MESH1` | GetMesh capability | `llappcorehttp.h:95` |
| `AP_MESH2` | GetMesh2 capability | `llappcorehttp.h:108` |
| `AP_LARGE_MESH` | Large mesh downloads | `llappcorehttp.h:124` |
