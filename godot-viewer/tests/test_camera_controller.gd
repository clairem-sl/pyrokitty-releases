extends Node

## Tests for camera_controller.gd — verifies the script compiles and that
## DirectionalLight3D shadow API used by _set_shadow_quality() is correct.
## Run headless:
##   cd godot-viewer && ./Godot_v4.6.1-stable_mono_win64/Godot_v4.6.1-stable_mono_win64_console.exe \
##     --headless --quit-after 5 --scene tests/test_camera_controller.tscn

var _passed := 0
var _failed := 0


func _ready() -> void:
	_passed = 0
	_failed = 0

	_test_script_compiles()
	_test_shadow_mode_constants()
	_test_shadow_properties()

	print("--- camera_controller tests: %d passed, %d failed ---" % [_passed, _failed])


# ─── Helpers ──────────────────────────────────────

func _assert(condition: bool, msg: String) -> void:
	if condition:
		_passed += 1
		print("  PASS: %s" % msg)
	else:
		_failed += 1
		push_error("  FAIL: %s" % msg)


# ─── Tests ────────────────────────────────────────

func _test_script_compiles() -> void:
	# load() returns null (and prints an error) if the script has a compile error.
	# Using load() at runtime rather than preload() at parse time so that a failure
	# prints a proper test-failure line rather than aborting the whole test scene.
	var script = load("res://src/camera_controller.gd")
	_assert(script != null, "camera_controller.gd compiles without error")


func _test_shadow_mode_constants() -> void:
	# Verify the enum constants that _set_shadow_quality() uses.
	# Note: Godot 4 uses SHADOW_PARALLEL_2_SPLITS / SHADOW_PARALLEL_4_SPLITS
	# (not SHADOW_PARALLEL_SPLITS_2 / _4 as the C++ docs might imply).
	_assert(DirectionalLight3D.SHADOW_ORTHOGONAL == 0,
		"SHADOW_ORTHOGONAL == 0")
	_assert(DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS == 1,
		"SHADOW_PARALLEL_2_SPLITS == 1")
	_assert(DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS == 2,
		"SHADOW_PARALLEL_4_SPLITS == 2")


func _test_shadow_properties() -> void:
	# Verify that directional_shadow_mode and directional_shadow_max_distance
	# exist as writable properties and round-trip through the values that
	# _set_shadow_quality() uses.
	var light := DirectionalLight3D.new()
	add_child(light)
	light.shadow_enabled = true

	light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	light.directional_shadow_max_distance = 40.0
	_assert(light.directional_shadow_mode == DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS,
		"directional_shadow_mode = SHADOW_PARALLEL_2_SPLITS round-trips")
	_assert(is_equal_approx(light.directional_shadow_max_distance, 40.0),
		"directional_shadow_max_distance = 40.0 round-trips")

	light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	light.directional_shadow_max_distance = 100.0
	_assert(light.directional_shadow_mode == DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS,
		"directional_shadow_mode = SHADOW_PARALLEL_4_SPLITS round-trips")
	_assert(is_equal_approx(light.directional_shadow_max_distance, 100.0),
		"directional_shadow_max_distance = 100.0 round-trips")

	light.queue_free()
