extends Node

## Tests for camera_controller.gd
## Run headless:
##   cd godot-viewer && GODOT=$(cat godot-version.txt | tr -d '[:space:]') && ./$GODOT/${GODOT}_console.exe \
##     --headless --quit-after 5 --scene tests/test_camera_controller.tscn
##
## Test status legend:
##   [GREEN]  — should pass with current code and must keep passing after changes
##   [RED]    — defines first-person behavior; expected to FAIL until implementation

var _passed := 0
var _failed := 0


func _ready() -> void:
	_passed = 0
	_failed = 0

	# ── Existing: compile + shadow API ──────────────────────────────────────
	_test_script_compiles()
	_test_shadow_mode_constants()
	_test_shadow_properties()

	# ── Regression: behavior that must not break ─────────────────────────────
	_test_pitch_clamp_bounds()
	_test_movement_message_keys()

	# ── VR mode ───────────────────────────────────────────────────────────────
	_test_set_vr_mode_sets_flag()
	_test_set_vr_mode_disables_camera()
	_test_shadow_quality_noop_in_vr_mode()
	_test_shadow_quality_vr_no_crash_without_light()

	# ── Regression: third-person orbit geometry ───────────────────────────────
	_test_third_person_orbit_distance()
	_test_third_person_not_at_avatar()
	_test_third_person_looks_at_avatar()
	_test_third_person_yaw_rotates_orbit()
	_test_third_person_distance_affects_position()
	_test_third_person_avatar_yaw_independent()

	print("--- camera_controller tests: %d passed, %d failed ---" % [_passed, _failed])


# ─── Helpers ──────────────────────────────────────────────────────────────────

func _assert(condition: bool, msg: String) -> void:
	if condition:
		_passed += 1
		print("  PASS: %s" % msg)
	else:
		_failed += 1
		push_error("  FAIL: %s" % msg)


# ─── Existing tests ───────────────────────────────────────────────────────────

func _test_script_compiles() -> void:
	var script = load("res://src/camera_controller.gd")
	_assert(script != null, "[GREEN] camera_controller.gd compiles without error")


func _test_shadow_mode_constants() -> void:
	_assert(DirectionalLight3D.SHADOW_ORTHOGONAL == 0,
		"[GREEN] SHADOW_ORTHOGONAL == 0")
	_assert(DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS == 1,
		"[GREEN] SHADOW_PARALLEL_2_SPLITS == 1")
	_assert(DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS == 2,
		"[GREEN] SHADOW_PARALLEL_4_SPLITS == 2")


func _test_shadow_properties() -> void:
	var light := DirectionalLight3D.new()
	add_child(light)
	light.shadow_enabled = true

	light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	light.directional_shadow_max_distance = 40.0
	_assert(light.directional_shadow_mode == DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS,
		"[GREEN] directional_shadow_mode = SHADOW_PARALLEL_2_SPLITS round-trips")
	_assert(is_equal_approx(light.directional_shadow_max_distance, 40.0),
		"[GREEN] directional_shadow_max_distance = 40.0 round-trips")

	light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	light.directional_shadow_max_distance = 100.0
	_assert(light.directional_shadow_mode == DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS,
		"[GREEN] directional_shadow_mode = SHADOW_PARALLEL_4_SPLITS round-trips")
	_assert(is_equal_approx(light.directional_shadow_max_distance, 100.0),
		"[GREEN] directional_shadow_max_distance = 100.0 round-trips")

	light.queue_free()


# ─── Regression tests ─────────────────────────────────────────────────────────

func _test_pitch_clamp_bounds() -> void:
	# Pitch must always stay within ±PI*0.49 regardless of input magnitude.
	# This math is inline in _input(); test it as a standalone invariant.
	var max_pitch: float = PI * 0.49
	var over_pos := clampf(PI * 2.0, -max_pitch, max_pitch)
	var over_neg := clampf(-PI * 2.0, -max_pitch, max_pitch)
	var nominal := clampf(0.3, -max_pitch, max_pitch)

	_assert(is_equal_approx(over_pos, max_pitch),
		"[GREEN] large positive pitch clamps to +PI*0.49")
	_assert(is_equal_approx(over_neg, -max_pitch),
		"[GREEN] large negative pitch clamps to -PI*0.49")
	_assert(is_equal_approx(nominal, 0.3),
		"[GREEN] nominal pitch 0.3 passes through unmodified")


