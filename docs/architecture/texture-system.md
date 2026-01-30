# Texture System Architecture

## Overview

The texture system handles texture display, selection, and editing in the viewer, including the texture picker floater and build floater texture panel.

## Key Files

- `indra/newview/lltexturectrl.cpp` - Texture picker floater
- `indra/newview/lltexturectrl.h` - Texture control header
- `indra/newview/llpanelface.cpp` - LL texture panel (build floater)
- `indra/newview/fspanelface.cpp` - Firestorm texture panel
- `skins/default/xui/en/floater_texture_ctrl.xml` - Texture picker UI

## Texture Picker Floater

### Class: LLFloaterTexturePicker

Located in `lltexturectrl.cpp`.

### Key UI Elements
- Texture preview
- Inventory browser
- UUID input field (`TextureKey`)
- Apply UUID button (`TextureKeyApply`)
- Various texture source buttons (Default, None, Blank, Transparent)

### UUID Display Logic

The UUID field visibility is controlled by permissions:

```cpp
// Original code - only shows UUID for full-perm textures
if (copy && mod && xfer)
{
    getChild<LLLineEditor>("TextureKey")->setText(image_id.asString());
}
else
{
    getChild<LLLineEditor>("TextureKey")->setText(LLUUID::null.asString());
}
```

To always show UUID regardless of permissions:
```cpp
getChild<LLLineEditor>("TextureKey")->setText(image_id.asString());
```

### UUID Locations to Modify

Two places in `lltexturectrl.cpp`:
1. Around line 285-294 - When selecting from inventory
2. Around line 1209-1216 - When item is selected via `onSelectionChange`

## Build Floater Texture Panel

### Classes
- `LLPanelFace` in `llpanelface.cpp` - Standard LL panel
- `FSPanelFace` in `fspanelface.cpp` - Firestorm enhanced panel

### updateUI() Method

Controls what's shown based on selection and permissions:

```cpp
void LLPanelFace::updateUI(bool force_set_values)
{
    LLViewerObject* objectp = ...;

    if (objectp
        && objectp->getPCode() == LL_PCODE_VOLUME
        && objectp->permModify())  // <-- Permission gate
    {
        bool editable = objectp->permModify() && !objectp->isPermanentEnforced();
        // Show texture controls, enabled based on 'editable'
    }
    else
    {
        clearCtrls();  // Hide/disable everything
    }
}
```

### Showing Panel Regardless of Ownership

Remove `permModify()` from the condition:
```cpp
if (objectp
    && objectp->getPCode() == LL_PCODE_VOLUME)
{
    bool editable = objectp->permModify() && !objectp->isPermanentEnforced();
    // Controls shown but disabled when !editable
}
```

## Texture Types

### Material Types (MATMEDIA enum)
- `MATMEDIA_MATERIAL` - Legacy materials
- `MATMEDIA_PBR` - PBR materials
- `MATMEDIA_MEDIA` - Media on a prim

### Material Component Types (MATTYPE enum)
- `MATTYPE_DIFFUSE` - Diffuse/albedo texture
- `MATTYPE_NORMAL` - Normal map
- `MATTYPE_SPECULAR` - Specular map

### PBR Types (PBRTYPE enum)
- `PBRTYPE_RENDER_MATERIAL_ID` - Material UUID
- `PBRTYPE_BASE_COLOR` - Base color texture
- `PBRTYPE_METALLIC_ROUGHNESS` - Metallic/roughness texture
- `PBRTYPE_EMISSIVE` - Emissive texture
- `PBRTYPE_NORMAL` - Normal map

## Texture Controls

### Key Controls in Panel
- `mTextureCtrl` - Diffuse texture picker
- `mShinyTextureCtrl` - Specular texture picker
- `mBumpyTextureCtrl` - Normal texture picker
- `mPBRTextureCtrl` - PBR material picker
- `mColorSwatch` - Color tint control

### Control State
Controls use `setEnabled()` based on `editable` flag:
```cpp
mTextureCtrl->setEnabled(editable);
mColorSwatch->setEnabled(editable && !has_pbr_material);
mComboMatMedia->setEnabled(editable);
```

## Texture Alignment

### Auto-align Feature
- `mBtnAlign` button triggers texture alignment
- Uses `LLPanelFaceSetAlignedTEFunctor`

### Planar Mapping
- `mCheckPlanarAlign` checkbox
- Aligns textures across linked faces

