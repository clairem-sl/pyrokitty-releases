extends Node

## Tests for attachment point Euler-to-quaternion conversion and AP world transform.
## Verifies _sl_euler_to_godot_quat matches SL's LLQuaternion::setQuat(roll,pitch,yaw)
## from llquaternion.cpp:295, with axis swap to Godot coordinates.
##
## Run headless:
##   cd godot-viewer && GODOT=$(cat godot-version.txt | tr -d '[:space:]') && ./$GODOT/${GODOT}_console.exe \
##     --headless --quit-after 5 --scene tests/test_attachment_points.tscn

const AnimMgr = preload("res://src/animation_manager.gd")

var _passed := 0
var _failed := 0


func _ready() -> void:
	_passed = 0
	_failed = 0

	_test_identity()
	_test_single_axis_yaw_90()
	_test_chest_ap1()
	_test_spine_ap9()
	_test_arbitrary_euler()
	_test_negative_angles()
	_test_all_ap_rotations_vs_sl()

	print("--- attachment_point tests: %d passed, %d failed ---" % [_passed, _failed])


func _assert(condition: bool, msg: String) -> void:
	if condition:
		_passed += 1
		print("  PASS: %s" % msg)
	else:
		_failed += 1
		push_error("  FAIL: %s" % msg)


## Compare two quaternions allowing for sign flip (q and -q are the same rotation).
func _quat_approx_eq(a: Quaternion, b: Quaternion, eps: float = 0.001) -> bool:
	var d := a.dot(b)
	return absf(d) > 1.0 - eps


## Compute the SL quaternion from Euler angles using SL's exact formula
## (LLQuaternion::setQuat from llquaternion.cpp:295-311).
## Returns the SL quaternion (x, y, z, w) in SL coordinate space.
func _sl_setquat(roll_rad: float, pitch_rad: float, yaw_rad: float) -> Array:
	var r := roll_rad * 0.5
	var p := pitch_rad * 0.5
	var y := yaw_rad * 0.5
	var sx := sin(r); var cx := cos(r)
	var sy := sin(p); var cy := cos(p)
	var sz := sin(y); var cz := cos(y)
	var w := cx * cy * cz - sx * sy * sz
	var x := sx * cy * cz + cx * sy * sz
	var yy := cx * sy * cz - sx * cy * sz
	var z := cx * cy * sz + sx * sy * cz
	return [x, yy, z, w]


## Convert an SL quaternion [x,y,z,w] to Godot quaternion via axis swap.
func _sl_quat_to_godot(sq: Array) -> Quaternion:
	return Quaternion(sq[0], sq[2], -sq[1], sq[3]).normalized()


# ─── Tests ────────────────────────────────────────────────────────────────────


func _test_identity() -> void:
	var q := AnimMgr._sl_euler_to_godot_quat(0, 0, 0)
	_assert(_quat_approx_eq(q, Quaternion.IDENTITY), "identity Euler → identity quaternion")


func _test_single_axis_yaw_90() -> void:
	# AP 2 (Skull): rot=(0, 0, 90) — single-axis, cross terms are zero
	var q := AnimMgr._sl_euler_to_godot_quat(0, 0, 90)
	var sl := _sl_setquat(0, 0, deg_to_rad(90))
	var expected := _sl_quat_to_godot(sl)
	_assert(_quat_approx_eq(q, expected),
		"Skull AP (0,0,90): got %s expected %s" % [str(q), str(expected)])


func _test_chest_ap1() -> void:
	# AP 1 (Chest): rot=(0, 90, 90) — dual-axis, exercises cross terms
	var q := AnimMgr._sl_euler_to_godot_quat(0, 90, 90)
	var sl := _sl_setquat(0, deg_to_rad(90), deg_to_rad(90))
	var expected := _sl_quat_to_godot(sl)
	_assert(_quat_approx_eq(q, expected),
		"Chest AP (0,90,90): got %s expected %s" % [str(q), str(expected)])


func _test_spine_ap9() -> void:
	# AP 9 (Spine): rot=(0, -90, 90) — dual-axis with negative pitch
	var q := AnimMgr._sl_euler_to_godot_quat(0, -90, 90)
	var sl := _sl_setquat(0, deg_to_rad(-90), deg_to_rad(90))
	var expected := _sl_quat_to_godot(sl)
	_assert(_quat_approx_eq(q, expected),
		"Spine AP (0,-90,90): got %s expected %s" % [str(q), str(expected)])


func _test_arbitrary_euler() -> void:
	# Arbitrary three-axis rotation — all cross terms non-zero
	var q := AnimMgr._sl_euler_to_godot_quat(30, 45, 60)
	var sl := _sl_setquat(deg_to_rad(30), deg_to_rad(45), deg_to_rad(60))
	var expected := _sl_quat_to_godot(sl)
	_assert(_quat_approx_eq(q, expected),
		"arbitrary (30,45,60): got %s expected %s" % [str(q), str(expected)])


func _test_negative_angles() -> void:
	var q := AnimMgr._sl_euler_to_godot_quat(-45, -30, -60)
	var sl := _sl_setquat(deg_to_rad(-45), deg_to_rad(-30), deg_to_rad(-60))
	var expected := _sl_quat_to_godot(sl)
	_assert(_quat_approx_eq(q, expected),
		"negative (-45,-30,-60): got %s expected %s" % [str(q), str(expected)])


func _test_all_ap_rotations_vs_sl() -> void:
	# Test every AP rotation from avatar_lad.xml against SL's setQuat
	var ap_rotations: Dictionary = {
		"Chest(1)":    Vector3(0, 90, 90),
		"Skull(2)":    Vector3(0, 0, 90),
		"Spine(9)":    Vector3(0, -90, 90),
	}
	for label: String in ap_rotations:
		var euler: Vector3 = ap_rotations[label]
		var q := AnimMgr._sl_euler_to_godot_quat(euler.x, euler.y, euler.z)
		var sl := _sl_setquat(deg_to_rad(euler.x), deg_to_rad(euler.y), deg_to_rad(euler.z))
		var expected := _sl_quat_to_godot(sl)
		_assert(_quat_approx_eq(q, expected),
			"AP %s (%s): got %s expected %s" % [label, str(euler), str(q), str(expected)])
