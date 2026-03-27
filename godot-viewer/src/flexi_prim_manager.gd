extends RefCounted

## Flexi (flexible) prim simulation using Verlet integration (matching Firestorm).
## Creates a Skeleton3D bone chain along the prim's Y axis (SL height → Godot Y via
## _sl_to_godot), rigs the prim mesh to those bones, and drives them with world-space
## physics each frame.  No SpringBoneSimulator3D — we own the physics loop.

var sm  # scene_manager reference

# Tracking dictionaries
var _flexi_roots: Dictionary = {}      # obj_uuid -> Node3D (root node in scene tree)
var _flexi_skeletons: Dictionary = {}  # obj_uuid -> Skeleton3D
var _flexi_meshes: Dictionary = {}     # obj_uuid -> MeshInstance3D
var _flexi_params: Dictionary = {}     # obj_uuid -> Dictionary (SL flexi params)
var _flexi_sections: Dictionary = {}   # obj_uuid -> Array[Dictionary] (Verlet state)
var _flexi_section_len: Dictionary = {}# obj_uuid -> float (world-space section length)
var _flexi_scales: Dictionary = {}     # obj_uuid -> Vector3 (prim_scale for rebuild)

# Bone count: SL uses 2^softness (1-8) simulate sections, up to 13 render sections.
# We use 8 bones for smooth deformation.
const BONE_COUNT := 8

# Matches Firestorm's FLEXIBLE_OBJECT_MAX_INTERNAL_TENSION_FORCE
const MAX_TENSION_FORCE := 0.99


func _init(scene_manager) -> void:
	sm = scene_manager


## Create a flexi prim: Skeleton3D + bone chain + rigged MeshInstance3D.
## No SpringBoneSimulator3D — simulation is custom Verlet in simulate().
func create_flexi(obj_uuid: String, params: Dictionary, prim_mesh: Mesh, world_pos: Vector3, world_rot: Quaternion, prim_scale: Vector3) -> Node3D:
	if _flexi_roots.has(obj_uuid):
		destroy_flexi(obj_uuid)

	_flexi_params[obj_uuid] = params
	_flexi_scales[obj_uuid] = prim_scale

	# Root node: position + rotation only (NO scale).
	# Scale is baked into vertices and bone rest positions to avoid the GPU skinning
	# distortion caused by non-uniform parent scale on Skeleton3D.
	var root := Node3D.new()
	root.name = "flexi_%s" % obj_uuid.substr(0, 8)
	sm.add_child(root)
	root.position = world_pos
	root.quaternion = world_rot

	# Skeleton3D — bones along Y (the mesh path direction after _sl_to_godot)
	var skeleton := Skeleton3D.new()
	skeleton.name = "FlexiSkeleton"
	root.add_child(skeleton)

	# Bone rest positions are pre-scaled by prim_scale so the skeleton matches
	# the pre-scaled mesh.  flex_length = prim_scale.y (Godot Y = SL height).
	var flex_length: float = prim_scale.y
	var segment_y: float = flex_length / float(BONE_COUNT)

	# Bone 0 = fixed anchor at the BASE of the prim (bottom of Y range).
	# Not part of the spring chain — it stays where the prim is attached.
	skeleton.add_bone("flexi_anchor")
	skeleton.set_bone_rest(0, Transform3D(Basis.IDENTITY, Vector3(0.0, -flex_length * 0.5, 0.0)))

	for i in range(BONE_COUNT):
		skeleton.add_bone("flexi_bone_%d" % i)
		skeleton.set_bone_parent(i + 1, i)
		skeleton.set_bone_rest(i + 1, Transform3D(Basis.IDENTITY, Vector3(0.0, segment_y, 0.0)))

	skeleton.reset_bone_poses()

	# Build rigged mesh with pre-scaled vertices and bone weights along Y
	var rigged_mesh := _build_rigged_mesh(prim_mesh, prim_scale)
	var mesh_inst := MeshInstance3D.new()
	mesh_inst.name = "FlexiMesh"
	mesh_inst.mesh = rigged_mesh
	mesh_inst.skin = _build_skin(skeleton)
	skeleton.add_child(mesh_inst)
	mesh_inst.skeleton = mesh_inst.get_path_to(skeleton)

	# Initialize Verlet sections in world space
	var section_length: float = flex_length / float(BONE_COUNT)
	_flexi_section_len[obj_uuid] = section_length
	_init_sections(obj_uuid, world_pos, world_rot, prim_scale)

	# Store references
	_flexi_roots[obj_uuid] = root
	_flexi_skeletons[obj_uuid] = skeleton
	_flexi_meshes[obj_uuid] = mesh_inst

	print("[Flexi] Created %s: pos=%s rot=%s scale=%s bones=%d sec_len=%.3f surfaces=%d" % [
		obj_uuid.substr(0, 8), world_pos, world_rot, prim_scale,
		skeleton.get_bone_count(), section_length,
		rigged_mesh.get_surface_count()])

	return root


