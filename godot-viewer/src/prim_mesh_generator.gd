extends RefCounted

## Procedural prim geometry generator ported from LLVolume (indra/llmath/llvolume.cpp).
## Generates ArrayMesh from SL prim shape parameters using SurfaceTool.
## Cached by parameter hash — most scenes have <100 unique shapes.

# ─── Constants ────────────────────────────────────────
const PROFILE_SQUARE = 1       # LL_PCODE_PROFILE_SQUARE
const PROFILE_CIRCLE = 0       # LL_PCODE_PROFILE_CIRCLE
const PROFILE_ISOTRI = 2       # LL_PCODE_PROFILE_ISOTRI
const PROFILE_EQUALTRI = 3     # LL_PCODE_PROFILE_EQUALTRI
const PROFILE_RIGHTTRI = 4     # LL_PCODE_PROFILE_RIGHTTRI
const PROFILE_CIRCLE_HALF = 5  # LL_PCODE_PROFILE_CIRCLE_HALF
const PROFILE_MASK = 0x0f
const HOLE_MASK = 0xf0
const HOLE_SAME = 0x00
const HOLE_CIRCLE = 0x10
const HOLE_SQUARE = 0x20
const HOLE_TRIANGLE = 0x30
const PATH_LINE = 0x10
const PATH_CIRCLE = 0x20

const MIN_DETAIL_FACES = 6
const DETAIL = 4.0  # LOD detail level (matches Firestorm highest LOD; scales: 1.0, 1.5, 2.5, 4.0)

const TABLE_SCALE := [1.0, 1.0, 1.0, 0.5, 0.707107, 0.53, 0.525, 0.5]

# ─── Cache ────────────────────────────────────────────
var _cache: Dictionary = {}  # hash_key -> ArrayMesh


# ─── Public API ───────────────────────────────────────

func get_or_generate(shape: Dictionary) -> ArrayMesh:
	var key := _hash_shape(shape)
	if _cache.has(key):
		return _cache[key]
	var mesh := _generate(shape)
	_cache[key] = mesh
	return mesh


func get_cache_size() -> int:
	return _cache.size()


# ─── Hash ─────────────────────────────────────────────

func _hash_shape(s: Dictionary) -> String:
	# Quantize floats to avoid near-duplicate cache entries
	return "%d_%d_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f_%.3f" % [
		int(s.get("pathCurve", 16)),
		int(s.get("profileCurve", 1)),
		s.get("pathBegin", 0.0),
		s.get("pathEnd", 1.0),
		s.get("pathScaleX", 1.0),
		s.get("pathScaleY", 1.0),
		s.get("pathShearX", 0.0),
		s.get("pathShearY", 0.0),
		s.get("pathTwist", 0.0),
		s.get("pathTwistBegin", 0.0),
		s.get("pathRadiusOffset", 0.0),
		s.get("pathTaperX", 0.0),
		s.get("pathTaperY", 0.0),
		s.get("pathRevolutions", 1.0),
		s.get("pathSkew", 0.0),
		s.get("profileBegin", 0.0),
		s.get("profileEnd", 1.0),
		s.get("profileHollow", 0.0),
	]


# ─── Main Generate ────────────────────────────────────

