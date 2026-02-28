# VR Debugging Journal

A record of every flickering fix attempted, what it did, and whether it helped.
Current status: **FIXED. Godot 4.4-stable, no flicker.**

---

## The Problem

Quest 3 via PC Link (Air Link / USB). Godot 4.6.1 Mono, OpenXR, Forward+ renderer.
Symptom: constant rhythmic black flicker. User-confirmed "whole screen flashes black."

---

## Attempts

### 1. Disable `submit_depth_buffer`
**Theory:** Depth ATW reprojection was producing artifacts with the 2048m far plane.
**Result:** Flickering changed character (became faster/different) but did not stop.
**Verdict:** Wrong root cause. Reverted — depth submission is required for ATW.
**Note:** `project.godot` now has a comment explaining why this must stay `true`. A test
in `test_main.gd` catches it if someone removes it again.

---

### 2. Fix `far` plane: 2048m → 256m
**Theory:** 2048m far plane wastes depth buffer precision in the 0–128m range where all
geometry lives, making ATW reprojection unreliable.
**Result:** No direct impact on flickering, but correct and kept.
`XRCamera3D.far` is now set at runtime from `SceneManager.VISIBILITY_FAR * 2.0` so the
camera far and the object visibility range can't silently diverge again.
The `.tscn` default is also updated to 256m as a fallback.

---

### 3. `openxr/enabled=false`
**Theory:** Suppress "No viewport marked with use_xr" spam in non-VR mode.
**Result:** Completely broke VR. `XRServer.find_interface("OpenXR")` returns null
without this setting — the module never registers.
**Fix:** Reverted to `true`. Added `xr_interface.uninitialize()` in `main.gd._ready()`
when `--vr` is not passed, which shuts down the auto-initialized session before it
renders anything.

---

### 4. Disable vsync (`VSYNC_DISABLED` on VR init)
**Theory:** Monitor vsync (60 Hz) was causing Godot to submit frames at 60 fps to a
90 Hz headset — Quest shows black for every missed slot.
**Result:** YES — changed flickering from slow rhythmic to faster. Partially effective.
The 60/90 Hz beat frequency was a real contributor.
**Verdict:** Kept. Vsync is disabled only when VR initialises; desktop mode keeps it.

---

### 5. Shadow quality reduced for VR
**Theory:** The keyboard-movement shadow throttle never fires in VR (no WASD). The
camera sits permanently at "stopped" quality: 4 cascades, 100m max distance.
**Fix:** `set_vr_mode(true)` on `CameraController` now immediately applies 2 cascades /
30m and guards `_set_shadow_quality()` so the throttle can never restore expensive
settings in VR.
**Result:** Reduced frame time spikes. Kept.

---

### 6. `TARGET_FRAME_MS` (scene_manager) was 33.3ms
**Theory:** Scene manager's adaptive finalization budget was calibrated for 30 fps
desktop. At 90 Hz (11.1ms frame), if only 2ms had elapsed, it calculated
`remaining = 33.3 - 2 = 31ms` and burned 31ms on textures/meshes — 3× the full
frame budget.
**Fix:** Added VR-specific `_target_frame_ms`, now driven from `VRFrameBudget`.
**Result:** Major improvement, part of the overall fix. Kept.

---

### 7. `RenderingDevice.MEMORY_TOTAL` GPU stall
**Theory:** `get_memory_usage(MEMORY_TOTAL)` is called every 5 seconds in the stats
timer. On many GPU drivers this flushes the pipeline to get an accurate count,
causing a multi-ms stall on the main thread — a periodic hitch every 5 seconds.
**Fix:** Skip VRAM stats entirely in VR mode. Removed `MEMORY_TOTAL` from desktop
stats too (not worth the cost; `MEMORY_TEXTURES` + `MEMORY_BUFFERS` are sufficient).
**Result:** Eliminated the periodic 5-second hitch. Kept.

---

### 8. Refresh rate locked to 72 Hz
**Theory:** Quest 3 supports 72/90/120 Hz. Without an explicit request it may default
to 90 Hz. Locking to 72 Hz gives the largest frame window (13.9ms vs 11.1ms).
**Fix:** `xr_interface.set_display_refresh_rate(VRFrameBudget.VR_REFRESH_HZ)` on init.
**Result:** FPS stabilised at exactly 72. Kept.

---

### 9. `OVERBUDGET_FINALIZE_MS` in VR
**Theory:** When scene_manager detected the frame was already late, it switched to an
8ms "overbudget" finalization mode — intended for desktop where "slow frame, get work
done faster" makes sense. In VR, a late frame should do *zero* finalization; adding
8ms more CPU work just pushes the next frame over the deadline too.
**Fix:** In VR mode, `budget_ms = clampf(remaining_ms, 0.0, MIN_FINALIZE_MS)` — zero
when over budget, tiny otherwise.
**Result:** Combined with the other fixes, brought FPS to a stable 72. Kept.