## Initialize Verlet sections in world space — straight chain along the prim's direction.
func _init_sections(obj_uuid: String, world_pos: Vector3, world_rot: Quaternion, prim_scale: Vector3) -> void:
	var flex_length: float = prim_scale.y
	var section_length: float = flex_length / float(BONE_COUNT)
	var direction: Vector3 = world_rot * Vector3.UP
	# Anchor at the base (bottom of the prim), matching Firestorm:
	# AnchorPosition = BasePosition − (height/2 * direction)
	var anchor_pos: Vector3 = world_pos - direction * (flex_length * 0.5)

	var sections: Array = []
	for i in range(BONE_COUNT + 1):  # 0 = anchor, 1..BONE_COUNT = simulated
		sections.append({
			"position": anchor_pos + direction * (section_length * float(i)),
			"velocity": Vector3.ZERO,
			"direction": direction,
		})
	_flexi_sections[obj_uuid] = sections


## Run the Verlet simulation for ALL flexi prims.  Called from scene_manager._process().
## Port of Firestorm's LLVolumeImplFlexible::doFlexibleUpdate().
func simulate(delta: float) -> void:
	if delta <= 0.0 or delta > 0.2:
		delta = clampf(delta, 0.001, 0.2)

	for obj_uuid: String in _flexi_roots.keys():
		var root: Node3D = _flexi_roots.get(obj_uuid)
		if root == null or not is_instance_valid(root):
			continue
		var skeleton: Skeleton3D = _flexi_skeletons.get(obj_uuid)
		if skeleton == null or not is_instance_valid(skeleton):
			continue
		var sections: Array = _flexi_sections.get(obj_uuid)
		if sections == null or sections.size() != BONE_COUNT + 1:
			continue

		var params: Dictionary = _flexi_params.get(obj_uuid, {})
		var section_length: float = _flexi_section_len.get(obj_uuid, 0.1)

		# Current anchor state from root transform
		var base_pos: Vector3 = root.global_position
		var base_rot: Quaternion = root.global_transform.basis.orthonormalized().get_rotation_quaternion()
		var anchor_dir: Vector3 = base_rot * Vector3.UP
		var prim_scale: Vector3 = _flexi_scales.get(obj_uuid, Vector3.ONE)
		var flex_length: float = prim_scale.y

		# Update anchor section (section 0 — always locked to the base of the prim)
		sections[0]["position"] = base_pos - anchor_dir * (flex_length * 0.5)
		sections[0]["direction"] = anchor_dir

		# SL flexi parameters
		var tension: float = params.get("tension", 1.0)
		var drag: float = params.get("drag", 2.0)
		var gravity_val: float = params.get("gravity", 0.3)
		var wind: float = params.get("wind", 0.0)
		var user_force_arr: Array = params.get("force", [0, 0, 0])
		var user_force := Vector3(user_force_arr[0], user_force_arr[1], user_force_arr[2])

		# ── Coefficients (matching Firestorm's doFlexibleUpdate) ──────
		# Tension → restoring force factor
		var t_factor: float = tension * 0.1
		t_factor = t_factor * (1.0 - pow(0.85, delta * 30.0))
		t_factor = minf(t_factor, MAX_TENSION_FORCE)

		# Drag → friction / momentum
		var friction_coeff: float = pow(10.0, (drag * 2.0 + 1.0) * delta)
		friction_coeff = maxf(friction_coeff, 1.0)
		var momentum: float = 1.0 / friction_coeff

		# Force scaling: section_length * delta (longer sections → bigger forces)
		var force_factor: float = section_length * delta

		# Max bend angle per section (matching Firestorm: atan(section_length * 2))
		var max_angle: float = atan(section_length * 2.0)

		# ── Simulate sections 1..BONE_COUNT ──────────────────────────
		# Use local vars to avoid GDScript dict-value-type copy gotcha
		for i in range(1, BONE_COUNT + 1):
			var sec: Dictionary = sections[i]
			var pos: Vector3 = sec["position"]
			var vel: Vector3 = sec["velocity"]
			var last_pos: Vector3 = pos

			# Gravity (world -Y in Godot)
			pos.y -= gravity_val * force_factor

			# User-defined force
			pos += user_force * force_factor

			# Tension: restoring force toward parent's direction
			var parent_pos: Vector3 = sections[i - 1]["position"]
			var parent_dir: Vector3
			if i == 1:
				parent_dir = sections[0]["direction"]
			else:
				parent_dir = sections[i - 2]["direction"]

			var current_vec: Vector3 = pos - parent_pos
			var desired_vec: Vector3 = parent_dir * section_length
			pos += (desired_vec - current_vec) * t_factor

			# Inertia (Verlet: velocity from previous frame × momentum)
			pos += vel * momentum

			# ── Clamp: normalize direction, constrain distance ──────
			var new_dir: Vector3 = pos - parent_pos
			if new_dir.length_squared() < 0.0001:
				new_dir = sections[i - 1]["direction"]
			else:
				new_dir = new_dir.normalized()

			# Angle clamp (shortestArc from parent direction to new direction)
			var parent_frame_dir: Vector3 = sections[i - 1]["direction"]
			var delta_rot: Quaternion = _shortest_arc(parent_frame_dir, new_dir)
			var angle: float = delta_rot.get_angle()
			if angle > max_angle:
				var axis: Vector3 = delta_rot.get_axis()
				if axis.length_squared() > 0.001:
					delta_rot = Quaternion(axis, max_angle)
				else:
					delta_rot = Quaternion.IDENTITY

			# Apply clamped rotation to parent direction, then fix position
			new_dir = delta_rot * parent_frame_dir
			pos = parent_pos + new_dir * section_length

			# Velocity for next frame (classic Verlet)
			vel = pos - last_pos
			if vel.length_squared() > 1.0:
				vel = vel.normalized()

			# Write back to section dictionary
			sec["position"] = pos
			sec["velocity"] = vel
			sec["direction"] = new_dir

		# ── Convert world-space sections to bone rotations ───────────
		_update_bones(obj_uuid, skeleton, root, sections)