## Special Textures

Defined UUIDs for special textures:
- `DEFAULT_OBJECT_TEXTURE` - Default plywood
- `BLANK_OBJECT_TEXTURE` - Blank white
- `BLANK_OBJECT_NORMAL` - Flat normal map
- `IMG_WHITE` - Pure white
- `SCULPT_DEFAULT_TEXTURE` - Default sculpt map
- `BLANK_MATERIAL_ASSET_ID` - No material

## GL Memory: PBR vs Legacy Textures

### Key Files
- `indra/newview/llvovolume.cpp` - Face texture assignment during geometry rebuild
- `indra/newview/llface.h` - Face texture storage
- `indra/newview/llviewertexture.cpp` - Texture streaming and GL upload
- `indra/llrender/llrender.h` - Texture channel definitions

### Texture Channel Storage

Each face stores 7 texture slots (`llface.h:309`):

| Channel | Index | Purpose |
|---------|-------|---------|
| `DIFFUSE_MAP` | 0 | Legacy diffuse texture |
| `ALTERNATE_DIFFUSE_MAP` / `NORMAL_MAP` | 1 | Legacy normal map (shared slot) |
| `SPECULAR_MAP` | 2 | Legacy specular map |
| `BASECOLOR_MAP` | 3 | PBR base color |
| `METALLIC_ROUGHNESS_MAP` | 4 | PBR metallic/roughness |
| `GLTF_NORMAL_MAP` | 5 | PBR normal map |
| `EMISSIVE_MAP` | 6 | PBR emissive |

### Memory Exclusivity

**PBR and legacy textures do NOT consume double GL memory.** When a face has a PBR material, legacy textures are explicitly cleared.

In `llvovolume.cpp` during geometry rebuild (~line 6099):
```cpp
if (is_pbr)
{
    // tell texture streaming system to ignore blinn-phong textures
    // except the special case of the diffuse map containing a
    // media texture that will be reused for swapping on to the pbr face
    if (!facep->hasMedia())
    {
        facep->setTexture(LLRender::DIFFUSE_MAP, nullptr);
    }
    facep->setTexture(LLRender::NORMAL_MAP, nullptr);
    facep->setTexture(LLRender::SPECULAR_MAP, nullptr);

    // let texture streaming system know about PBR textures
    facep->setTexture(LLRender::BASECOLOR_MAP, gltf_mat->mBaseColorTexture);
    facep->setTexture(LLRender::GLTF_NORMAL_MAP, gltf_mat->mNormalTexture);
    facep->setTexture(LLRender::METALLIC_ROUGHNESS_MAP, gltf_mat->mMetallicRoughnessTexture);
    facep->setTexture(LLRender::EMISSIVE_MAP, gltf_mat->mEmissiveTexture);
}
```

### Virtual Size Updates

Texture priority calculation is also mutually exclusive (`llvovolume.cpp:936-945`):

```cpp
if (!te->getGLTFRenderMaterial())
{
    ch_min = LLRender::DIFFUSE_MAP;
    ch_max = LLRender::SPECULAR_MAP;
}
else
{
    ch_min = LLRender::BASECOLOR_MAP;
    ch_max = LLRender::EMISSIVE_MAP;
}
```

This means only PBR OR legacy textures get their virtual size updated (which drives fetch priority and GL upload).

### Exception: Media on a Prim

The only case where a legacy diffuse texture coexists with PBR is when the face has **media on a prim**. The diffuse slot holds the media texture which gets swapped onto the PBR face for rendering.

### Texture Streaming Flow

1. **Face Setup**: Textures assigned to face slots during geometry rebuild
2. **Virtual Size**: `updateTextureVirtualSize()` calculates priority based on screen coverage
3. **addTextureStats()**: Updates `mMaxVirtualSize` on the texture object
4. **Fetch Priority**: Higher virtual size = higher fetch priority
5. **GL Upload**: Textures with 0 virtual size are not fetched/uploaded
6. **Discard**: `scaleDown()` reduces GL memory for textures no longer needed

### Summary

Setting a texture slot to `nullptr`:
- Removes it from the face's texture list
- Stops virtual size calculations for that texture
- Prevents fetching/decoding
- Frees GL memory when no other faces reference it

Objects with PBR materials only consume GL memory for their PBR textures, not both PBR and legacy.