---

### 10. Combined CPU budget: 4ms (messages) + 10ms (finalization) = 14ms > frame
**Theory:** `main.gd` and `scene_manager.gd` had independent budgets that could both
fire in the same frame. 4ms + 10ms = 14ms of CPU before the GPU even started, on a
13.9ms total frame budget.
**Fix:** Budgets cut to 2ms + 2ms and unified in `src/vr_frame_budget.gd`. Refresh
rate, frame window, message budget, and finalization deadline all live in one place.
**Result:** Stable 72 fps achieved. Kept.

---

## Current State

FPS is stable at 72. Frames are being submitted on time. The flickering (whole screen
black) persists. Since frames are *not* dropping (stable FPS counter), the remaining
cause is something the ATW compositor is failing to cover — either the depth layer
isn't being used correctly for reprojection, or there's a Godot 4.6 / Meta runtime
interaction we haven't identified yet.

### 11. XROrigin3D repositioned every frame
**Theory:** `xr_pose_updated` was emitted every frame from `_update_camera()`, even
when the avatar was completely still. Every call set `XROrigin3D.global_position` and
`.rotation`, telling the OpenXR runtime the reference space changed. ATW computed its
reprojection against the old origin, then the origin shifted (even by float noise),
making the reprojection wrong 72 times per second.
**Fix:** Added `_last_xr_pos` / `_last_xr_yaw` tracking with 5mm / 0.06° thresholds.
`xr_pose_updated` only fires when avatar actually moves. XROrigin3D stays stable
between real movements.
**Result:** TBD

### 12. CanvasLayer debug overlay in VR
**Theory:** `camera_controller.gd` creates a `CanvasLayer` for the debug tooltip. In
Godot, `CanvasLayer` renders to the viewport regardless of which `Camera3D` is active.
In stereo XR mode it renders over (or alongside) the 3D XR scene, potentially causing
the compositor to see unexpected 2D content — interfering with depth reprojection.
There is also no mouse cursor in VR so the overlay is useless there.
**Fix:** `set_vr_mode(true)` now sets `_tooltip_layer.visible = false`.
**Result:** TBD

### 13. `set_render_target_size_multiplier(0.8)`
**Theory:** Scaling the render target to 80% may cause a size mismatch between the
submitted color and depth textures vs. what the OpenXR runtime expects, causing ATW
to silently reject or mis-apply the depth layer.
**Fix:** Removed. Render target now uses the native swapchain resolution (default 1.0).
**Result:** TBD

### 14. Forward+ renderer → Mobile renderer
**Theory:** Godot's Forward+ renderer uses a clustered lighting pass that makes
heavier Vulkan API calls — matching the "Requested Vulkan version exceeds maximum"
warning from the Meta runtime. In stereo it renders the scene twice. The Godot docs
explicitly recommend the Mobile renderer for OpenXR: simpler Vulkan path, no
clustered lighting, more efficient stereo.
**Fix:** Added to project.godot:
```
renderer/rendering_method="mobile"
renderer/rendering_method.mobile="mobile"
```
**Result:** TBD

### 15. Godot version: 4.6.1 → 4.4-stable
**Theory:** The flickering persisted through every CPU/GPU/ATW/renderer fix. Trying
4.7-dev1 still flickered. Downgrading to 4.4-stable eliminated it completely.
**Root cause:** A regression in Godot 4.6.x's OpenXR implementation — likely in how
it submits the swapchain or depth layer to the Meta PC Link runtime. The exact commit
is unknown but 4.5/4.6 broke something that 4.4 and (presumably) a future 4.6.x
patch will fix.
**Fix:** `godot-viewer/godot-version.txt` set to `Godot_v4.4-stable_win64`.
**Result:** No flicker. 72 fps stable. **SOLVED.**

---

## Key Files

| File | Purpose |
|------|---------|
| `src/vr_frame_budget.gd` | Single source of truth for all VR timing constants |
| `src/main.gd` | VR init, vsync disable, refresh rate, message budget |
| `src/scene_manager.gd` | Finalization budget, VRAM stats skip |
| `src/camera_controller.gd` | VR shadow quality, xr_pose_updated signal |
| `src/xr_rig.gd` | XROrigin3D positioning |
| `project.godot` | `submit_depth_buffer=true` (do not remove) |
| `tests/test_main.gd` | Budget consistency tests + depth buffer guard |
