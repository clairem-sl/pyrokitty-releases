extends Node

## Tests for prim_mesh_generator.gd
## Verifies face ordering, normals, and vertex positions for known shapes.
## Run: attach to a Node in a scene and check Output panel, or run from editor.

const PrimMeshGeneratorScript = preload("res://src/prim_mesh_generator.gd")

var generator: RefCounted
var _passed := 0
var _failed := 0


func _ready() -> void:
	generator = PrimMeshGeneratorScript.new()
	_passed = 0
	_failed = 0

	_test_box_surface_count()
	_test_box_cap_normals()
	_test_box_side_normals()
	_test_box_vertex_bounds()
	_test_cylinder_surface_count()
	_test_cylinder_cap_normals()
	_test_sphere_surface_count()
	_test_prism_surface_count()
	_test_torus_surface_count()
	_test_cache_dedup()
	_test_coordinate_roundtrip()
	_test_uv_offset_formula()
	_test_uv_rotation_v_flip()
	_test_cap_uv_formula_roundtrip()
	_test_box_cap_uv_values()
	_test_hollow_box_surface_count()
	_test_hollow_box_cap_normals()
	_test_hollow_box_circle_cap_normals()
	_test_hollow_box_inner_side_normal()

	print("--- prim_mesh tests: %d passed, %d failed ---" % [_passed, _failed])


# ─── Helpers ──────────────────────────────────────

func _assert(condition: bool, msg: String) -> void:
	if condition:
		_passed += 1
	else:
		_failed += 1
		push_error("FAIL: %s" % msg)


func _assert_eq(actual, expected, msg: String) -> void:
	_assert(actual == expected, "%s: expected %s, got %s" % [msg, str(expected), str(actual)])


func _assert_near(actual: float, expected: float, tolerance: float, msg: String) -> void:
	_assert(absf(actual - expected) <= tolerance,
		"%s: expected ~%.3f, got %.3f (tol=%.3f)" % [msg, expected, actual, tolerance])


func _assert_vec3_near(actual: Vector3, expected: Vector3, tolerance: float, msg: String) -> void:
	var dist := actual.distance_to(expected)
	_assert(dist <= tolerance,
		"%s: expected %s, got %s (dist=%.4f)" % [msg, str(expected), str(actual), dist])


func _assert_vec2_near(actual: Vector2, expected: Vector2, tolerance: float, msg: String) -> void:
	var dist := actual.distance_to(expected)
	_assert(dist <= tolerance,
		"%s: expected %s, got %s (dist=%.4f)" % [msg, str(expected), str(actual), dist])


func _avg_normal(mesh: ArrayMesh, surface_idx: int) -> Vector3:
	var arrays := mesh.surface_get_arrays(surface_idx)
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	var sum := Vector3.ZERO
	for n in normals:
		sum += n
	return sum.normalized()


func _vertex_bounds(mesh: ArrayMesh, surface_idx: int) -> Array:
	## Returns [min_vertex, max_vertex] AABB corners
	var arrays := mesh.surface_get_arrays(surface_idx)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var vmin := Vector3(INF, INF, INF)
	var vmax := Vector3(-INF, -INF, -INF)
	for v in verts:
		vmin.x = minf(vmin.x, v.x)
		vmin.y = minf(vmin.y, v.y)
		vmin.z = minf(vmin.z, v.z)
		vmax.x = maxf(vmax.x, v.x)
		vmax.y = maxf(vmax.y, v.y)
		vmax.z = maxf(vmax.z, v.z)
	return [vmin, vmax]


func _default_box() -> Dictionary:
	return {"pathCurve": 16, "profileCurve": 1}


func _default_cylinder() -> Dictionary:
	return {"pathCurve": 16, "profileCurve": 0}


func _default_sphere() -> Dictionary:
	return {"pathCurve": 32, "profileCurve": 5}


func _default_prism() -> Dictionary:
	return {"pathCurve": 16, "profileCurve": 3}


func _default_torus() -> Dictionary:
	return {"pathCurve": 32, "profileCurve": 0}


# ─── Box Tests ────────────────────────────────────

func _make_mesh(shape: Dictionary) -> ArrayMesh:
	return generator.get_or_generate(shape) as ArrayMesh


func _test_box_surface_count() -> void:
	var mesh := _make_mesh(_default_box())
	_assert_eq(mesh.get_surface_count(), 6, "box surface count")