## Convert world-space section directions to per-bone pose rotations.
## Each bone's pose rotation is the incremental bend at that joint, expressed
## in the bone's parent frame.
func _update_bones(obj_uuid: String, skeleton: Skeleton3D, root: Node3D, sections: Array) -> void:
	# Accumulated basis walking down the chain — starts at root orientation
	var accumulated_basis: Basis = root.global_transform.basis.orthonormalized()

	# Bone 0 (anchor) has no pose rotation — it's fixed
	for i in range(1, BONE_COUNT + 1):
		var section_dir_world: Vector3 = sections[i]["direction"]
		# Convert world direction to the bone's local frame
		var local_dir: Vector3 = accumulated_basis.inverse() * section_dir_world
		var local_dir_len: float = local_dir.length()
		if local_dir_len < 0.001:
			skeleton.set_bone_pose_rotation(i, Quaternion.IDENTITY)
		else:
			local_dir /= local_dir_len
			var pose_rot: Quaternion = _shortest_arc(Vector3.UP, local_dir)
			skeleton.set_bone_pose_rotation(i, pose_rot)
			accumulated_basis = accumulated_basis * Basis(pose_rot)


## Build a Skin resource with inverse bind matrices for each bone.
func _build_skin(skeleton: Skeleton3D) -> Skin:
	var skin := Skin.new()
	for i in range(skeleton.get_bone_count()):
		skin.add_bind(i, skeleton.get_bone_global_rest(i).affine_inverse())
	return skin


