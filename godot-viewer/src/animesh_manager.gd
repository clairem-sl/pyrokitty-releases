extends RefCounted

## Animesh skeleton instantiation, animation building, and per-frame bone evaluation.

var sm  # scene_manager reference


func _init(scene_manager) -> void:
	sm = scene_manager


# ─── Skeleton Instantiation ──────────────────────────

## Recursively register all descendants of a parent as animesh children.
## Handles attachment linksets: root prim is direct child of avatar, child prims
## are grandchildren but still rig to the same avatar skeleton.
func register_descendants(parent_id: int, root_id: int) -> void:
	if not sm.object_children.has(parent_id):
		return
	for child_id: int in sm.object_children[parent_id]:
		if not sm.animesh_root_for.has(child_id):
			sm.animesh_root_for[child_id] = root_id
			var child_mid: String = sm.object_mesh_id.get(child_id, "")
			if not child_mid.is_empty() and sm.mesh_cache.has(child_mid) and sm.rigged_mesh_paths.has(child_mid):
				instantiate_mesh(child_id, child_mid, root_id)
				if sm.object_faces.has(child_id) and sm.objects.has(child_id):
					sm.asset_pipeline.apply_face_materials(sm.objects[child_id], child_id, sm.object_faces[child_id])
		# Recurse into grandchildren
		register_descendants(child_id, root_id)


## Instantiate a rigged mesh as Skeleton3D + MeshInstance3D under the animesh root Node3D.
## Called from asset_pipeline when a rigged mesh loads for an animesh-related object.
func instantiate_mesh(local_id: int, mesh_id: String, animesh_root_id: int) -> void:
	# Guard against double instantiation (can be called from cache hit + _apply_mesh_to_pending)
	if sm.animesh_skeletons.has(local_id):
		return
	var glb_path: String = sm.rigged_mesh_paths.get(mesh_id, "")
	if glb_path.is_empty():
		push_warning("[Animesh] No GLB path for rigged mesh %s" % mesh_id)
		return
	var root_node: Node3D = sm.animesh_roots.get(animesh_root_id)
	if root_node == null:
		push_warning("[Animesh] No root node for animesh root %d" % animesh_root_id)
		return

	# Parse GLB and generate full scene tree (includes Skeleton3D + MeshInstance3D)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(glb_path, state)
	if err != OK:
		push_warning("[Animesh] Failed to parse GLB %s: %s" % [glb_path, error_string(err)])
		return
	var scene: Node = doc.generate_scene(state)
	if scene == null:
		push_warning("[Animesh] generate_scene returned null for %s" % glb_path)
		return

	# Find Skeleton3D and MeshInstance3D in the generated scene tree
	var skeleton: Skeleton3D = _find_node_of_type(scene, "Skeleton3D")
	var mesh_instance: MeshInstance3D = _find_node_of_type(scene, "MeshInstance3D")
	if skeleton == null or mesh_instance == null:
		push_warning("[Animesh] No Skeleton3D/MeshInstance3D in GLB for object %d" % local_id)
		scene.queue_free()
		return

	# Create a wrapper node for this child's offset transform
	var wrapper := Node3D.new()
	wrapper.name = "rigged_%d" % local_id
	# Don't apply linkset child offset — rigged mesh vertices are in skeleton space,
	# positioned by bone transforms, not the prim's linkset position.
	var rsi = sm.objects.get(local_id)

	# Reparent skeleton and mesh_instance out of the generated scene into our wrapper
	skeleton.get_parent().remove_child(skeleton)
	if mesh_instance.get_parent() != skeleton:
		mesh_instance.get_parent().remove_child(mesh_instance)
		skeleton.add_child(mesh_instance)
	wrapper.add_child(skeleton)
	mesh_instance.skeleton = mesh_instance.get_path_to(skeleton)

	# Add wrapper to animesh root
	root_node.add_child(wrapper)

	# Store references
	sm.animesh_skeletons[local_id] = skeleton
	sm.animesh_mesh_instances[local_id] = mesh_instance
	# Maintain per-root skeleton list for fast process_animesh iteration
	if not sm.animesh_root_skeletons.has(animesh_root_id):
		sm.animesh_root_skeletons[animesh_root_id] = []
	sm.animesh_root_skeletons[animesh_root_id].append(skeleton)

	# Double-sided shadow casting reduces shadow acne near deformed joints.
	# Bone bends create steep surface angles that single-sided bias can't handle.
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_DOUBLE_SIDED

	# Hide the RSInstance placeholder (keep it for metadata/transform tracking)
	# Also disable shadow casting — hidden instances can still cast shadows
	if rsi != null:
		RenderingServer.instance_set_visible(rsi.rid, false)
		RenderingServer.instance_geometry_set_cast_shadows_setting(
			rsi.rid, RenderingServer.SHADOW_CASTING_SETTING_OFF)

	# If we already have pending animations for this root, apply them
	if sm.animesh_roots.has(animesh_root_id):
		_apply_pending_animations(local_id)

	print("[Animesh] Rigged mesh instantiated for object %d (root %d), bones: %d" % [
		local_id, animesh_root_id, skeleton.get_bone_count()])

	# Clean up the now-empty generated scene
	scene.queue_free()