func _test_box_cap_normals() -> void:
	var mesh := _make_mesh(_default_box())
	# Surface 0 = TE face 0 = top of box (renders at last path step, Y+).
	# Reversed winding → +Y normal via Godot's generate_normals.
	var n0 := _avg_normal(mesh, 0)
	_assert_vec3_near(n0, Vector3(0, 1, 0), 0.01, "box surface 0 (top) normal → up")

	# Surface 5 = TE face 5 = bottom of box (renders at first path step, Y-).
	# Forward winding → -Y normal.
	var n5 := _avg_normal(mesh, 5)
	_assert_vec3_near(n5, Vector3(0, -1, 0), 0.01, "box surface 5 (bottom) normal → down")


func _test_box_side_normals() -> void:
	var mesh := _make_mesh(_default_box())

	# Side normals should be in the XZ plane (horizontal), no Y component.
	# The 4 sides point in the 4 cardinal directions.
	# Collect and sort by angle to verify all 4 are present.
	var side_normals: Array[Vector3] = []
	for i in range(1, 5):
		var n := _avg_normal(mesh, i)
		_assert_near(n.y, 0.0, 0.05, "box side %d normal Y component" % i)
		side_normals.append(n)

	# Verify the 4 normals point in roughly orthogonal directions.
	# Each pair of adjacent sides should be ~90° apart.
	# Each pair of opposite sides should be ~180° apart.
	for i in 4:
		for j in range(i + 1, 4):
			var dot := side_normals[i].dot(side_normals[j])
			# Should be ~0 (perpendicular) or ~-1 (opposite), never ~+1
			_assert(dot < 0.5, "box sides %d,%d not parallel (dot=%.2f)" % [i + 1, j + 1, dot])

	# Verify specific directions (in Godot space):
	# Side 0 (surface 1): SL -Y face → Godot +Z
	# Side 1 (surface 2): SL +X face → Godot +X
	# Side 2 (surface 3): SL +Y face → Godot -Z
	# Side 3 (surface 4): SL -X face → Godot -X
	_assert_vec3_near(side_normals[0], Vector3(0, 0, 1), 0.05, "box side 0 normal → +Z")
	_assert_vec3_near(side_normals[1], Vector3(1, 0, 0), 0.05, "box side 1 normal → +X")
	_assert_vec3_near(side_normals[2], Vector3(0, 0, -1), 0.05, "box side 2 normal → -Z")
	_assert_vec3_near(side_normals[3], Vector3(-1, 0, 0), 0.05, "box side 3 normal → -X")


func _test_box_vertex_bounds() -> void:
	var mesh := _make_mesh(_default_box())

	# Surface 0 = TE face 0 = top of box (Y ≈ +0.5)
	var bounds0 := _vertex_bounds(mesh, 0)
	_assert_near(bounds0[0].y, 0.5, 0.01, "box top cap (surface 0) min Y")
	_assert_near(bounds0[1].y, 0.5, 0.01, "box top cap (surface 0) max Y")

	# Surface 5 = TE face 5 = bottom of box (Y ≈ -0.5)
	var bounds5 := _vertex_bounds(mesh, 5)
	_assert_near(bounds5[0].y, -0.5, 0.01, "box bottom cap (surface 5) min Y")
	_assert_near(bounds5[1].y, -0.5, 0.01, "box bottom cap (surface 5) max Y")

	# All surfaces combined should fit in a unit box [-0.5, 0.5]³
	for i in 6:
		var b := _vertex_bounds(mesh, i)
		_assert(b[0].x >= -0.51 and b[1].x <= 0.51, "box surface %d X in bounds" % i)
		_assert(b[0].y >= -0.51 and b[1].y <= 0.51, "box surface %d Y in bounds" % i)
		_assert(b[0].z >= -0.51 and b[1].z <= 0.51, "box surface %d Z in bounds" % i)


# ─── Cylinder Tests ───────────────────────────────

func _test_cylinder_surface_count() -> void:
	var mesh := _make_mesh(_default_cylinder())
	_assert_eq(mesh.get_surface_count(), 3, "cylinder surface count")


func _test_cylinder_cap_normals() -> void:
	var mesh := _make_mesh(_default_cylinder())
	# Surface 0 = TE face 0 = top cap, last surface = TE bottom cap (surface 1 = outer side)
	var n0 := _avg_normal(mesh, 0)
	_assert_vec3_near(n0, Vector3(0, 1, 0), 0.05, "cylinder top cap (surface 0) normal → up")

	var n_last := _avg_normal(mesh, mesh.get_surface_count() - 1)
	_assert_vec3_near(n_last, Vector3(0, -1, 0), 0.05, "cylinder bottom cap (last surface) normal → down")