func _generate(s: Dictionary) -> ArrayMesh:
	var path_curve: int   = int(s.get("pathCurve", 16))
	var profile_curve: int = int(s.get("profileCurve", 1))
	var path_begin: float  = float(s.get("pathBegin", 0.0))
	var path_end: float    = float(s.get("pathEnd", 1.0))
	var path_scale_x: float = float(s.get("pathScaleX", 1.0))
	var path_scale_y: float = float(s.get("pathScaleY", 1.0))
	var path_shear_x: float = float(s.get("pathShearX", 0.0))
	var path_shear_y: float = float(s.get("pathShearY", 0.0))
	var path_twist: float   = float(s.get("pathTwist", 0.0))
	var path_twist_begin: float = float(s.get("pathTwistBegin", 0.0))
	var path_radius_offset: float = float(s.get("pathRadiusOffset", 0.0))
	var path_taper_x: float = float(s.get("pathTaperX", 0.0))
	var path_taper_y: float = float(s.get("pathTaperY", 0.0))
	var path_revolutions: float = float(s.get("pathRevolutions", 1.0))
	var path_skew: float    = float(s.get("pathSkew", 0.0))
	var profile_begin: float = float(s.get("profileBegin", 0.0))
	var profile_end: float   = float(s.get("profileEnd", 1.0))
	var profile_hollow: float = float(s.get("profileHollow", 0.0))

	var profile_type: int = profile_curve & PROFILE_MASK
	var hole_type: int = profile_curve & HOLE_MASK
	var is_path_line: bool = (path_curve & 0xf0) == PATH_LINE
	var path_open: bool = is_path_line or path_begin > 0.0 or path_end < 1.0 or absf(path_skew) > 0.001

	# Generate profile (2D cross-section)
	var profile := _generate_profile(profile_type, hole_type, profile_begin, profile_end, profile_hollow, path_open)

	# Generate path (3D sweep)
	var path := _generate_path(path_curve, path_begin, path_end, path_scale_x, path_scale_y,
		path_shear_x, path_shear_y, path_twist, path_twist_begin,
		path_radius_offset, path_taper_x, path_taper_y, path_revolutions, path_skew,
		profile_type)

	# Sweep profile along path to create vertex grid
	var mesh_verts: Array[Vector3] = []
	var profile_len: int = profile.points.size()
	var path_len: int = path.size()

	for pi in path_len:
		var pp = path[pi]
		var pp_pos: Vector3 = pp.pos
		var pp_rot: Basis = pp.rot
		var pp_scale: Vector2 = pp.scale
		for si in profile_len:
			var prof_pt: Vector3 = profile.points[si]
			var scaled := Vector3(prof_pt.x * pp_scale.x, prof_pt.y * pp_scale.y, 0.0)
			var rotated := pp_rot * scaled
			mesh_verts.append(rotated + pp_pos)

	# Build faces into an ArrayMesh
	var array_mesh := ArrayMesh.new()

	# Determine which faces to create based on profile face descriptors
	for fi in profile.faces.size():
		var face = profile.faces[fi]
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)

		if face.is_cap:
			_build_cap(st, mesh_verts, profile, path, face, path_len, profile_len)
		else:
			_build_side(st, mesh_verts, profile, path, face, path_len, profile_len)

		if face.is_cap or face.is_flat:
			st.generate_normals()
		st.commit(array_mesh)

	# Fallback: if no faces were generated, create a simple box
	if array_mesh.get_surface_count() == 0:
		return _make_box()

	return array_mesh


# ─── Profile Generation ──────────────────────────────

class ProfileResult:
	var points: Array[Vector3] = []  # x,y = position, z = texcoord t
	var faces: Array = []            # array of ProfileFace
	var total_out: int = 0           # outer point count (before hollow)
	var is_open: bool = false

class ProfileFace:
	var index: int = 0      # start index in profile points
	var count: int = 0      # number of points
	var face_id: int = 0    # SL face ID for texture mapping
	var is_cap: bool = false
	var is_flat: bool = false


