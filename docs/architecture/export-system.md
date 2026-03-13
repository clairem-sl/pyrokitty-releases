# Export System Architecture

## Overview

Firestorm provides two export features:
1. **Save as Collada** - Export objects as .dae files
2. **Backup to Hard Disk** - Export objects as .oxp files with textures

Both use a shared permissions checking system.

## Key Files

- `firestorm/indra/newview/fsexportperms.cpp` - Permission checking for exports
- `firestorm/indra/newview/fsexportperms.h` - Permission check header
- `firestorm/indra/newview/daeexport.cpp` - Collada (.dae) export
- `firestorm/indra/newview/fsfloaterexport.cpp` - Backup (.oxp) export floater

## Permission Checking

### FSExportPermsCheck Class

Two main methods in `fsexportperms.cpp`:

#### canExportNode()
Checks if an object/node can be exported:
```cpp
bool FSExportPermsCheck::canExportNode(LLSelectNode* node, bool dae)
{
    // Checks:
    // - Object ownership
    // - Creator match
    // - Sculpt/mesh permissions
    // - Grid-specific export policies
}
```

#### canExportAsset()
Checks if an asset (texture, sound, animation) can be exported:
```cpp
bool FSExportPermsCheck::canExportAsset(LLUUID asset_id, std::string* name, std::string* description)
{
    // Checks inventory permissions on the asset
}
```

### Grid-Specific Policies

#### Second Life
```cpp
if (LLGridManager::getInstance()->isInSecondLife())
{
    exportable = (object->permYouOwner() && gAgentID == creator);
}
```

#### OpenSim
```cpp
switch (LFSimFeatureHandler::instance().exportPolicy())
{
    case EXPORT_ALLOWED:
        exportable = node->mPermissions->allowOpenSimExportBy(gAgentID);
        break;
    case EXPORT_UNDEFINED:
        exportable = (object->permYouOwner() && object->permModify()
                     && object->permCopy() && object->permTransfer());
        break;
    case EXPORT_DENIED:
        exportable = (object->permYouOwner() && gAgentID == creator);
        break;
}
```

## Bypassing Permission Checks

To always allow exports regardless of permissions, modify `fsexportperms.cpp`:

```cpp
bool FSExportPermsCheck::canExportNode(LLSelectNode* node, bool dae)
{
    if (!node) return false;
    return true;  // Always allow
}

bool FSExportPermsCheck::canExportAsset(LLUUID asset_id, ...)
{
    return true;  // Always allow
}
```

## Collada Export (daeexport.cpp)

### Export Flow
1. Iterate selected objects
2. Check `canExportNode()` for each
3. Export geometry, materials, textures
4. Write .dae file

### Usage
```cpp
LLSelectNode* node = ...;
if (!node->getObject()->getVolume() || !FSExportPermsCheck::canExportNode(node, true))
    continue;
mSaver.add(node->getObject(), node->mName);
```

## Backup Export (fsfloaterexport.cpp)

### Export Flow
1. Build prim data for each object
2. Check `canExportNode()` - use default prim if fails
3. For each texture, check `exportTexture()` → `canExportAsset()`
4. Package into .oxp format

### Default Prim Fallback
When permission check fails:
```cpp
if (!FSExportPermsCheck::canExportNode(node, false))
{
    // Use default prim instead of actual object data
    prim["flags"] = ll_sd_from_U32((U32)0);
    prim["volume"]["path"] = LLPathParams().asLLSD();
    prim["volume"]["profile"] = LLProfileParams().asLLSD();
    prim["material"] = (S32)LL_MCODE_WOOD;
}
```

### Texture Export
```cpp
bool FSFloaterObjectExport::exportTexture(const LLUUID& texture_id)
{
    // Check texture comment for creator info
    // Fall back to FSExportPermsCheck::canExportAsset()
}
```

## FOLLOW_PERMS Guard

The code includes a compile-time guard:
```cpp
#define FOLLOW_PERMS 1

#if !FOLLOW_PERMS
#error "You didn't think it would be that easy, did you? :P"
#endif
```

This was intended to prevent easy bypassing of permissions, but can be worked around by modifying the functions to return `true` early.