# ─── Sphere Tests ─────────────────────────────────

func _test_sphere_surface_count() -> void:
	var mesh := _make_mesh(_default_sphere())
	# Sphere (half-circle profile + circular path) = 1 face (closed path, no caps)
	_assert_eq(mesh.get_surface_count(), 1, "sphere surface count")


# ─── Prism Tests ──────────────────────────────────

func _test_prism_surface_count() -> void:
	var mesh := _make_mesh(_default_prism())
	# Prism = triangle profile + linear path: 2 caps + 3 sides = 5
	_assert_eq(mesh.get_surface_count(), 5, "prism surface count")


# ─── Torus Tests ──────────────────────────────────

func _test_torus_surface_count() -> void:
	var mesh := _make_mesh(_default_torus())
	# Torus = circle profile + circular path: no caps (both closed) = 1 face
	_assert_eq(mesh.get_surface_count(), 1, "torus surface count")


# ─── Cache Tests ──────────────────────────────────

func _test_cache_dedup() -> void:
	var gen := PrimMeshGeneratorScript.new()
	var mesh1 := gen.get_or_generate(_default_box()) as ArrayMesh
	var mesh2 := gen.get_or_generate(_default_box()) as ArrayMesh
	_assert(mesh1 == mesh2, "cache returns same mesh for identical params")
	_assert_eq(gen.get_cache_size(), 1, "cache size after duplicate request")


# ─── Coordinate Roundtrip ────────────────────────

func _test_coordinate_roundtrip() -> void:
	# _sl_to_godot: (x, y, z) → (x, z, -y)
	# Inverse (godot_to_sl): (x, y, z) → (x, -z, y)
	# Roundtrip should be identity.
	var test_points := [
		Vector3(1, 2, 3),
		Vector3(-0.5, 0.3, 0.7),
		Vector3(0, 0, 0),
	]
	for sl_orig in test_points:
		var godot := Vector3(sl_orig.x, sl_orig.z, -sl_orig.y)  # _sl_to_godot
		var sl_back := Vector3(godot.x, -godot.z, godot.y)       # shader's godot_to_sl
		_assert_vec3_near(sl_back, sl_orig, 0.0001,
			"coordinate roundtrip for %s" % str(sl_orig))


# ─── UV Transform Tests ─────────────────────────

## Reference implementation of SL's xform() (llface.cpp:763-787)
func _sl_xform(sl_uv: Vector2, rpt: Vector2, off: Vector2, rot: float) -> Vector2:
	var uv := sl_uv - Vector2(0.5, 0.5)
	var cr := cos(rot)
	var sr := sin(rot)
	uv = Vector2(uv.x * cr + uv.y * sr, -uv.x * sr + uv.y * cr)
	uv *= rpt
	uv += off + Vector2(0.5, 0.5)
	return uv


func _test_uv_offset_formula() -> void:
	# Verify StandardMaterial3D offset formula (rotation=0) matches SL xform.
	# Godot mesh UVs have V flipped (1-v) relative to SL, so:
	#   godot_offset = (sl_offset_u + 0.5*(1-ru), -sl_offset_v + 0.5*(1-rv))
	var rpt := Vector2(2.0, 0.5)
	var off := Vector2(0.3, -0.2)
	var test_uvs: Array[Vector2] = [Vector2(0.0, 0.0), Vector2(0.5, 0.5), Vector2(0.25, 0.75)]

	for godot_uv: Vector2 in test_uvs:
		# Reference: Godot → SL → xform → Godot
		var sl_uv := Vector2(godot_uv.x, 1.0 - godot_uv.y)
		var sl_result := _sl_xform(sl_uv, rpt, off, 0.0)
		var expected := Vector2(sl_result.x, 1.0 - sl_result.y)

		# StandardMaterial3D formula: uv * scale + offset
		var mat_result := godot_uv * rpt + Vector2(
			off.x + 0.5 * (1.0 - rpt.x),
			-off.y + 0.5 * (1.0 - rpt.y))

		_assert_vec2_near(mat_result, expected, 0.001,
			"UV offset formula for godot_uv %s" % str(godot_uv))