func _generate_profile(profile_type: int, hole_type: int, p_begin: float, p_end: float,
		hollow: float, path_open: bool) -> ProfileResult:
	var result := ProfileResult.new()

	match profile_type:
		PROFILE_SQUARE:
			_gen_ngon(result, 4, -0.375, 0.0, 1.0, p_begin, p_end, hollow)
			if path_open:
				_add_cap_face(result, true)  # PATH_BEGIN cap

			# Add individual side faces for box
			var _box_side_offset := floori(p_begin * 4.0)
			for i in range(_box_side_offset, floori(p_end * 4.0 + 0.999)):
				var face := ProfileFace.new()
				face.index = i - _box_side_offset
				face.count = 2
				face.face_id = 5 + i  # LL_FACE_OUTER_SIDE_0 << i
				face.is_flat = true
				result.faces.append(face)

			# Scale z (tex coord) by 4
			for i in result.points.size():
				result.points[i].z *= 4.0

			if hollow > 0:
				_add_hollow(result, hole_type, hollow, 4, -0.375, 1.0, p_begin, p_end)

		PROFILE_ISOTRI, PROFILE_EQUALTRI, PROFILE_RIGHTTRI:
			_gen_ngon(result, 3, 0.0, 0.0, 1.0, p_begin, p_end, hollow)
			# Scale z by 3
			for i in result.points.size():
				result.points[i].z *= 3.0

			if path_open:
				_add_cap_face(result, true)

			var _tri_side_offset := floori(p_begin * 3.0)
			for i in range(_tri_side_offset, floori(p_end * 3.0 + 0.999)):
				var face := ProfileFace.new()
				face.index = i - _tri_side_offset
				face.count = 2
				face.face_id = 5 + i
				face.is_flat = true
				result.faces.append(face)

			if hollow > 0:
				var tri_hollow := hollow / 2.0
				_add_hollow(result, hole_type, tri_hollow, 3, 0.0, 1.0, p_begin, p_end)

		PROFILE_CIRCLE:
			var circle_detail := MIN_DETAIL_FACES * DETAIL
			if hollow > 0 and hole_type == HOLE_SQUARE:
				circle_detail = ceilf(circle_detail / 4.0) * 4.0
			var sides: int = int(circle_detail)
			_gen_ngon(result, sides, 0.0, 0.0, 1.0, p_begin, p_end, hollow)

			if path_open:
				_add_cap_face(result, true)

			# Single outer face for circle
			var face := ProfileFace.new()
			face.index = 0
			face.count = result.points.size() if not result.is_open or hollow > 0 else result.points.size() - 1
			face.face_id = 5  # LL_FACE_OUTER_SIDE_0
			face.is_flat = false
			result.faces.append(face)

			if hollow > 0:
				_add_hollow_circle(result, hole_type, hollow, circle_detail, 0.0, 1.0, p_begin, p_end)

		PROFILE_CIRCLE_HALF:
			var circle_detail := MIN_DETAIL_FACES * DETAIL * 0.5
			if hollow > 0 and hole_type == HOLE_SQUARE:
				circle_detail = ceilf(circle_detail / 2.0) * 2.0
			_gen_ngon(result, floori(circle_detail), 0.5, 0.0, 0.5, p_begin, p_end, hollow)

			if path_open:
				_add_cap_face(result, true)

			var face := ProfileFace.new()
			face.index = 0
			face.count = result.points.size() if not result.is_open or hollow > 0 else result.points.size() - 1
			face.face_id = 5
			face.is_flat = false
			result.faces.append(face)

			if hollow > 0:
				_add_hollow_circle(result, hole_type, hollow, circle_detail, 0.5, 0.5, p_begin, p_end)

			# Special case for sphere openness
			if (p_end - p_begin) < 1.0:
				result.is_open = true
			elif hollow <= 0:
				result.is_open = false
				# Close the profile by duplicating first point
				result.points.append(result.points[0])

	# Add path end cap and profile begin/end faces if open
	if path_open and result.faces.size() > 0:
		_add_cap_face(result, false)  # PATH_END cap

	if result.is_open:
		# Profile begin face
		var f_begin := ProfileFace.new()
		f_begin.index = result.points.size() - 1
		f_begin.count = 2
		f_begin.face_id = 3  # LL_FACE_PROFILE_BEGIN
		f_begin.is_flat = true
		result.faces.append(f_begin)

	if result.is_open:
		# Profile end face
		var f_end := ProfileFace.new()
		if hollow > 0:
			f_end.index = result.total_out - 1 if result.total_out > 0 else result.points.size() - 1
		else:
			f_end.index = result.points.size() - 2
		f_end.count = 2
		f_end.face_id = 4  # LL_FACE_PROFILE_END
		f_end.is_flat = true
		result.faces.append(f_end)

	return result


func _gen_ngon(result: ProfileResult, sides: int, offset: float, _bevel: float,
		ang_scale: float, p_begin: float, p_end: float, hollow: float) -> void:
	var scale: float = 0.5
	var total_sides: int = roundi(float(sides) / ang_scale)
	if total_sides < 8:
		scale = float(TABLE_SCALE[total_sides])

	var t_step: float = 1.0 / float(sides)
	var ang_step: float = TAU * t_step * ang_scale

	var t_first: float = floorf(p_begin * float(sides)) / float(sides)
	var t: float = t_first
	var ang: float = TAU * (t * ang_scale + offset)

	var pt1 := Vector3(cos(ang) * scale, sin(ang) * scale, t)
	t += t_step
	ang += ang_step
	var pt2 := Vector3(cos(ang) * scale, sin(ang) * scale, t)

	var t_fraction: float = (p_begin - t_first) * float(sides)

	if t_fraction < 0.9999:
		result.points.append(pt1.lerp(pt2, t_fraction))

	while t < p_end:
		var pt := Vector3(cos(ang) * scale, sin(ang) * scale, t)
		result.points.append(pt)
		t += t_step
		ang += ang_step

	# End fraction
	pt2 = Vector3(cos(ang) * scale, sin(ang) * scale, t)
	t_fraction = (p_end - (t - t_step)) * float(sides)
	if t_fraction > 0.0001:
		pt1 = Vector3(cos(ang - ang_step) * scale, sin(ang - ang_step) * scale, t - t_step)
		result.points.append(pt1.lerp(pt2, t_fraction))

	# If sliced, profile is open
	if (p_end - p_begin) * ang_scale < 0.99:
		result.is_open = true
		if hollow <= 0:
			result.points.append(Vector3(0, 0, 0))  # center point for cap fan
	else:
		result.is_open = false


func _add_cap_face(result: ProfileResult, is_begin: bool) -> void:
	var face := ProfileFace.new()
	face.index = 0
	face.count = result.points.size()
	face.face_id = 0 if is_begin else 1  # PATH_BEGIN or PATH_END
	face.is_cap = true
	face.is_flat = true
	result.faces.append(face)