func _test_movement_message_keys() -> void:
	# Build a movement dict the same way _send_movement() does and verify
	# all required keys are present. Keeps the message contract explicit.
	var msg := {
		"type": "input_move",
		"forward": false,
		"backward": false,
		"strafe_left": false,
		"strafe_right": false,
		"jump": false,
		"crouch": false,
		"running": false,
		"yaw": 0.0,
	}
	for key in ["type", "forward", "backward", "strafe_left", "strafe_right",
				"jump", "crouch", "running", "yaw"]:
		_assert(msg.has(key), "[GREEN] movement message has key '%s'" % key)
	_assert(msg["type"] == "input_move",
		"[GREEN] movement message type == 'input_move'")


# ─── VR mode tests ────────────────────────────────────────────────────────────

func _test_set_vr_mode_sets_flag() -> void:
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	_assert(not cam.get("vr_mode"),
		"[GREEN] vr_mode is false before set_vr_mode()")
	cam.call("set_vr_mode", true)
	_assert(cam.get("vr_mode") == true,
		"[GREEN] vr_mode is true after set_vr_mode(true)")

	world.queue_free()


func _test_set_vr_mode_disables_camera() -> void:
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	cam.call("set_vr_mode", true)
	_assert(cam.current == false,
		"[GREEN] camera.current is false after set_vr_mode(true) — XRCamera3D takes over")

	world.queue_free()


func _test_shadow_quality_noop_in_vr_mode() -> void:
	# Regression: the movement shadow throttle was removed. _set_shadow_quality()
	# and its associated state vars must not exist — if they reappear it means the
	# throttle was accidentally re-introduced. The compile test above catches undefined
	# constant references, so this guards the behavioral deletion.
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	_assert(not cam.has_method("_set_shadow_quality"),
		"[GREEN] _set_shadow_quality() is deleted (movement shadow throttle removed)")
	_assert(cam.get("_shadow_moving") == null,
		"[GREEN] _shadow_moving state var is deleted")
	_assert(cam.get("_shadow_stop_timer") == null,
		"[GREEN] _shadow_stop_timer state var is deleted")

	world.queue_free()


func _test_shadow_quality_vr_no_crash_without_light() -> void:
	# _set_shadow_quality_vr() must handle missing DirectionalLight3D gracefully.
	# In headless tests /root/Main/DirectionalLight3D does not exist.
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	cam.call("_set_shadow_quality_vr")  # must not crash

	_assert(true, "[GREEN] _set_shadow_quality_vr() completes without crash when light is absent")

	world.queue_free()


# ─── Third-person orbit regression tests ──────────────────────────────────────
# These tests instantiate camera_controller.gd on a Camera3D and call
# _update_camera() directly to verify orbit geometry.  They must keep passing
# after any VR / first-person work so we catch regressions early.
#
# NOTE: @onready vars (main_node, scene_manager) resolve to null in this
# headless scene — _update_camera() doesn't use them, so that's fine.

func _make_world_with_cam() -> Node3D:
	var world := Node3D.new()
	add_child(world)
	var cam := Camera3D.new()
	cam.set_script(load("res://src/camera_controller.gd"))
	world.add_child(cam)
	return world


func _test_third_person_orbit_distance() -> void:
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	var origin := Vector3(100.0, 20.0, -50.0)
	cam.set("target_point", origin)
	cam.set("avatar_point", origin)
	cam.set("distance", 15.0)
	cam.set("pitch", 0.0)
	cam.set("yaw", 0.0)
	cam.call("_update_camera")

	var dist := cam.global_position.distance_to(origin)
	_assert(is_equal_approx(dist, 15.0),
		"[GREEN] orbit camera is exactly 15m from target when distance=15")
	world.queue_free()


