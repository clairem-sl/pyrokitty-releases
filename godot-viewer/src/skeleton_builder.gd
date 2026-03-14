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
		# All bones use translation-only rests (Identity basis + position).
		# CV rotation/scale is baked into the GLB IBMs via Hippolyzer-style fixup.
		var sp: Vector3 = bone_data["pos"]
		rest.origin = Vector3(sp.x, sp.z, -sp.y)
		skel.set_bone_rest(idx, rest)

	return skel


## Returns {bone_name: Quaternion} of SL-space rest rotations for CV bones.
## Non-CV bones and CVs with zero rotation are omitted (implicitly Identity).
## Used by animation evaluation as the fallback rotation for unanimated CV bones,
## since their rest transforms are now translation-only (rotation baked into IBMs).
func get_sl_rest_rotations() -> Dictionary:
	var result := {}
	for bone_data: Dictionary in _bones:
		if not bone_data["is_cv"]:
			continue
		var rot_deg: Vector3 = bone_data["rot"]
		if rot_deg.is_zero_approx():
			continue
		# Build SL-space rotation from Euler angles (degrees XYZ order)
		var rx := deg_to_rad(rot_deg.x)
		var ry := deg_to_rad(rot_deg.y)
		var rz := deg_to_rad(rot_deg.z)
		var basis_sl := Basis.IDENTITY
		basis_sl = basis_sl.rotated(Vector3(1, 0, 0), rx)
		basis_sl = basis_sl.rotated(Vector3(0, 1, 0), ry)
		basis_sl = basis_sl.rotated(Vector3(0, 0, 1), rz)
		result[bone_data["name"]] = basis_sl.get_rotation_quaternion()
	return result


## Return the parsed bone data array for shape deformation baseline lookup.
func get_bone_data() -> Array:
	return _bones


func _parse_vec3(s: String) -> Vector3:
	if s.is_empty():
		return Vector3.ZERO
	var parts := s.strip_edges().split(" ", false)
	if parts.size() < 3:
		return Vector3.ZERO
	return Vector3(float(parts[0]), float(parts[1]), float(parts[2]))
