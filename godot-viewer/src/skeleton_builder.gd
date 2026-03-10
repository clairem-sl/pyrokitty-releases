extends RefCounted

## Parses avatar_skeleton.xml and builds a shared Skeleton3D with all bones.
## SL coordinate conversion: (x,y,z) → Godot (x,z,-y).

var _bones: Array = []  # [{name, parent_name, pos, rot, scale, is_cv}, ...] in parent-first order


func load_from_xml(path: String) -> void:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("[SkeletonBuilder] Cannot open %s" % path)
		return
	var xml := XMLParser.new()
	var err := xml.open(path)
	if err != OK:
		push_error("[SkeletonBuilder] XMLParser.open failed: %s" % error_string(err))
		return

	var parent_stack: Array[String] = []

	while xml.read() == OK:
		var node_type := xml.get_node_type()

		if node_type == XMLParser.NODE_ELEMENT:
			var tag := xml.get_node_name()
			if tag != "bone" and tag != "collision_volume":
				continue

			var is_cv := tag == "collision_volume"
			var bone_name := xml.get_named_attribute_value_safe("name")
			if bone_name.is_empty():
				continue

			var pos := _parse_vec3(xml.get_named_attribute_value_safe("pos"))
			var rot := _parse_vec3(xml.get_named_attribute_value_safe("rot"))
			var scl := _parse_vec3(xml.get_named_attribute_value_safe("scale"))

			var parent_name := ""
			if parent_stack.size() > 0:
				parent_name = parent_stack[parent_stack.size() - 1]

			_bones.append({
				"name": bone_name,
				"parent_name": parent_name,
				"pos": pos,
				"rot": rot,
				"scale": scl,
				"is_cv": is_cv,
			})

			# bone tags push onto parent stack (unless self-closing)
			# collision_volume is always self-closing
			if not is_cv and not xml.is_empty():
				parent_stack.push_back(bone_name)

		elif node_type == XMLParser.NODE_ELEMENT_END:
			var tag := xml.get_node_name()
			if tag == "bone" and parent_stack.size() > 0:
				parent_stack.pop_back()

	print("[SkeletonBuilder] Parsed %d bones from %s" % [_bones.size(), path])


## Create a new Skeleton3D with all bones from the parsed XML.
func create_shared_skeleton() -> Skeleton3D:
	var skel := Skeleton3D.new()
	skel.name = "shared_skeleton"

	for bone_data: Dictionary in _bones:
		var idx := skel.add_bone(bone_data["name"])

		if not (bone_data["parent_name"] as String).is_empty():
			var parent_idx := skel.find_bone(bone_data["parent_name"])
			if parent_idx >= 0:
				skel.set_bone_parent(idx, parent_idx)

		var rest := Transform3D()
		# SL pos (x,y,z) → Godot (x,z,-y)
		var sp: Vector3 = bone_data["pos"]
		rest.origin = Vector3(sp.x, sp.z, -sp.y)

		if bone_data["is_cv"]:
			# Collision volumes have rotation (Euler degrees) and non-uniform scale
			var sr: Vector3 = bone_data["rot"]  # degrees in SL XYZ
			var ss: Vector3 = bone_data["scale"]
			rest.basis = _sl_cv_basis(sr, ss)

		skel.set_bone_rest(idx, rest)

	return skel


## Build basis for a collision volume from SL Euler rotation (degrees) and scale.
## SL rotation is XYZ Euler in degrees. SL scale (sx,sy,sz) → Godot (sx,sz,sy).
func _sl_cv_basis(rot_deg: Vector3, scl: Vector3) -> Basis:
	# Convert SL Euler degrees to radians
	var rx := deg_to_rad(rot_deg.x)
	var ry := deg_to_rad(rot_deg.y)
	var rz := deg_to_rad(rot_deg.z)

	# SL rotation axes: X stays X, Y→Z, Z→-Y (same as position)
	# Build rotation in Godot space: rotate around remapped axes
	# SL Euler XYZ → Godot: rotate X by rx, then Godot-Z by ry, then Godot-(-Y) by rz
	# Which is: Rx(rx) * Rz(ry) * Ry(-rz)
	var basis := Basis.IDENTITY
	basis = basis.rotated(Vector3.RIGHT, rx)       # SL X → Godot X
	basis = basis.rotated(Vector3.BACK, ry)        # SL Y → Godot Z
	basis = basis.rotated(Vector3.DOWN, rz)        # SL Z → Godot -Y

	# Apply scale: SL (sx,sy,sz) → Godot (sx,sz,sy)
	var godot_scale := Vector3(scl.x, scl.z, scl.y)
	basis = basis.scaled(godot_scale)

	return basis


func _parse_vec3(s: String) -> Vector3:
	if s.is_empty():
		return Vector3.ZERO
	var parts := s.strip_edges().split(" ", false)
	if parts.size() < 3:
		return Vector3.ZERO
	return Vector3(float(parts[0]), float(parts[1]), float(parts[2]))
