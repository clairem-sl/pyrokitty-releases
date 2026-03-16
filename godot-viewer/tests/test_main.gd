extends Node

## Tests for main.gd — covers _is_high_priority() only.
## The rest of main.gd (TCP/WebSocket, scene_manager dispatch) requires live
## network state and is not testable headless.
##
## Run headless:
##   cd godot-viewer && GODOT=$(cat godot-version.txt | tr -d '[:space:]') && ./$GODOT/${GODOT}_console.exe \
##     --headless --quit-after 5 --scene tests/test_main.tscn

var _passed := 0
var _failed := 0


func _ready() -> void:
	_passed = 0
	_failed = 0

	_test_script_compiles()
	_test_depth_buffer_enabled()
	_test_avatar_messages_are_high_priority()
	_test_self_id_is_high_priority()
	_test_low_priority_messages()
	_test_40_byte_boundary()

	print("--- main tests: %d passed, %d failed ---" % [_passed, _failed])


# ─── Helpers ──────────────────────────────────────────────────────────────────

func _assert(condition: bool, msg: String) -> void:
	if condition:
		_passed += 1
		print("  PASS: %s" % msg)
	else:
		_failed += 1
		push_error("  FAIL: %s" % msg)


# Instantiate main.gd without adding it to the scene tree so _ready() never
# runs (no TCP listen, no @onready errors).  _is_high_priority() only touches
# its text parameter, so this is safe.
func _make_main() -> Node3D:
	var node := Node3D.new()
	node.set_script(load("res://src/main.gd"))
	return node


func _hi(node: Node3D, text: String) -> bool:
	return node.call("_is_high_priority", text)


# ─── Tests ────────────────────────────────────────────────────────────────────

const FrameBudget = preload("res://src/frame_budget.gd")




func _test_script_compiles() -> void:
	var script = load("res://src/main.gd")
	_assert(script != null, "[GREEN] main.gd compiles without error")


func _test_depth_buffer_enabled() -> void:
	# submit_depth_buffer MUST stay true in override.vr.cfg. Without it the Meta
	# ATW compositor has no depth data and shows black instead of warping the
	# previous frame when the app runs late. See VR_SUCKS.md #1.
	# The setting lives in override.vr.cfg (not project.godot) because it must
	# only be active in VR mode — godot-bridge.ts copies it to override.cfg on
	# VR launches and deletes override.cfg on non-VR launches.
	var f := FileAccess.open("res://override.vr.cfg", FileAccess.READ)
	_assert(f != null, "[GREEN] override.vr.cfg is readable")
	if f == null:
		return
	var content := f.get_as_text()
	f.close()
	_assert("openxr/submit_depth_buffer=true" in content,
		"[GREEN] openxr/submit_depth_buffer=true in override.vr.cfg — required for ATW reprojection")


func _test_avatar_messages_are_high_priority() -> void:
	var m := _make_main()
	_assert(_hi(m, '{"type":"avatar_create","id":"abc"}'),
		'[GREEN] avatar_create is high priority')
	_assert(_hi(m, '{"type":"avatar_update","id":"abc"}'),
		'[GREEN] avatar_update is high priority')
	_assert(_hi(m, '{"type":"avatar_update_batch","updates":[]}'),
		'[GREEN] avatar_update_batch is high priority')
	_assert(_hi(m, '{"type":"avatar_kill","id":"abc"}'),
		'[GREEN] avatar_kill is high priority')


func _test_self_id_is_high_priority() -> void:
	var m := _make_main()
	_assert(_hi(m, '{"type":"self_id","id":"00000000-0000-0000-0000-000000000000"}'),
		'[GREEN] self_id is high priority')


func _test_low_priority_messages() -> void:
	var m := _make_main()
	_assert(not _hi(m, '{"type":"object_create","id":"abc"}'),
		'[GREEN] object_create is low priority')
	_assert(not _hi(m, '{"type":"object_update_batch","updates":[]}'),
		'[GREEN] object_update_batch is low priority')
	_assert(not _hi(m, '{"type":"mesh_ready","id":"abc"}'),
		'[GREEN] mesh_ready is low priority')
	_assert(not _hi(m, '{"type":"texture_ready","id":"abc"}'),
		'[GREEN] texture_ready is low priority')
	_assert(not _hi(m, '{"type":"terrain_ready"}'),
		'[GREEN] terrain_ready is low priority')
	_assert(not _hi(m, ''),
		'[GREEN] empty string is low priority')


func _test_40_byte_boundary() -> void:
	# _is_high_priority only peeks at the first 40 bytes.  A message where
	# "avatar_" is pushed past that boundary is mis-classified as low-priority.
	# This test documents the known limitation so a refactor doesn't silently
	# widen or narrow the window without updating the constant.
	var m := _make_main()

	# 42 chars before the opening quote of "avatar_" — outside the 40-byte window.
	# {"type":"object_create","x":"xxxxxxx","n":"avatar_"}
	var late_avatar := '{"type":"object_create","x":"xxxxxxx","n":"avatar_"}'
	_assert(not _hi(m, late_avatar),
		'[GREEN] "avatar_" past byte 40 is NOT caught by prefix peek (known limit)')

	# Sanity check: same string but avatar type is first field — IS caught.
	var early_avatar := '{"type":"avatar_create","x":"xxxxxxx","n":"other"}'
	_assert(_hi(m, early_avatar),
		'[GREEN] "avatar_" within first 40 bytes IS caught')
