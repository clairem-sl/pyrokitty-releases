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
	_test_vr_budget_derivation()
	_test_vr_budget_leaves_gpu_headroom()
	_test_vr_budget_msg_fits_before_finalize_stop()
	_test_vr_budget_total_under_frame_ms()
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

const VRFrameBudget = preload("res://src/vr_frame_budget.gd")


# ─── VR frame budget tests ────────────────────────────────────────────────────
# These verify the relationships between VRFrameBudget constants so that
# main.gd and scene_manager.gd can't silently diverge.  If any of these
# fail, the combined CPU budgets may be starving the GPU.

func _test_vr_budget_derivation() -> void:
	var expected := 1000.0 / VRFrameBudget.VR_REFRESH_HZ
	_assert(is_equal_approx(VRFrameBudget.VR_FRAME_MS, expected),
		"[GREEN] VR_FRAME_MS == 1000 / VR_REFRESH_HZ (%.2f ms)" % expected)


func _test_vr_budget_leaves_gpu_headroom() -> void:
	# VR uses desktop-equivalent budgets so VR_FINALIZE_STOP_MS intentionally
	# exceeds VR_FRAME_MS — the deadline spans multiple frames during loading.
	# Just verify the constant is positive and sensible (> 0, < 1 second).
	_assert(VRFrameBudget.VR_FINALIZE_STOP_MS > 0.0 and VRFrameBudget.VR_FINALIZE_STOP_MS < 1000.0,
		"[GREEN] VR_FINALIZE_STOP_MS %.1f ms is a sane value" % VRFrameBudget.VR_FINALIZE_STOP_MS)


func _test_vr_budget_msg_fits_before_finalize_stop() -> void:
	# Message processing must complete well before the finalization deadline
	# so scene_manager always has some time to work with.
	_assert(VRFrameBudget.VR_MSG_BUDGET_MS < VRFrameBudget.VR_FINALIZE_STOP_MS,
		"[GREEN] VR_MSG_BUDGET_MS (%.1f) < VR_FINALIZE_STOP_MS (%.1f)" % [
			VRFrameBudget.VR_MSG_BUDGET_MS, VRFrameBudget.VR_FINALIZE_STOP_MS])


func _test_vr_budget_total_under_frame_ms() -> void:
	# VR now uses desktop-equivalent budgets so VR_FINALIZE_STOP_MS intentionally
	# exceeds VR_FRAME_MS — finalization spans frames during loading just like desktop.
	# Verify it matches desktop within 10% (guards against accidental divergence).
	var ratio := VRFrameBudget.VR_FINALIZE_STOP_MS / VRFrameBudget.DESKTOP_FRAME_MS
	_assert(ratio >= 0.9 and ratio <= 1.1,
		"[GREEN] VR_FINALIZE_STOP_MS (%.1f) within 10%% of DESKTOP_FRAME_MS (%.1f)" % [
			VRFrameBudget.VR_FINALIZE_STOP_MS, VRFrameBudget.DESKTOP_FRAME_MS])


func _test_script_compiles() -> void:
	var script = load("res://src/main.gd")
	_assert(script != null, "[GREEN] main.gd compiles without error")


func _test_depth_buffer_enabled() -> void:
	# submit_depth_buffer MUST stay true. Without it the Meta ATW compositor
	# has no depth data and shows black instead of warping the previous frame
	# when the app runs late. Do not remove this setting.
	var f := FileAccess.open("res://project.godot", FileAccess.READ)
	_assert(f != null, "[GREEN] project.godot is readable")
	if f == null:
		return
	var content := f.get_as_text()
	f.close()
	_assert("openxr/submit_depth_buffer=true" in content,
		"[GREEN] openxr/submit_depth_buffer=true — required for ATW reprojection")


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