func _test_uv_rotation_v_flip() -> void:
	# Verify the shader's V-flip conversion is needed: applying SL's xform
	# directly to Godot UVs (without V flip) gives wrong results with rotation.
	var rpt := Vector2(0.243, 0.1)
	var off := Vector2(-0.382, 0.473)
	var rot := PI / 2.0
	var godot_uv := Vector2(0.3, 0.8)

	# Correct path: Godot → SL → xform → Godot (what the shader does)
	var sl_uv := Vector2(godot_uv.x, 1.0 - godot_uv.y)
	var sl_result := _sl_xform(sl_uv, rpt, off, rot)
	var correct := Vector2(sl_result.x, 1.0 - sl_result.y)

	# Wrong path: apply xform directly to Godot UV (the old bug)
	var wrong := _sl_xform(godot_uv, rpt, off, rot)

	_assert(correct.distance_to(wrong) > 0.01,
		"V-flip produces different result than no flip (dist=%.4f)" % correct.distance_to(wrong))


func _test_cap_uv_formula_roundtrip() -> void:
	# Verify _cap_uv_from_profile produces Godot-convention UVs that, when
	# V-flipped by the shader (1.0 - UV.y), recover the correct SL UVs.
	#
	# SL cap UV formulas (llvolume.cpp createUnCutCubeCap):
	#   Base (bottom): U = p.x + 0.5, V = 0.5 - p.y
	#   Top (swapped): U = p.x + 0.5, V = p.y + 0.5
	var corners := [
		Vector3(-0.5, -0.5, 0),
		Vector3(0.5, -0.5, 1),
		Vector3(0.5, 0.5, 2),
		Vector3(-0.5, 0.5, 3),
	]

	for p: Vector3 in corners:
		var sl_u := p.x + 0.5
		var sl_v_top := p.y + 0.5
		var sl_v_bottom := 0.5 - p.y

		# _cap_uv_from_profile returns Godot convention (V flipped from SL)
		var godot_top: Vector2 = generator._cap_uv_from_profile(p, true)
		var godot_bottom: Vector2 = generator._cap_uv_from_profile(p, false)

		# Shader recovers SL UV via: 1.0 - UV.y
		var recovered_top := Vector2(godot_top.x, 1.0 - godot_top.y)
		var recovered_bottom := Vector2(godot_bottom.x, 1.0 - godot_bottom.y)

		_assert_vec2_near(recovered_top, Vector2(sl_u, sl_v_top), 0.001,
			"cap UV roundtrip (top) for p=%s" % str(p))
		_assert_vec2_near(recovered_bottom, Vector2(sl_u, sl_v_bottom), 0.001,
			"cap UV roundtrip (bottom) for p=%s" % str(p))


func _uv_at_nearest_vertex(mesh: ArrayMesh, surface_idx: int, target: Vector3) -> Vector2:
	var arrays := mesh.surface_get_arrays(surface_idx)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
	var best_dist := INF
	var best_uv := Vector2.ZERO
	for i in verts.size():
		var d := verts[i].distance_to(target)
		if d < best_dist:
			best_dist = d
			best_uv = uvs[i]
	return best_uv


func _test_box_cap_uv_values() -> void:
	# Extract UVs from actual mesh cap surfaces and verify at known corners.
	# This catches both formula bugs AND bugs in how the formula is applied
	# during cap triangulation.
	#
	# Box profile corners (SL space): (-0.5,-0.5), (0.5,-0.5), (0.5,0.5), (-0.5,0.5)
	# After _sl_to_godot, top cap (Y=+0.5), bottom cap (Y=-0.5).
	var mesh := _make_mesh(_default_box())

	# SL corner (-0.5, -0.5) on top cap → Godot pos (-0.5, 0.5, 0.5)
	# Top UV:    (0, 0.5-(-0.5)) = (0, 1.0)   — Godot convention
	# Bottom UV: (0, (-0.5)+0.5) = (0, 0.0)   — Godot convention
	var uv_top := _uv_at_nearest_vertex(mesh, 0, Vector3(-0.5, 0.5, 0.5))
	_assert_vec2_near(uv_top, Vector2(0.0, 1.0), 0.01,
		"top cap mesh UV at SL corner (-0.5,-0.5)")

	var uv_bottom := _uv_at_nearest_vertex(mesh, 5, Vector3(-0.5, -0.5, 0.5))
	_assert_vec2_near(uv_bottom, Vector2(0.0, 0.0), 0.01,
		"bottom cap mesh UV at SL corner (-0.5,-0.5)")

	# SL corner (0.5, 0.5) on top cap → Godot pos (0.5, 0.5, -0.5)
	# Top UV:    (1, 0.5-0.5) = (1, 0.0)
	# Bottom UV: (1, 0.5+0.5) = (1, 1.0)
	var uv_top2 := _uv_at_nearest_vertex(mesh, 0, Vector3(0.5, 0.5, -0.5))
	_assert_vec2_near(uv_top2, Vector2(1.0, 0.0), 0.01,
		"top cap mesh UV at SL corner (0.5,0.5)")

	var uv_bottom2 := _uv_at_nearest_vertex(mesh, 5, Vector3(0.5, -0.5, -0.5))
	_assert_vec2_near(uv_bottom2, Vector2(1.0, 1.0), 0.01,
		"bottom cap mesh UV at SL corner (0.5,0.5)")