func _add_hollow(result: ProfileResult, hole_type: int, hollow: float,
		default_sides: int, offset: float, ang_scale: float,
		p_begin: float, p_end: float) -> void:
	result.total_out = result.points.size()

	var inner_sides: int
	var inner_offset: float = offset
	var is_flat: bool = true

	match hole_type:
		HOLE_CIRCLE:
			inner_sides = int(MIN_DETAIL_FACES * DETAIL)
			is_flat = false
		HOLE_SQUARE:
			inner_sides = 4
		HOLE_TRIANGLE:
			inner_sides = 3
		_:  # HOLE_SAME
			inner_sides = default_sides

	# Generate inner profile (pass hollow so _gen_ngon skips the center point —
	# the center is only needed for non-hollow open profiles' cap fans)
	var inner := ProfileResult.new()
	_gen_ngon(inner, inner_sides, inner_offset, -1.0, ang_scale, p_begin, p_end, hollow)

	# Scale by hollow amount and reverse order
	var inner_pts: Array[Vector3] = []
	for i in inner.points.size():
		var pt := inner.points[i]
		inner_pts.append(Vector3(pt.x * hollow, pt.y * hollow, pt.z))

	# Reverse the inner profile for correct winding
	inner_pts.reverse()

	# Add inner side face
	var face := ProfileFace.new()
	face.index = result.total_out
	face.count = inner_pts.size()
	face.face_id = 2  # LL_FACE_INNER_SIDE
	face.is_flat = is_flat
	result.faces.append(face)

	result.points.append_array(inner_pts)

	# Double the cap counts
	for f in result.faces:
		if f.is_cap:
			f.count = result.points.size()


func _add_hollow_circle(result: ProfileResult, hole_type: int, hollow: float,
		circle_detail: float, offset: float, ang_scale: float,
		p_begin: float, p_end: float) -> void:
	var inner_sides: int
	var is_flat: bool
	match hole_type:
		HOLE_SQUARE:
			inner_sides = 4
			is_flat = true
		HOLE_TRIANGLE:
			inner_sides = 3
			is_flat = true
		_:  # HOLE_CIRCLE or HOLE_SAME
			inner_sides = int(circle_detail)
			is_flat = false

	_add_hollow(result, hole_type, hollow, inner_sides, offset, ang_scale, p_begin, p_end)


# ─── Path Generation ─────────────────────────────────

class PathPoint:
	var pos: Vector3 = Vector3.ZERO
	var rot: Basis = Basis.IDENTITY
	var scale: Vector2 = Vector2.ONE
	var tex_t: float = 0.0


func _generate_path(path_curve: int, p_begin: float, p_end: float,
		scale_x: float, scale_y: float, shear_x: float, shear_y: float,
		twist: float, twist_begin: float, radius_offset: float,
		taper_x: float, taper_y: float, revolutions: float, skew: float,
		profile_type: int) -> Array:  # Array[PathPoint]

	var path: Array = []

	if (path_curve & 0xf0) == PATH_LINE:
		path = _gen_linear_path(p_begin, p_end, scale_x, scale_y, shear_x, shear_y, twist, twist_begin)
	elif (path_curve & 0xf0) == PATH_CIRCLE:
		path = _gen_circular_path(p_begin, p_end, scale_x, scale_y, shear_x, shear_y,
			twist, twist_begin, radius_offset, taper_x, taper_y, revolutions, skew, profile_type)
	else:
		# Fallback: simple 2-point line
		path = _gen_linear_path(0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0)

	return path


func _gen_linear_path(p_begin: float, p_end: float, scale_x: float, scale_y: float,
		shear_x: float, shear_y: float, twist_val: float, twist_begin_val: float) -> Array:
	var path: Array = []

	# Compute begin/end scale from pathScaleX/Y
	var begin_scale := Vector2(1.0, 1.0)
	var end_scale := Vector2(1.0, 1.0)
	if scale_x > 1.0:
		begin_scale.x = 2.0 - scale_x
	if scale_y > 1.0:
		begin_scale.y = 2.0 - scale_y
	if scale_x < 1.0:
		end_scale.x = scale_x
	if scale_y < 1.0:
		end_scale.y = scale_y

	# Number of path points based on twist
	var np: int = floori(absf(twist_begin_val - twist_val) * 3.5 * (DETAIL - 0.5)) + 2
	np = maxi(np, 2)

	var step := 1.0 / float(np - 1)

	for i in np:
		var t := lerpf(p_begin, p_end, float(i) * step)
		var pp := PathPoint.new()
		pp.pos = Vector3(
			lerpf(0.0, shear_x, t),
			lerpf(0.0, shear_y, t),
			t - 0.5
		)
		pp.scale = Vector2(
			lerpf(begin_scale.x, end_scale.x, t),
			lerpf(begin_scale.y, end_scale.y, t)
		)
		pp.tex_t = t

		# Twist rotation around Z axis
		var twist_ang := lerpf(PI * twist_begin_val, PI * twist_val, t)
		pp.rot = Basis(Vector3(0, 0, 1), twist_ang)

		path.append(pp)

	return path