## Find the first node of a given class in the scene tree (recursive DFS)
func _find_node_of_type(node: Node, type_name: String) -> Node:
	if node.get_class() == type_name:
		return node
	for child in node.get_children():
		var found := _find_node_of_type(child, type_name)
		if found != null:
			return found
	return null


# ─── Animation Handling ──────────────────────────────

## Handle animations_batch — bridge has collected ALL animation data for a root.
## Contains the full set of animations with their parsed keyframe data.
## Replaces the old object_animation + avatar_animation + animation_ready flow.
func handle_animations_batch(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	var animations: Dictionary = msg.get("animations", {})
	print("[AvatarDebug] animations_batch: localId=%d, %d animations, is_animesh_root=%s, has_skeletons=%s" % [
		local_id, animations.size(),
		str(sm.animesh_roots.has(local_id)),
		str(sm.animesh_root_skeletons.has(local_id) and sm.animesh_root_skeletons[local_id].size() > 0)])
	if local_id == 0 or animations.is_empty():
		return

	# Cache all animation data and build pending anim list
	var anim_ids: Array = []
	for anim_id: String in animations:
		var data: Dictionary = animations[anim_id]
		if data.is_empty():
			continue
		# Build and cache Animation resource + raw data
		if not sm.animesh_anim_data.has(anim_id):
			var anim := _build_animation(anim_id, data)
			if anim != null:
				sm.animesh_anim_cache[anim_id] = anim
				sm.animesh_anim_data[anim_id] = data
		anim_ids.append(anim_id)

	sm.animesh_pending_anims[local_id] = anim_ids

	# Trigger single rebuild for this root
	var found_skeleton := false
	for obj_id: int in sm.animesh_skeletons:
		if sm.animesh_root_for.get(obj_id, 0) == local_id:
			found_skeleton = true
			_apply_pending_animations(obj_id)
			break
	if not found_skeleton:
		print("[Animesh] Batch for localId=%d: %d anims cached, but NO skeleton found yet" % [local_id, anim_ids.size()])


## Apply any pending animations to a specific animesh root.
## Merges all pending animations by per-joint priority and stores merged keyframe data
## for manual per-frame evaluation (required because SL composes bone rotations as
## world = local * parent, while Godot uses world = parent * local).
func _apply_pending_animations(obj_id: int) -> void:
	var root_id: int = sm.animesh_root_for.get(obj_id, 0)
	if root_id == 0:
		return
	var pending_anims: Array = sm.animesh_pending_anims.get(root_id, [])
	if pending_anims.is_empty():
		return

	# Only need to build eval data once per root (not per child mesh)
	var root_skels: Array = sm.animesh_root_skeletons.get(root_id, [])
	if root_skels.is_empty():
		return

	# Collect all available animations with their raw data
	var available: Array = []
	var missing: int = 0
	for anim_id: String in pending_anims:
		if sm.animesh_anim_data.has(anim_id):
			available.append(sm.animesh_anim_data[anim_id] as Dictionary)
		else:
			missing += 1

	if available.is_empty():
		print("[Animesh] _apply_pending root=%d: %d pending, 0 available, %d missing" % [root_id, pending_anims.size(), missing])
		return
	print("[Animesh] _apply_pending root=%d: %d available, %d missing, %d total joints" % [root_id, available.size(), missing, available.reduce(func(acc: int, d: Dictionary): return acc + (d.get("joints", []) as Array).size(), 0)])

	# Build per-joint priority map: joint_name → {priority, data_index}
	var joint_best: Dictionary = {}
	for ai in range(available.size()):
		var data: Dictionary = available[ai]
		var base_priority: int = int(data.get("priority", 0))
		var joints: Array = data.get("joints", [])
		for joint_data: Dictionary in joints:
			var jname: String = str(joint_data.get("name", ""))
			if jname.is_empty():
				continue
			var jpri: int = int(joint_data.get("priority", base_priority))
			if not joint_best.has(jname) or jpri >= joint_best[jname]["priority"]:
				joint_best[jname] = {"priority": jpri, "data_idx": ai, "joint_data": joint_data}

	# Build merged joint keyframe map (SL space — NOT coordinate-converted)
	# Each joint tracks which animation it came from (for independent loop timing).
	var merged_joints: Dictionary = {}  # joint_name -> {rot_keys, pos_keys, duration, loop}
	for jname: String in joint_best:
		var jd: Dictionary = joint_best[jname]["joint_data"]
		var ai: int = joint_best[jname]["data_idx"]
		var src_anim: Dictionary = available[ai]
		var rot_keys: Array = jd.get("rotationKeys", [])
		var pos_keys: Array = jd.get("positionKeys", [])
		merged_joints[jname] = {
			"rot_keys": rot_keys,
			"pos_keys": pos_keys,
			"duration": float(src_anim.get("duration", 1.0)),
			"loop": src_anim.get("loop", false),
		}

	# Store eval data — preserve elapsed time if already running
	var prev_elapsed: float = 0.0
	if sm.animesh_eval.has(root_id):
		prev_elapsed = sm.animesh_eval[root_id].get("elapsed", 0.0)
	sm.animesh_eval[root_id] = {
		"elapsed": prev_elapsed,
		"joints": merged_joints,
	}
	sm.animesh_eval_active = true


# ─── Per-Frame Bone Evaluation ───────────────────────

## Per-frame animesh animation evaluation.
## Computes bone poses ONCE on a reference skeleton per root, then applies
## the cached results by bone name to all other skeletons sharing that root.
## SL xform.cpp:80: mWorldRotation = mRotation * mParent->getWorldRotation()
## SL's operator*(a,b) = Hamilton(b*a), so this is Hamilton(parent * local).
## Godot uses standard Hamilton, so we write: world = parent * local.
func process_animesh(delta: float) -> void:
	for root_id: int in sm.animesh_eval:
		var eval: Dictionary = sm.animesh_eval[root_id]

		# Advance wall-clock elapsed time
		eval["elapsed"] += delta
		var elapsed: float = eval["elapsed"]

		var joints: Dictionary = eval["joints"]  # joint_name -> {rot_keys, pos_keys, duration, loop}

		# Evaluate SL local rotations and positions (SL space, NOT converted).
		# Each joint loops independently at its own animation's duration.
		var sl_local_rot: Dictionary = {}  # joint_name -> Quaternion (SL space)
		var sl_local_pos: Dictionary = {}  # joint_name -> Vector3 (SL space, meters)
		for jname: String in joints:
			var jdata: Dictionary = joints[jname]
			var jdur: float = jdata["duration"]
			if jdur <= 0.0:
				continue
			var t: float
			if jdata["loop"]:
				t = fmod(elapsed, jdur)
			else:
				t = minf(elapsed, jdur)
			var rot_keys: Array = jdata["rot_keys"]
			if rot_keys.size() > 0:
				sl_local_rot[jname] = _interp_sl_rotation(rot_keys, t)
			var pos_keys: Array = jdata["pos_keys"]
			if pos_keys.size() > 0:
				sl_local_pos[jname] = _interp_sl_position(pos_keys, t)

		# Get cached skeleton list for this root (O(1) lookup instead of full scan)
		var root_skeletons: Array = sm.animesh_root_skeletons.get(root_id, [])

		if root_skeletons.is_empty():
			continue

		# Compute full bone poses on the FIRST (reference) skeleton
		var ref_skel: Skeleton3D = root_skeletons[0]
		var sl_world: Dictionary = {}  # bone_idx -> Quaternion (SL space)
		var godot_world: Dictionary = {}  # bone_idx -> Quaternion (Godot space)
		# Cache results by bone NAME so other skeletons can reuse them
		var pose_cache: Dictionary = {}  # bone_name -> { "rot": Quaternion, "pos"?: Vector3 }

		# Track which bones have been animated (directly or via ancestor)
		var bone_animated: Dictionary = {}  # bone_idx -> bool

		for bi in range(ref_skel.get_bone_count()):
			var bname: String = ref_skel.get_bone_name(bi)
			var parent_bi: int = ref_skel.get_bone_parent(bi)

			var has_rot: bool = sl_local_rot.has(bname)
			var has_pos: bool = sl_local_pos.has(bname)
			var parent_was_animated: bool = bone_animated.get(parent_bi, false)

			# Only process bones that have animation data or an animated ancestor
			if not has_rot and not has_pos and not parent_was_animated:
				bone_animated[bi] = false
				continue  # No animation influence — leave at rest pose

			bone_animated[bi] = has_rot or has_pos or parent_was_animated

			# SL local rotation: from animation, or rest rotation if not animated
			var q_sl_local: Quaternion
			if has_rot:
				q_sl_local = sl_local_rot[bname]
			else:
				var rest_q: Quaternion = ref_skel.get_bone_rest(bi).basis.get_rotation_quaternion()
				q_sl_local = Quaternion(rest_q.x, -rest_q.z, rest_q.y, rest_q.w)

			var q_sl_parent_world: Quaternion = sl_world.get(parent_bi, Quaternion.IDENTITY)
			var q_sl_world: Quaternion = q_sl_parent_world * q_sl_local
			sl_world[bi] = q_sl_world

			var q_godot_world := Quaternion(
				q_sl_world.x, q_sl_world.z, -q_sl_world.y, q_sl_world.w).normalized()
			godot_world[bi] = q_godot_world

			# Derive Godot pose rotation
			var parent_godot_world: Quaternion = godot_world.get(parent_bi, Quaternion.IDENTITY)
			var rest_rot: Quaternion = ref_skel.get_bone_rest(bi).basis.get_rotation_quaternion()
			var combined_inv: Quaternion = (parent_godot_world * rest_rot).inverse()
			var pose_rot: Quaternion = (combined_inv * q_godot_world).normalized()
			ref_skel.set_bone_pose_rotation(bi, pose_rot)

			var entry: Dictionary = { "rot": pose_rot }

			if has_pos:
				var sl_pos: Vector3 = sl_local_pos[bname]
				var offset_godot := Vector3(sl_pos.x, sl_pos.z, -sl_pos.y)
				var rest_xf: Transform3D = ref_skel.get_bone_rest(bi)
				var rot_basis := Basis(rest_xf.basis.get_rotation_quaternion())
				var pose_pos: Vector3 = rot_basis.inverse() * offset_godot
				ref_skel.set_bone_pose_position(bi, pose_pos)
				entry["pos"] = pose_pos

			pose_cache[bname] = entry

		# Apply cached poses to remaining skeletons by bone name lookup
		for si in range(1, root_skeletons.size()):
			var skeleton: Skeleton3D = root_skeletons[si]
			for bi in range(skeleton.get_bone_count()):
				var bname: String = skeleton.get_bone_name(bi)
				if pose_cache.has(bname):
					var cached: Dictionary = pose_cache[bname]
					skeleton.set_bone_pose_rotation(bi, cached["rot"])
					if cached.has("pos"):
						skeleton.set_bone_pose_position(bi, cached["pos"])


# ─── Keyframe Interpolation ─────────────────────────

## Interpolate SL rotation keyframes at time t. Returns SL-space quaternion (w reconstructed).
func _interp_sl_rotation(keys: Array, t: float) -> Quaternion:
	if keys.is_empty():
		return Quaternion.IDENTITY

	# Find bracketing keyframes
	var k0: Dictionary = keys[0]
	if keys.size() == 1 or t <= float(k0.get("time", 0.0)):
		var v: Array = k0.get("value", [0, 0, 0])
		return _sl_quat_from_xyz(float(v[0]), float(v[1]), float(v[2]))

	var k1: Dictionary = keys[keys.size() - 1]
	if t >= float(k1.get("time", 0.0)):
		var v: Array = k1.get("value", [0, 0, 0])
		return _sl_quat_from_xyz(float(v[0]), float(v[1]), float(v[2]))

	# Binary search for bracketing pair
	var lo: int = 0
	var hi: int = keys.size() - 1
	while hi - lo > 1:
		var mid: int = (lo + hi) / 2
		if float(keys[mid].get("time", 0.0)) <= t:
			lo = mid
		else:
			hi = mid

	var t0: float = float(keys[lo].get("time", 0.0))
	var t1: float = float(keys[hi].get("time", 0.0))
	var frac: float = (t - t0) / maxf(t1 - t0, 0.0001)

	var v0: Array = keys[lo].get("value", [0, 0, 0])
	var v1: Array = keys[hi].get("value", [0, 0, 0])
	var q0: Quaternion = _sl_quat_from_xyz(float(v0[0]), float(v0[1]), float(v0[2]))
	var q1: Quaternion = _sl_quat_from_xyz(float(v1[0]), float(v1[1]), float(v1[2]))

	return q0.slerp(q1, frac)


## Interpolate SL position keyframes at time t. Returns SL-space Vector3 (meters).
func _interp_sl_position(keys: Array, t: float) -> Vector3:
	if keys.is_empty():
		return Vector3.ZERO

	var k0: Dictionary = keys[0]
	if keys.size() == 1 or t <= float(k0.get("time", 0.0)):
		var v: Array = k0.get("value", [0, 0, 0])
		return Vector3(float(v[0]), float(v[1]), float(v[2]))

	var k1: Dictionary = keys[keys.size() - 1]
	if t >= float(k1.get("time", 0.0)):
		var v: Array = k1.get("value", [0, 0, 0])
		return Vector3(float(v[0]), float(v[1]), float(v[2]))

	# Binary search for bracketing pair
	var lo: int = 0
	var hi: int = keys.size() - 1
	while hi - lo > 1:
		var mid: int = (lo + hi) / 2
		if float(keys[mid].get("time", 0.0)) <= t:
			lo = mid
		else:
			hi = mid

	var t0: float = float(keys[lo].get("time", 0.0))
	var t1: float = float(keys[hi].get("time", 0.0))
	var frac: float = (t - t0) / maxf(t1 - t0, 0.0001)

	var v0: Array = keys[lo].get("value", [0, 0, 0])
	var v1: Array = keys[hi].get("value", [0, 0, 0])
	var p0 := Vector3(float(v0[0]), float(v0[1]), float(v0[2]))
	var p1 := Vector3(float(v1[0]), float(v1[1]), float(v1[2]))

	return p0.lerp(p1, frac)


## Reconstruct SL quaternion from xyz components (w = sqrt(1 - x² - y² - z²), always >= 0)
func _sl_quat_from_xyz(x: float, y: float, z: float) -> Quaternion:
	var w_sq: float = 1.0 - x * x - y * y - z * z
	var w: float = sqrt(max(w_sq, 0.0))
	return Quaternion(x, y, z, w)


# ─── Animation Resource Building ────────────────────

## Remap animation track paths to use the actual skeleton node name and valid bone indices.
## Also compensates rotation keyframes for bone rest pose: Godot applies final = rest * pose,
## but SL animation rotations are absolute, so we set pose = rest^{-1} * desired_rotation.
func _remap_animation_tracks(src: Animation, skel_name: String, skeleton: Skeleton3D) -> Animation:
	var anim := src.duplicate()
	for i in range(anim.get_track_count()):
		var path: NodePath = anim.track_get_path(i)
		var path_str: String = str(path)
		# Track paths are "Skeleton3D:bone_name" — replace skeleton name
		if ":" in path_str:
			var parts: PackedStringArray = path_str.split(":")
			var bone_name: String = parts[1]
			var bone_idx: int = skeleton.find_bone(bone_name)
			if bone_idx >= 0:
				anim.track_set_path(i, NodePath("%s:%s" % [skel_name, bone_name]))
				# Compensate rotation tracks for bone rest pose
				if anim.track_get_type(i) == Animation.TYPE_ROTATION_3D:
					var rest_rot: Quaternion = skeleton.get_bone_rest(bone_idx).basis.get_rotation_quaternion()
					if not rest_rot.is_equal_approx(Quaternion.IDENTITY):
						var inv_rest: Quaternion = rest_rot.inverse()
						for k in range(anim.track_get_key_count(i)):
							var q: Quaternion = anim.track_get_key_value(i, k)
							anim.track_set_key_value(i, k, (inv_rest * q).normalized())
			else:
				# Bone not in this skeleton — disable the track
				anim.track_set_enabled(i, false)
	return anim


## Build a Godot Animation resource from parsed SL animation keyframe data
func _build_animation(anim_id: String, data: Dictionary) -> Animation:
	var anim := Animation.new()
	var duration: float = float(data.get("duration", 1.0))
	anim.length = duration
	if data.get("loop", false):
		anim.loop_mode = Animation.LOOP_LINEAR

	var joints: Array = data.get("joints", [])
	for joint_data: Dictionary in joints:
		var joint_name: String = str(joint_data.get("name", ""))
		if joint_name.is_empty():
			continue

		# Rotation track
		var rot_keys: Array = joint_data.get("rotationKeys", [])
		if rot_keys.size() > 0:
			var track_idx := anim.add_track(Animation.TYPE_ROTATION_3D)
			anim.track_set_path(track_idx, NodePath("Skeleton3D:%s" % joint_name))
			anim.track_set_interpolation_type(track_idx, Animation.INTERPOLATION_LINEAR)
			for kf: Dictionary in rot_keys:
				var t: float = float(kf.get("time", 0.0))
				var v: Array = kf.get("value", [0, 0, 0])
				# SL: xyz are quaternion components in [-1,1], reconstruct w
				var sx: float = float(v[0])
				var sy: float = float(v[1])
				var sz: float = float(v[2])
				var w_sq: float = 1.0 - sx * sx - sy * sy - sz * sz
				var sw: float = sqrt(max(w_sq, 0.0))
				# SL->Godot quaternion: (x,y,z,w) -> (x,z,-y,w)
				var q := Quaternion(sx, sz, -sy, sw).normalized()
				anim.rotation_track_insert_key(track_idx, t, q)

		# Position track
		var pos_keys: Array = joint_data.get("positionKeys", [])
		if pos_keys.size() > 0:
			var track_idx := anim.add_track(Animation.TYPE_POSITION_3D)
			anim.track_set_path(track_idx, NodePath("Skeleton3D:%s" % joint_name))
			anim.track_set_interpolation_type(track_idx, Animation.INTERPOLATION_LINEAR)
			for kf: Dictionary in pos_keys:
				var t: float = float(kf.get("time", 0.0))
				var v: Array = kf.get("value", [0, 0, 0])
				# SL->Godot position: (x,y,z) -> (x,z,-y)
				var gp := Vector3(float(v[0]), float(v[2]), -float(v[1]))
				anim.position_track_insert_key(track_idx, t, gp)

	return anim
