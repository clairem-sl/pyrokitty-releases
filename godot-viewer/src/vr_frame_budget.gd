## Central VR frame budget configuration.
##
## All timing constants that govern how much CPU time main.gd (message
## processing) and scene_manager.gd (mesh/texture finalization) are allowed
## to consume live here.  Both scripts preload this file so the two competing
## budgets are always derived from the same source and can't silently drift
## apart.
##
## Frame math at 72 Hz:
##
##   Full frame window:   VR_FRAME_MS          = 13.9 ms
##   Message processing:  VR_MSG_BUDGET_MS     = 12.0 ms  (main.gd — same as desktop)
##   Mesh/tex finalize:   VR_FINALIZE_STOP_MS  = 30.0 ms  (scene_manager — same as desktop)
##
## The flickering bug was a Godot 4.6 regression, not a budget overrun, so
## tight VR budgets only hurt scene loading without helping frame rate.
## VR and desktop now use the same budgets; revisit if smooth-fps issues appear
## after a region has fully loaded.
##
## VR_FINALIZE_STOP_MS is an *elapsed-time* deadline: scene_manager stops
## finalization when Time.get_ticks_usec() shows the frame has been running
## that long, regardless of how much work is left.

## Target headset refresh rate.  72 Hz gives the largest per-frame window
## (13.9 ms).  Bump to 90 once rendering is consistently within that tighter
## 11.1 ms budget.
const VR_REFRESH_HZ: float = 72.0

## Full frame window in ms, derived from refresh rate.
const VR_FRAME_MS: float = 1000.0 / VR_REFRESH_HZ   # 13.888... ms

## CPU slice for WebSocket message processing (main.gd _process).
const VR_MSG_BUDGET_MS: float = 12.0

## Elapsed-frame-time at which scene_manager stops finalization entirely.
const VR_FINALIZE_STOP_MS: float = 30.0

## XR camera far plane and object visibility range in VR. Tighter than desktop
## (128m) to maximise depth buffer precision where ATW cares about it.
const VR_CAMERA_FAR: float = 32.0

## Fade margin for VR visibility range (objects fade from 24m–32m, then cull).
const VR_VISIBILITY_FADE_MARGIN: float = 8.0

## Desktop (non-VR) equivalents — much looser, 30 fps floor.
const DESKTOP_FRAME_MS: float = 33.3
const DESKTOP_MSG_BUDGET_MS: float = 12.0