func _gen_circular_path(p_begin: float, p_end: float, scale_x: float, scale_y: float,
		shear_x: float, shear_y: float, twist_val: float, twist_begin_val: float,
		radius_offset: float, taper_x: float, taper_y: float, revolutions: float,
		skew: float, _profile_type: int) -> Array:
	var path: Array = []

	var skew_mag := absf(skew)
	var hole_x := scale_x * (1.0 - skew_mag)
	var hole_y := scale_y

	# Taper
	var taper_x_begin := 1.0
	var taper_x_end := 1.0 - taper_x
	var taper_y_begin := 1.0
	var taper_y_end := 1.0 - taper_y

	if taper_x_end > 1.0:
		taper_x_begin = 2.0 - taper_x_end
		taper_x_end = 1.0
	if taper_y_end > 1.0:
		taper_y_begin = 2.0 - taper_y_end
		taper_y_end = 1.0

	# Radius
	var twist_mag := absf(twist_begin_val - twist_val)
	var sides: int = int(floorf(floorf(MIN_DETAIL_FACES * DETAIL + twist_mag * 3.5 * (DETAIL - 0.5)) * revolutions))
	sides = maxi(sides, 1)

	var radius_start := 0.5
	if sides < 8:
		radius_start = TABLE_SCALE[sides]
	radius_start *= (1.0 - hole_y)

	var radius_end := radius_start
	if radius_offset < 0.0:
		radius_start *= 1.0 + radius_offset
	else:
		radius_end *= 1.0 - radius_offset

	var twist_scale := 1.0  # For circular paths
	var t_twist_begin := twist_begin_val * twist_scale
	var t_twist_end := twist_val * twist_scale

	var step := 1.0 / float(sides)
	var t := p_begin

	# First point
	var _add_path_point = func(t_val: float):
		var pp := PathPoint.new()
		var ang := TAU * revolutions * t_val
		var c := cos(ang) * lerpf(radius_start, radius_end, t_val)
		var s := sin(ang) * lerpf(radius_start, radius_end, t_val)

		pp.pos = Vector3(
			lerpf(0.0, shear_x, s) + lerpf(-skew, skew, t_val) * 0.5,
			c + lerpf(0.0, shear_y, s),
			s
		)
		pp.scale = Vector2(
			hole_x * lerpf(taper_x_begin, taper_x_end, t_val),
			hole_y * lerpf(taper_y_begin, taper_y_end, t_val)
		)
		pp.tex_t = t_val

		# Twist + circle rotation
		var twist_quat := Quaternion(Vector3(0, 0, 1), lerpf(t_twist_begin, t_twist_end, t_val) * TAU - PI)
		var circle_quat := Quaternion(Vector3(1, 0, 0), ang)
		# Godot quaternion convention: q1*q2 applies q2 first, then q1.
		# Firestorm (LLQuaternion) is opposite: q1*q2 applies q1 first, then q2.
		# We want twist first (orient profile), then circle (sweep around path).
		pp.rot = Basis(circle_quat * twist_quat)

		path.append(pp)

	# Begin point
	_add_path_point.call(t)

	t += step
	t = floorf(t * float(sides)) / float(sides)  # Snap

	while t < p_end:
		_add_path_point.call(t)
		t += step

	# End point
	_add_path_point.call(p_end)

	return path


# ─── Face Building ────────────────────────────────────