## Build rigged mesh: vertices pre-scaled by prim_scale, bone weights along Y.
## The mesh from prim_mesh_generator is in Godot space (path along Y via _sl_to_godot).
func _build_rigged_mesh(source_mesh: Mesh, prim_scale: Vector3) -> ArrayMesh:
	var rigged := ArrayMesh.new()

	for surf_idx in range(source_mesh.get_surface_count()):
		var arrays := source_mesh.surface_get_arrays(surf_idx)
		if arrays.size() == 0:
			continue

		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
		var uvs = arrays[Mesh.ARRAY_TEX_UV] if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
		var indices = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()

		var vert_count := vertices.size()

		# Pre-scale vertices by prim_scale (component-wise, both in Godot space)
		var scaled_verts := PackedVector3Array()
		scaled_verts.resize(vert_count)

		# Bone weights based on UNSCALED vertex Y (path axis, range [-0.5, +0.5])
		var bone_indices := PackedInt32Array()
		bone_indices.resize(vert_count * 4)
		var bone_weights := PackedFloat32Array()
		bone_weights.resize(vert_count * 4)

		for v_idx in range(vert_count):
			var v: Vector3 = vertices[v_idx]

			# Scale vertex positions to match bone rest positions
			scaled_verts[v_idx] = Vector3(v.x * prim_scale.x, v.y * prim_scale.y, v.z * prim_scale.z)

			# Map unscaled vertex Y [-0.5, +0.5] to bones [0..BONE_COUNT].
			# bone 0 = anchor (base), bones 1..BONE_COUNT = simulated chain.
			var t: float = (v.y + 0.5) * float(BONE_COUNT)
			t = clampf(t, 0.0, float(BONE_COUNT) - 0.001)

			var bone_lo: int = int(t)
			var bone_hi: int = mini(bone_lo + 1, BONE_COUNT)
			var frac: float = t - float(bone_lo)

			var base := v_idx * 4
			bone_indices[base + 0] = bone_lo
			bone_indices[base + 1] = bone_hi
			bone_indices[base + 2] = 0
			bone_indices[base + 3] = 0
			bone_weights[base + 0] = 1.0 - frac
			bone_weights[base + 1] = frac
			bone_weights[base + 2] = 0.0
			bone_weights[base + 3] = 0.0

		# Assemble output surface
		var out_arrays := []
		out_arrays.resize(Mesh.ARRAY_MAX)
		out_arrays[Mesh.ARRAY_VERTEX] = scaled_verts
		if normals.size() > 0:
			out_arrays[Mesh.ARRAY_NORMAL] = normals
		if uvs.size() > 0:
			out_arrays[Mesh.ARRAY_TEX_UV] = uvs
		if indices.size() > 0:
			out_arrays[Mesh.ARRAY_INDEX] = indices
		out_arrays[Mesh.ARRAY_BONES] = bone_indices
		out_arrays[Mesh.ARRAY_WEIGHTS] = bone_weights

		var fmt := Mesh.ARRAY_FORMAT_VERTEX | Mesh.ARRAY_FORMAT_BONES | Mesh.ARRAY_FORMAT_WEIGHTS
		if normals.size() > 0:
			fmt |= Mesh.ARRAY_FORMAT_NORMAL
		if uvs.size() > 0:
			fmt |= Mesh.ARRAY_FORMAT_TEX_UV
		if indices.size() > 0:
			fmt |= Mesh.ARRAY_FORMAT_INDEX

		rigged.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, out_arrays, [], {}, fmt)

	return rigged


## Update flexi prim world transform (called when the linkset root or parent moves).
## Updates root node AND re-anchors the simulation.
func update_transform(obj_uuid: String, world_pos: Vector3, world_rot: Quaternion) -> void:
	var root: Node3D = _flexi_roots.get(obj_uuid)
	if root != null and is_instance_valid(root):
		root.position = world_pos
		root.quaternion = world_rot


## Apply face materials to the flexi mesh instance.
func get_mesh_instance(obj_uuid: String) -> MeshInstance3D:
	return _flexi_meshes.get(obj_uuid)


## Shortest-arc quaternion rotation from unit vector `from` to unit vector `to`.
## Matches Firestorm's LLQuaternion::shortestArc().
static func _shortest_arc(from: Vector3, to: Vector3) -> Quaternion:
	var d: float = from.dot(to)
	if d > 0.9999:
		return Quaternion.IDENTITY
	if d < -0.9999:
		# Nearly opposite — pick an arbitrary perpendicular axis
		var axis: Vector3 = Vector3.RIGHT.cross(from)
		if axis.length_squared() < 0.001:
			axis = Vector3.FORWARD.cross(from)
		return Quaternion(axis.normalized(), PI)
	var c: Vector3 = from.cross(to)
	var q := Quaternion(c.x, c.y, c.z, 1.0 + d)
	return q.normalized()


## Destroy a flexi prim and free all resources.
func destroy_flexi(obj_uuid: String) -> void:
	if _flexi_roots.has(obj_uuid):
		var root: Node3D = _flexi_roots[obj_uuid]
		if is_instance_valid(root):
			root.queue_free()
	_flexi_roots.erase(obj_uuid)
	_flexi_skeletons.erase(obj_uuid)
	_flexi_meshes.erase(obj_uuid)
	_flexi_params.erase(obj_uuid)
	_flexi_sections.erase(obj_uuid)
	_flexi_section_len.erase(obj_uuid)
	_flexi_scales.erase(obj_uuid)