# ─── Hollow Box Tests ────────────────────────────
#
# Surface order for a hollow box (linear path, full cut, no profile cut):
#   0  = top cap    (face_id 0, PATH_BEGIN, last path step → Y=+0.5)
#   1-4 = outer sides (face_id 5-8)
#   5  = inner wall (face_id 2, INNER_SIDE)
#   6  = bottom cap (face_id 1, PATH_END, first path step → Y=-0.5)


func _test_hollow_box_surface_count() -> void:
	var mesh := _make_mesh({"pathCurve": 16, "profileCurve": 1, "profileHollow": 0.5})
	# top + 4 outer sides + inner wall + bottom = 7
	_assert_eq(mesh.get_surface_count(), 7, "hollow box (same hollow) surface count")


func _test_hollow_box_cap_normals() -> void:
	# This is the regression test for the _build_hollow_cap winding bug.
	# use_a triangles (outer edge + inner pt) are CW from +Y.
	# use_b triangles (outer pt + inner edge) are CCW from +Y.
	# Before the fix, use_b got the same winding reversal as use_a, giving half
	# the cap triangles the wrong normal. The average normal would be near zero.
	# After the fix (reverse when is_top == use_a), all triangles agree.
	var mesh := _make_mesh({"pathCurve": 16, "profileCurve": 1, "profileHollow": 0.5})

	var n_top := _avg_normal(mesh, 0)
	_assert_vec3_near(n_top, Vector3(0, 1, 0), 0.05,
		"hollow box top cap (surface 0) normal → +Y")

	var n_bottom := _avg_normal(mesh, 6)
	_assert_vec3_near(n_bottom, Vector3(0, -1, 0), 0.05,
		"hollow box bottom cap (surface 6) normal → -Y")

	# Regression test for the faces[0].count override bug: if the override reverts,
	# the top cap only renders the outer ring (4 corners at XZ dist ≈ 0.707).
	# With the hollow inner ring present, some vertices are at XZ dist ≈ 0.354.
	# Threshold 0.5 cleanly separates hollow (0.354) from solid-only (0.707).
	var top_arrays := mesh.surface_get_arrays(0)
	var top_verts: PackedVector3Array = top_arrays[Mesh.ARRAY_VERTEX]
	var min_xz_dist := INF
	for v in top_verts:
		min_xz_dist = minf(min_xz_dist, Vector2(v.x, v.z).length())
	_assert(min_xz_dist < 0.5,
		"hollow box top cap has inner ring vertices (min XZ dist=%.3f)" % min_xz_dist)


func _test_hollow_box_circle_cap_normals() -> void:
	# Same regression check with circle hollow (profileCurve = HOLE_CIRCLE | PROFILE_SQUARE = 0x11 = 17).
	# Circle hollow produces more vertices and more two-pointer steps, exercising
	# the use_b path more heavily.
	var mesh := _make_mesh({"pathCurve": 16, "profileCurve": 17, "profileHollow": 0.5})

	var n_top := _avg_normal(mesh, 0)
	_assert_vec3_near(n_top, Vector3(0, 1, 0), 0.05,
		"hollow box (circle hollow) top cap normal → +Y")

	var n_bottom := _avg_normal(mesh, mesh.get_surface_count() - 1)
	_assert_vec3_near(n_bottom, Vector3(0, -1, 0), 0.05,
		"hollow box (circle hollow) bottom cap normal → -Y")


func _test_hollow_box_inner_side_normal() -> void:
	# Inner wall (surface 5) faces inward — normal must be horizontal (Y ≈ 0).
	# The four inner faces average to near zero in XZ (cancel out), but each
	# individual face should have no Y component.
	var mesh := _make_mesh({"pathCurve": 16, "profileCurve": 1, "profileHollow": 0.5})
	var arrays := mesh.surface_get_arrays(5)
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	var max_y := 0.0
	for n in normals:
		max_y = maxf(max_y, absf(n.y))
	_assert(max_y < 0.05, "hollow box inner wall: all normals horizontal (max |Y|=%.4f)" % max_y)