func _build_side(st: SurfaceTool, verts: Array[Vector3], profile: ProfileResult,
		path: Array, face: ProfileFace, path_len: int, profile_len: int) -> void:
	var begin_s: int = face.index
	var num_s: int = face.count
	var smooth: bool = not face.is_flat

	# For flat faces (box/tri sides), normalize S tex coord per-face.
	# Matches SL's begin_stex subtraction in LLVolumeFace::createSide (llvolume.cpp:6841,6881).
	# Without this, box sides 1-3 get S in [1,2],[2,3],[3,4] instead of [0,1] each,
	# causing wrong texture centering when repeat/offset/rotation are applied.
	var begin_stex: float = 0.0
	if face.is_flat and begin_s < profile.points.size():
		begin_stex = floorf(profile.points[begin_s].z)

	# Handle wrapping for closed profiles
	for t in range(0, path_len - 1):
		var tt: float = path[t].tex_t
		var tt1: float = path[t + 1].tex_t

		for s in range(0, num_s - 1):
			var si0: int = (begin_s + s) % profile_len
			var si1: int = (begin_s + s + 1) % profile_len

			var i00: int = si0 + profile_len * t
			var i10: int = si1 + profile_len * t
			var i01: int = si0 + profile_len * (t + 1)
			var i11: int = si1 + profile_len * (t + 1)

			# Clamp indices
			var max_idx: int = verts.size() - 1
			i00 = mini(i00, max_idx)
			i10 = mini(i10, max_idx)
			i01 = mini(i01, max_idx)
			i11 = mini(i11, max_idx)

			# Get profile tex coords, normalized per-face for flat faces
			var ss0: float = profile.points[si0].z if si0 < profile.points.size() else 0.0
			var ss1: float = profile.points[si1].z if si1 < profile.points.size() else 1.0
			if face.is_flat:
				ss0 -= begin_stex
				ss1 -= begin_stex

			# Convert SL -> Godot coords: (x, z, -y)
			var v00 := _sl_to_godot(verts[i00])
			var v10 := _sl_to_godot(verts[i10])
			var v01 := _sl_to_godot(verts[i01])
			var v11 := _sl_to_godot(verts[i11])

			# Compute analytical normals for smooth faces — generate_normals()
			# fails at sphere poles where all path steps converge to one point,
			# making every triangle degenerate (zero-length cross products).
			if smooth:
				var n00 := _swept_normal(profile, path, si0, t)
				var n10 := _swept_normal(profile, path, si1, t)
				var n01 := _swept_normal(profile, path, si0, t + 1)
				var n11 := _swept_normal(profile, path, si1, t + 1)

				# Triangle 1
				st.set_normal(n00); st.set_uv(Vector2(ss0, 1.0 - tt))
				st.add_vertex(v00)
				st.set_normal(n01); st.set_uv(Vector2(ss0, 1.0 - tt1))
				st.add_vertex(v01)
				st.set_normal(n11); st.set_uv(Vector2(ss1, 1.0 - tt1))
				st.add_vertex(v11)

				# Triangle 2
				st.set_normal(n00); st.set_uv(Vector2(ss0, 1.0 - tt))
				st.add_vertex(v00)
				st.set_normal(n11); st.set_uv(Vector2(ss1, 1.0 - tt1))
				st.add_vertex(v11)
				st.set_normal(n10); st.set_uv(Vector2(ss1, 1.0 - tt))
				st.add_vertex(v10)
			else:
				# Triangle 1 (winding reversed for SL→Godot coord flip, V inverted)
				st.set_uv(Vector2(ss0, 1.0 - tt))
				st.add_vertex(v00)
				st.set_uv(Vector2(ss0, 1.0 - tt1))
				st.add_vertex(v01)
				st.set_uv(Vector2(ss1, 1.0 - tt1))
				st.add_vertex(v11)

				# Triangle 2
				st.set_uv(Vector2(ss0, 1.0 - tt))
				st.add_vertex(v00)
				st.set_uv(Vector2(ss1, 1.0 - tt1))
				st.add_vertex(v11)
				st.set_uv(Vector2(ss1, 1.0 - tt))
				st.add_vertex(v10)


func _build_cap(st: SurfaceTool, verts: Array[Vector3], profile: ProfileResult,
		path: Array, face: ProfileFace, path_len: int, profile_len: int) -> void:
	# SL TE face 0 = top of box, face 5 = bottom. Scene_manager maps TE index → surface index
	# directly, so surface 0 (PATH_BEGIN cap, first in profile.faces) must render the top.
	# This means face_id=0 uses the last path step (z=+0.5 = top).
	var is_top: bool = face.face_id == 0
	var path_idx: int = (path_len - 1) if is_top else 0
	var offset: int = profile_len * path_idx

	var num_pts: int = mini(face.count, profile.points.size())
	if num_pts < 3:
		return

	# Check if hollow (inner + outer points)
	var is_hollow: bool = profile.total_out > 0 and profile.total_out < num_pts
	var max_idx: int = verts.size() - 1

	if is_hollow:
		# Two-pointer triangulation between outer and inner rings
		_build_hollow_cap(st, verts, profile, offset, num_pts, is_top, max_idx)
	else:
		# Check if last point is center (for open non-hollow profiles)
		var has_center: bool = profile.is_open and num_pts > 2
		if has_center:
			_build_fan_cap(st, verts, profile, offset, num_pts, is_top, max_idx)
		else:
			# Simple fan from centroid for closed profiles
			_build_centroid_cap(st, verts, profile, offset, num_pts, is_top, max_idx)


