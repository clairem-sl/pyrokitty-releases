extends Node

## Tests for xr_rig.gd
## Run headless:
##   cd godot-viewer && ./Godot_v4.6.1-stable_mono_win64/Godot_v4.6.1-stable_mono_win64_console.exe \
##     --headless --quit-after 5 --scene tests/test_xr_rig.tscn

var _passed := 0
var _failed := 0


func _ready() -> void:
	_passed = 0
	_failed = 0

	_test_script_compiles()
	_test_initial_inactive()
	_test_activate_sets_active_and_visible()
	_test_pose_ignored_when_inactive()
	_test_pose_sets_position()
	_test_pose_sets_yaw()
	_test_pose_only_rotates_y()
	_test_signal_connection_via_activate()

	print("--- xr_rig tests: %d passed, %d failed ---" % [_passed, _failed])


# ─── Helpers ──────────────────────────────────────────────────────────────────

func _assert(condition: bool, msg: String) -> void:
	if condition:
		_passed += 1
		print("  PASS: %s" % msg)
	else:
		_failed += 1
		push_error("  FAIL: %s" % msg)


func _make_rig() -> XROrigin3D:
	var rig := XROrigin3D.new()
	rig.set_script(load("res://src/xr_rig.gd"))
	add_child(rig)
	return rig


func _make_camera_with_signal() -> Camera3D:
	var cam := Camera3D.new()
	cam.set_script(load("res://src/camera_controller.gd"))
	add_child(cam)
	return cam


# ─── Tests ────────────────────────────────────────────────────────────────────

func _test_script_compiles() -> void:
	var script = load("res://src/xr_rig.gd")
	_assert(script != null, "[GREEN] xr_rig.gd compiles without error")


func _test_initial_inactive() -> void:
	var rig := _make_rig()
	_assert(not rig.get("_active"),
		"[GREEN] _active is false before activate()")
	rig.queue_free()


func _test_activate_sets_active_and_visible() -> void:
	var rig := _make_rig()
	var cam := Camera3D.new()
	add_child(cam)

	rig.call("activate", cam)

	_assert(rig.get("_active") == true,
		"[GREEN] _active is true after activate()")
	_assert(rig.visible == true,
		"[GREEN] visible is true after activate()")

	cam.queue_free()
	rig.queue_free()


func _test_pose_ignored_when_inactive() -> void:
	# _on_pose_updated must be a no-op when _active is false.
	var rig := _make_rig()
	var original_pos := rig.global_position

	rig.call("_on_pose_updated", Vector3(100.0, 50.0, -200.0), PI)

	_assert(rig.global_position.is_equal_approx(original_pos),
		"[GREEN] global_position unchanged when _active=false")
	rig.queue_free()


func _test_pose_sets_position() -> void:
	var rig := _make_rig()
	var cam := Camera3D.new()
	add_child(cam)
	rig.call("activate", cam)

	var eye_pos := Vector3(10.0, 1.7, -5.0)
	rig.call("_on_pose_updated", eye_pos, 0.0)

	_assert(rig.global_position.is_equal_approx(eye_pos),
		"[GREEN] global_position == eye_pos after _on_pose_updated")

	cam.queue_free()
	rig.queue_free()


func _test_pose_sets_yaw() -> void:
	var rig := _make_rig()
	var cam := Camera3D.new()
	add_child(cam)
	rig.call("activate", cam)

	var yaw := PI / 3.0
	rig.call("_on_pose_updated", Vector3.ZERO, yaw)

	_assert(is_equal_approx(rig.rotation.y, yaw),
		"[GREEN] rotation.y == yaw after _on_pose_updated")

	cam.queue_free()
	rig.queue_free()


func _test_pose_only_rotates_y() -> void:
	# The rig must never pitch or roll — only yaw around Y.
	var rig := _make_rig()
	var cam := Camera3D.new()
	add_child(cam)
	rig.call("activate", cam)

	rig.call("_on_pose_updated", Vector3.ZERO, PI / 4.0)

	_assert(is_equal_approx(rig.rotation.x, 0.0),
		"[GREEN] rotation.x == 0 (no pitch) after _on_pose_updated")
	_assert(is_equal_approx(rig.rotation.z, 0.0),
		"[GREEN] rotation.z == 0 (no roll) after _on_pose_updated")

	cam.queue_free()
	rig.queue_free()


func _test_signal_connection_via_activate() -> void:
	# activate() must connect camera_controller's xr_pose_updated signal so
	# emitting it drives the rig without calling _on_pose_updated directly.
	# NOTE: camera_controller's @onready vars (/root/Main, ../SceneManager)
	# log "Node not found" errors in this headless scene — that's expected and
	# does not affect the signal or this test.
	var rig := _make_rig()
	var cam := _make_camera_with_signal()
	rig.call("activate", cam)

	var eye_pos := Vector3(7.0, 1.8, -3.0)
	cam.emit_signal("xr_pose_updated", eye_pos, 0.5)

	_assert(rig.global_position.is_equal_approx(eye_pos),
		"[GREEN] xr_pose_updated signal drives rig position")
	_assert(is_equal_approx(rig.rotation.y, 0.5),
		"[GREEN] xr_pose_updated signal drives rig yaw")

	cam.queue_free()
	rig.queue_free()