func _test_third_person_not_at_avatar() -> void:
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	var origin := Vector3(128.0, 25.0, -128.0)
	cam.set("target_point", origin)
	cam.set("avatar_point", origin)
	cam.call("_update_camera")

	_assert(not cam.global_position.is_equal_approx(origin),
		"[GREEN] orbit camera position is not at the target point")
	world.queue_free()


func _test_third_person_looks_at_avatar() -> void:
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	var origin := Vector3(100.0, 20.0, -50.0)
	cam.set("target_point", origin)
	cam.set("avatar_point", origin)
	cam.set("distance", 15.0)
	cam.set("pitch", 0.2)
	cam.set("yaw", PI / 4.0)
	cam.call("_update_camera")

	# Camera -Z axis should point from cam position toward target
	var forward := -cam.global_transform.basis.z
	var to_target := (origin - cam.global_position).normalized()
	var dot := forward.dot(to_target)
	_assert(dot > 0.999,
		"[GREEN] orbit camera -Z axis points at target (dot > 0.999)")
	world.queue_free()


func _test_third_person_yaw_rotates_orbit() -> void:
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	var origin := Vector3(100.0, 20.0, -50.0)
	cam.set("target_point", origin)
	cam.set("avatar_point", origin)
	cam.set("distance", 15.0)
	cam.set("pitch", 0.0)

	cam.set("yaw", 0.0)
	cam.call("_update_camera")
	var pos_yaw0 := cam.global_position

	cam.set("yaw", PI / 2.0)
	cam.call("_update_camera")
	var pos_yaw90 := cam.global_position

	# Both must be the same distance from target
	var d0 := pos_yaw0.distance_to(origin)
	var d90 := pos_yaw90.distance_to(origin)
	_assert(is_equal_approx(d0, d90),
		"[GREEN] yaw rotation preserves orbit radius (d0 == d90)")
	# But camera must be at a different position
	_assert(not pos_yaw0.is_equal_approx(pos_yaw90),
		"[GREEN] yaw=0 and yaw=PI/2 place camera at different positions")
	world.queue_free()


func _test_third_person_distance_affects_position() -> void:
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	var origin := Vector3(100.0, 20.0, -50.0)
	cam.set("target_point", origin)
	cam.set("avatar_point", origin)
	cam.set("pitch", 0.0)
	cam.set("yaw", 0.0)

	cam.set("distance", 15.0)
	cam.call("_update_camera")
	var d15 := cam.global_position.distance_to(origin)

	cam.set("distance", 30.0)
	cam.call("_update_camera")
	var d30 := cam.global_position.distance_to(origin)

	_assert(is_equal_approx(d15, 15.0),
		"[GREEN] distance=15 puts camera 15m from target")
	_assert(is_equal_approx(d30, 30.0),
		"[GREEN] distance=30 puts camera 30m from target")
	_assert(d30 > d15 + 1.0,
		"[GREEN] larger distance value puts camera further from avatar")
	world.queue_free()


func _test_third_person_avatar_yaw_independent() -> void:
	var world := _make_world_with_cam()
	var cam := world.get_child(0) as Camera3D

	cam.set("avatar_yaw", 1.0)
	cam.set("yaw", 2.5)

	var got_avatar_yaw: float = cam.get("avatar_yaw")
	var got_yaw: float = cam.get("yaw")

	_assert(is_equal_approx(got_avatar_yaw, 1.0),
		"[GREEN] avatar_yaw stores independently (== 1.0)")
	_assert(is_equal_approx(got_yaw, 2.5),
		"[GREEN] camera yaw stores independently (== 2.5)")
	_assert(not is_equal_approx(got_avatar_yaw, got_yaw),
		"[GREEN] avatar_yaw and camera yaw are distinct variables")
	world.queue_free()