func _build_fan_cap(st: SurfaceTool, verts: Array[Vector3], profile: ProfileResult,
		offset: int, num_pts: int, is_top: bool, max_idx: int) -> void:
	# Last point is center, fan from it
	var center_idx: int = mini(offset + num_pts - 1, max_idx)
	var center := _sl_to_godot(verts[center_idx])
	var center_uv := Vector2(0.5, 0.5)

	for i in range(0, num_pts - 2):
		var i0: int = mini(offset + i, max_idx)
		var i1: int = mini(offset + i + 1, max_idx)

		var v0 := _sl_to_godot(verts[i0])
		var v1 := _sl_to_godot(verts[i1])

		var p0 := profile.points[i] if i < profile.points.size() else Vector3.ZERO
		var p1 := profile.points[i + 1] if (i + 1) < profile.points.size() else Vector3.ZERO

		var uv0 := _cap_uv_from_profile(p0, is_top)
		var uv1 := _cap_uv_from_profile(p1, is_top)

		# Godot's generate_normals() uses (v0-v2)×(v0-v1), opposite of standard convention.
		# Reversed winding → outward normal for top (+Y), forward → outward for bottom (-Y).
		if is_top:
			st.set_uv(center_uv)
			st.add_vertex(center)
			st.set_uv(uv1)
			st.add_vertex(v1)
			st.set_uv(uv0)
			st.add_vertex(v0)
		else:
			st.set_uv(center_uv)
			st.add_vertex(center)
			st.set_uv(uv0)
			st.add_vertex(v0)
			st.set_uv(uv1)
			st.add_vertex(v1)


func _build_centroid_cap(st: SurfaceTool, verts: Array[Vector3], profile: ProfileResult,
		offset: int, num_pts: int, is_top: bool, max_idx: int) -> void:
	# Compute centroid
	var centroid := Vector3.ZERO
	var centroid_uv := Vector2.ZERO
	for i in num_pts:
		var idx: int = mini(offset + i, max_idx)
		centroid += verts[idx]
		if i < profile.points.size():
			var p := profile.points[i]
			centroid_uv += _cap_uv_from_profile(p, is_top)
	centroid /= float(num_pts)
	centroid_uv /= float(num_pts)
	var center := _sl_to_godot(centroid)

	for i in num_pts:
		var i0: int = mini(offset + i, max_idx)
		var i1: int = mini(offset + ((i + 1) % num_pts), max_idx)

		var v0 := _sl_to_godot(verts[i0])
		var v1 := _sl_to_godot(verts[i1])

		var pi0: int = i % profile.points.size()
		var pi1: int = (i + 1) % profile.points.size()
		var p0 := profile.points[pi0]
		var p1 := profile.points[pi1]

		var uv0 := _cap_uv_from_profile(p0, is_top)
		var uv1 := _cap_uv_from_profile(p1, is_top)

		# Godot's generate_normals() uses (v0-v2)×(v0-v1), opposite of standard convention.
		# Reversed winding → outward normal for top (+Y), forward → outward for bottom (-Y).
		if is_top:
			st.set_uv(centroid_uv)
			st.add_vertex(center)
			st.set_uv(uv1)
			st.add_vertex(v1)
			st.set_uv(uv0)
			st.add_vertex(v0)
		else:
			st.set_uv(centroid_uv)
			st.add_vertex(center)
			st.set_uv(uv0)
			st.add_vertex(v0)
			st.set_uv(uv1)
			st.add_vertex(v1)


