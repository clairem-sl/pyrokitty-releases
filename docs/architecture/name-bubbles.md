# Name Bubbles — 2D Screen-Space Overlay

Avatar name tags, chat text, and typing indicators are rendered as **2D UI elements** projected from the 3D head bone position onto screen coordinates. This approach was chosen after exhaustive testing of 3D alternatives.

## Architecture

- `name_bubble_manager.gd` creates a `CanvasLayer` (layer 100) with a `Control` container
- Each avatar gets a `PanelContainer` (rounded rect via `StyleBoxFlat`) with a `Label` child
- Every frame, the head bone world position is projected to screen via `camera.unproject_position()`
- The panel is positioned at those screen coordinates, centered horizontally, anchored at the bottom
- Distance-based scaling uses `sqrt(REF_DISTANCE / distance)` for non-linear falloff — text stays readable at moderate distances

## Why Not 3D?

TAA (temporal anti-aliasing) is fundamentally incompatible with 3D billboard text in Godot. Every 3D approach was tested and failed:

| Approach | Result |
|----------|--------|
| **Label3D + TEXTURE_FILTER_NEAREST** | Pixelated at moderate distances |
| **Label3D + TEXTURE_FILTER_LINEAR_WITH_MIPMAPS** | Text fades to invisible at distance (mip levels average glyph alpha with transparent surroundings) |
| **Label3D + TEXTURE_FILTER_LINEAR** | Blurry during camera/avatar movement |
| **Label3D + ALPHA_CUT_DISCARD** | Flashes black/white (TAA jitter shifts which pixels pass the alpha threshold) |
| **Label3D + ALPHA_CUT_OPAQUE_PREPASS** | Text disappears during movement (prepass + TAA interaction) |
| **Label3D + ALPHA_CUT_DISABLED** | Blurry during movement (TAA smears alpha-blended geometry) |
| **Multiple Label3D + background quad** | Z-fighting between text and background (both depth-test-disabled, transparency sort unstable) |
| **render_priority separation** | OPAQUE_PREPASS renders in depth prepass before transparent pass, so render_priority can't prevent background from overwriting text |
| **SubViewport → Sprite3D texture** | Still blurry — TAA motion vectors don't account for billboard vertex shader rotation |
| **CPU-side billboard rotation** (manual basis, no billboard mode) | Still blurry — TAA reprojection still fails for objects that rotate every frame |

The root cause: Godot's TAA computes motion vectors from previous/current model-view-projection matrices. Billboard rendering (whether vertex shader or CPU-side) changes the object's orientation every frame to face the camera. TAA interprets this continuous rotation as motion and blurs the result. There is no per-object TAA exclusion in Godot.

## 2D Overlay Advantages

- **Zero TAA interaction** — CanvasLayer renders after all 3D post-processing
- **Pixel-perfect text** — native 2D font rendering, no 3D texture sampling
- **No z-fighting** — single Control per avatar, no overlapping geometry
- **No depth/transparency sorting** — 2D draw order is deterministic
- **Non-linear distance scaling** — `sqrt()` falloff keeps text readable longer than linear world-space scaling
- **Cheaper** — one Control per avatar instead of multiple 3D nodes + materials
