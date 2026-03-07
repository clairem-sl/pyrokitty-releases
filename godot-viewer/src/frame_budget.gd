## Central frame budget configuration.
##
## All timing constants that govern how much CPU time main.gd (message
## processing) and scene_manager.gd (mesh/texture finalization) are allowed
## to consume live here.  Both scripts preload this file so the two competing
## budgets are always derived from the same source and can't silently drift
## apart.

# ---------------------------------------------------------------------------
#  VR
# ---------------------------------------------------------------------------

## Target headset refresh rate.  72 Hz gives the largest per-frame window
## (13.9 ms).  Bump to 90 once rendering is consistently within that tighter
## 11.1 ms budget.
const VR_REFRESH_HZ: float = 72.0

## Full frame window in ms, derived from refresh rate.
const VR_FRAME_MS: float = 1000.0 / VR_REFRESH_HZ   # 13.888... ms

## CPU slice for WebSocket message processing in VR (main.gd _process).
const VR_MSG_BUDGET_MS: float = 12.0

## Elapsed-frame-time at which scene_manager stops finalization entirely.
const VR_FINALIZE_STOP_MS: float = 30.0

## XR camera far plane and object visibility range in VR.  Tighter than
## desktop (128 m) to maximise depth buffer precision where ATW cares.
const VR_CAMERA_FAR: float = 32.0

## Fade margin for VR visibility range (objects fade from 24 m–32 m, then cull).
const VR_VISIBILITY_FADE_MARGIN: float = 8.0

# ---------------------------------------------------------------------------
#  Desktop
# ---------------------------------------------------------------------------

## Desktop frame budget — 30 fps floor.
const DESKTOP_FRAME_MS: float = 33.3

## CPU slice for WebSocket message processing on desktop.
const DESKTOP_MSG_BUDGET_MS: float = 12.0

## Desktop visibility range. Objects fade from
## (VISIBILITY_FAR - VISIBILITY_FADE_MARGIN) to VISIBILITY_FAR, then cull.
const VISIBILITY_FAR: float = 128.0
const VISIBILITY_FADE_MARGIN: float = 32.0

# ---------------------------------------------------------------------------
#  Finalization (mesh / texture apply on main thread)
# ---------------------------------------------------------------------------

## Minimum finalize budget when the frame is on-target.
const MIN_FINALIZE_MS: float = 2.0

## More aggressive finalization budget when already over frame budget (desktop).
const OVERBUDGET_FINALIZE_MS: float = 8.0

# ---------------------------------------------------------------------------
#  Throughput limits
# ---------------------------------------------------------------------------

## Dedicated OS threads for loading textures from disk (bypasses WorkerThreadPool cap).
const TEXTURE_THREAD_COUNT: int = 16

## Max concurrent mesh worker tasks in the WorkerThreadPool.
const MESH_MAX_IN_FLIGHT: int = 16

## Max active OmniLight3D / SpotLight3D in the scene.
const MAX_ACTIVE_LIGHTS: int = 64

## Distance beyond which lights are culled, and how often the cull pass runs.
const LIGHT_CULL_DISTANCE: float = 64.0
const LIGHT_CULL_INTERVAL: float = 2.0

## Max spot lights that cast shadows (ranked by distance each cull pass).
## Omni lights never cast shadows (cubemap shadow maps are too expensive).
const MAX_SHADOW_LIGHTS: int = 4