func _build_hollow_cap(st: SurfaceTool, verts: Array[Vector3], profile: ProfileResult,
		offset: int, num_pts: int, is_top: bool, max_idx: int) -> void:
	# Two-pointer approach: pt1 walks outer ring forward, pt2 walks inner ring backward
	var outer_count: int = profile.total_out
	var pt1: int = 0
	var pt2: int = num_pts - 1

	while pt2 - pt1 > 1:
		# Decide which triangle to emit based on profile distances
		var use_a: bool
		if pt1 + 1 < outer_count and pt2 - 1 >= outer_count:
			# Choose based on shortest diagonal
			var p1 := profile.points[pt1] if pt1 < profile.points.size() else Vector3.ZERO
			var pa := profile.points[pt1 + 1] if (pt1 + 1) < profile.points.size() else Vector3.ZERO
			var p2 := profile.points[pt2] if pt2 < profile.points.size() else Vector3.ZERO
			var pb := profile.points[pt2 - 1] if (pt2 - 1) < profile.points.size() else Vector3.ZERO

			var dist_a := Vector2(pa.x - p2.x, pa.y - p2.y).length_squared()
			var dist_b := Vector2(pb.x - p1.x, pb.y - p1.y).length_squared()
			use_a = dist_a < dist_b
		elif pt1 + 1 < outer_count:
			use_a = true
		else:
			use_a = false

		# Godot's generate_normals() uses (v0-v2)×(v0-v1), opposite of standard convention.
		# use_a triangles (outer edge + inner pt) are CW from +Y.
		# use_b triangles (outer pt + inner edge) are CCW from +Y.
		# CW needs reversed winding for +Y (top), forward for -Y (bottom).
		# CCW needs forward winding for +Y (top), reversed for -Y (bottom).
		# So: reverse when (is_top == use_a).
		var reverse_winding := (is_top == use_a)
		if use_a:
			var i0: int = mini(offset + pt1, max_idx)
			var i1: int = mini(offset + pt1 + 1, max_idx)
			var i2: int = mini(offset + pt2, max_idx)

			var v0 := _sl_to_godot(verts[i0])
			var v1 := _sl_to_godot(verts[i1])
			var v2 := _sl_to_godot(verts[i2])

			var uv0 := _cap_uv(profile, pt1, is_top)
			var uv1 := _cap_uv(profile, pt1 + 1, is_top)
			var uv2 := _cap_uv(profile, pt2, is_top)

			if reverse_winding:
				st.set_uv(uv0); st.add_vertex(v0)
				st.set_uv(uv2); st.add_vertex(v2)
				st.set_uv(uv1); st.add_vertex(v1)
			else:
				st.set_uv(uv0); st.add_vertex(v0)
				st.set_uv(uv1); st.add_vertex(v1)
				st.set_uv(uv2); st.add_vertex(v2)
			pt1 += 1
		else:
			var i0: int = mini(offset + pt1, max_idx)
			var i1: int = mini(offset + pt2, max_idx)
			var i2: int = mini(offset + pt2 - 1, max_idx)

			var v0 := _sl_to_godot(verts[i0])
			var v1 := _sl_to_godot(verts[i1])
			var v2 := _sl_to_godot(verts[i2])

			var uv0 := _cap_uv(profile, pt1, is_top)
			var uv1 := _cap_uv(profile, pt2, is_top)
			var uv2 := _cap_uv(profile, pt2 - 1, is_top)

			if reverse_winding:
				st.set_uv(uv0); st.add_vertex(v0)
				st.set_uv(uv2); st.add_vertex(v2)
				st.set_uv(uv1); st.add_vertex(v1)
			else:
				st.set_uv(uv0); st.add_vertex(v0)
				st.set_uv(uv1); st.add_vertex(v1)
				st.set_uv(uv2); st.add_vertex(v2)
			pt2 -= 1


func _cap_uv(profile: ProfileResult, idx: int, is_top: bool) -> Vector2:
	if idx >= profile.points.size():
		return Vector2(0.5, 0.5)
	return _cap_uv_from_profile(profile.points[idx], is_top)


func _cap_uv_from_profile(p: Vector3, is_top: bool) -> Vector2:
	# SL cap UV (llvolume.cpp createUnCutCubeCap):
	#   Base: U = p.x+0.5, V = 0.5-p.y.  Top cap swaps corners → V_top = p.y+0.5.
	#
	# Mesh UVs must be in Godot convention (V flipped from SL), matching side faces
	# which store V = 1.0-tt.  The standard_uv shader converts Godot→SL via 1.0-UV.y
	# before applying xform, so we store 1.0-V_sl:
	#   Top:    V_mesh = 1.0 - (p.y+0.5) = 0.5 - p.y
	#   Bottom: V_mesh = 1.0 - (0.5-p.y) = p.y + 0.5
	if is_top:
		return Vector2(p.x + 0.5, 0.5 - p.y)
	else:
		return Vector2(p.x + 0.5, p.y + 0.5)


func _swept_normal(profile: ProfileResult, path: Array, si: int, ti: int) -> Vector3:
	# Analytical normal for a profile point swept along a path.
	# The profile's radial outward direction, corrected for path scaling
	# (inverse-transpose), rotated by path rotation, then SL→Godot.
	var p := profile.points[si] if si < profile.points.size() else Vector3.ZERO
	var pn := Vector3(p.x, p.y, 0.0)
	if pn.length_squared() < 0.0001:
		pn = Vector3(0, 1, 0)  # fallback for center/zero points
	else:
		pn = pn.normalized()
	var pp = path[ti]
	# Inverse-transpose of diagonal scale: n' = (nx/sx, ny/sy, 0)
	var sx: float = pp.scale.x if absf(pp.scale.x) > 0.0001 else 1.0
	var sy: float = pp.scale.y if absf(pp.scale.y) > 0.0001 else 1.0
	var scaled_n := Vector3(pn.x / sx, pn.y / sy, 0.0).normalized()
	return _sl_to_godot(pp.rot * scaled_n)


# ─── Utilities ────────────────────────────────────────

func _sl_to_godot(v: Vector3) -> Vector3:
	return Vector3(v.x, v.z, -v.y)


func _make_box() -> ArrayMesh:
	var bm := BoxMesh.new()
	bm.size = Vector3(1, 1, 1)
	# Convert to ArrayMesh for consistency
	var am := ArrayMesh.new()
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var arrays := bm.surface_get_arrays(0)
	var positions: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
	var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	for i in indices.size():
		var idx: int = indices[i]
		st.set_normal(normals[idx])
		st.set_uv(uvs[idx])
		st.add_vertex(positions[idx])
	st.commit(am)
	return am
