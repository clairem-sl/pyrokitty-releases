extends RefCounted

## Object and avatar CRUD, linkset hierarchy, and interpolation.

var sm  # scene_manager reference

# Interpolation constants
const AVATAR_MAX_INTERP_DIST: float = 10.0  # snap if further than this (meters)
const AVATAR_SLERP_SPEED: float = 15.0      # rotation slerp rate (per second)
const PHYSICS_TIMESTEP: float = 1.0 / 45.0
const INTERP_PHASE_OUT_TIME: float = 2.0  # Start fading extrapolation
const INTERP_MAX_TIME: float = 3.0        # Stop extrapolation entirely
const BLEND_TIME: float = 0.25            # Seconds to blend correction offset to zero
const BLEND_SNAP_DIST: float = 10.0       # Snap if correction exceeds this (meters)

const _DEBUG_UUID := "bbafd512-4ab8-9878-0e68-eba086760821"

# Self avatar state
var _first_person_mode: bool = false


func _init(scene_manager) -> void:
	sm = scene_manager


# ─── Coordinate Conversion ───────────────────────────

## Convert SL position array [x, y, z] to Godot Vector3
func sl_to_godot_pos(sl_pos: Array) -> Vector3:
	return Vector3(sl_pos[0], sl_pos[2], -sl_pos[1])


## Convert SL quaternion array [x, y, z, w] to Godot Quaternion
func sl_to_godot_quat(sl_rot: Array) -> Quaternion:
	return Quaternion(sl_rot[0], sl_rot[2], -sl_rot[1], sl_rot[3])


## Convert SL scale array [x, y, z] to Godot Vector3
func sl_to_godot_scale(sl_scale: Array) -> Vector3:
	return Vector3(sl_scale[0], sl_scale[2], sl_scale[1])


# ─── Object Handlers ──────────────────────────────────

func handle_object_create(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	if local_id == 0:
		return
	if str(msg.get("uuid", "")) == _DEBUG_UUID:
		print("[GD ObjDebug] CREATE localId=%d pos=%s existing=%s" % [local_id, str(msg.get("position", [])), str(sm.objects.has(local_id))])

	var parent_id: int = int(msg.get("parentId", 0))

	# Remove existing if duplicate
	if sm.objects.has(local_id):
		_cleanup_object(local_id)

	# Store object metadata (uuid; name/description arrive later via object_properties)
	sm.object_meta[local_id] = {
		"uuid": str(msg.get("uuid", "")),
		"name": "",
		"description": "",
	}

	var mesh_id: String = msg.get("meshId", "")
	if not mesh_id.is_empty():
		sm.object_mesh_id[local_id] = mesh_id
	var shape: Dictionary = msg.get("shape", {})
	var rsi = sm.RSInstance.new(sm._scenario, sm._vis_far, sm._vis_fade)

	if not mesh_id.is_empty() and sm.mesh_cache.has(mesh_id):
		# Real mesh already loaded — use it
		rsi.set_mesh(sm.mesh_cache[mesh_id])
	elif not mesh_id.is_empty():
		# Mesh placeholder while waiting for mesh data
		rsi.set_mesh(sm.object_mesh)
		if not sm.mesh_load_failed.has(mesh_id):
			sm.pending_meshes[local_id] = mesh_id
			if not sm._pending_by_mesh.has(mesh_id):
				sm._pending_by_mesh[mesh_id] = []
			sm._pending_by_mesh[mesh_id].append(local_id)
	elif not shape.is_empty():
		# Procedural prim geometry from shape parameters
		rsi.set_mesh(sm.prim_generator.get_or_generate(shape))
	else:
		# Ultimate fallback — box placeholder
		rsi.set_mesh(sm.object_mesh)

	# Apply per-face texture materials
	var faces: Array = msg.get("faces", [])
	if faces.size() > 0:
		sm.object_faces[local_id] = faces
		sm.asset_pipeline.apply_face_materials(rsi, local_id, faces)
	else:
		# No texture info — use default gray
		rsi.set_material_override(sm.object_material)

	# Apply transform
	var pos: Array = msg.get("position", [0, 0, 0])
	var rot: Array = msg.get("rotation", [0, 0, 0, 1])
	var scl: Array = msg.get("scale", [0.5, 0.5, 0.5])

	var godot_pos := sl_to_godot_pos(pos)
	var godot_rot := sl_to_godot_quat(rot)
	var godot_scale := sl_to_godot_scale(scl)

	rsi.scl = godot_scale  # SL prims have independent scale — no compensation

	if parent_id > 0:
		# Child prim — store relative offset for linkset movement
		sm.object_parent[local_id] = parent_id
		sm.child_offset_pos[local_id] = godot_pos
		sm.child_offset_rot[local_id] = godot_rot

		if not sm.object_children.has(parent_id):
			sm.object_children[parent_id] = []
		sm.object_children[parent_id].append(local_id)

		if sm.objects.has(parent_id):
			# Parent exists — compute world position from parent + offset
			var parent_rsi = sm.objects[parent_id]
			rsi.pos = parent_rsi.pos + parent_rsi.rot * godot_pos
			rsi.rot = parent_rsi.rot * godot_rot
		else:
			# Parent hasn't arrived — use offset as-is (will be corrected when parent arrives)
			rsi.pos = godot_pos
			rsi.rot = godot_rot
			if not sm.pending_children.has(parent_id):
				sm.pending_children[parent_id] = []
			sm.pending_children[parent_id].append(local_id)
	else:
		# Root prim — position is world absolute
		rsi.pos = godot_pos
		rsi.rot = godot_rot

	rsi.push_transform()
	sm.objects[local_id] = rsi

	# Animesh root detection — create a Node3D in the scene tree for skeleton parenting
	if msg.get("animesh", false):
		var animesh_node := Node3D.new()
		animesh_node.name = "animesh_%d" % local_id
		sm.add_child(animesh_node)
		animesh_node.position = rsi.pos
		animesh_node.quaternion = rsi.rot
		# SL ControlAvatar uses mScaleConstraintFixup (default 1.0) — prim scale does NOT
		# affect the rendered animesh character size. The skeleton is at natural bind-pose size.
		animesh_node.scale = Vector3.ONE
		sm.animesh_roots[local_id] = animesh_node
		sm.animesh_root_for[local_id] = local_id
		print("[Animesh] Root object %d created" % local_id)
		# Retroactively check existing children — they may have arrived before the root
		# and their cached rigged meshes would have skipped _apply_mesh_to_pending
		if sm.object_children.has(local_id):
			for child_id: int in sm.object_children[local_id]:
				sm.animesh_root_for[child_id] = local_id
				var child_mid: String = sm.object_mesh_id.get(child_id, "")
				if not child_mid.is_empty() and sm.mesh_cache.has(child_mid) and sm.rigged_mesh_paths.has(child_mid):
					_instantiate_animesh_mesh(child_id, child_mid, local_id)

	# Track children of animesh roots
	if parent_id > 0 and sm.animesh_roots.has(parent_id):
		sm.animesh_root_for[local_id] = parent_id

	# If this object has a cached rigged mesh and belongs to an animesh linkset, instantiate now
	# (bypasses _apply_mesh_to_pending which only runs for uncached meshes)
	if sm.animesh_root_for.has(local_id):
		var ar_id: int = sm.animesh_root_for[local_id]
		if not mesh_id.is_empty() and sm.mesh_cache.has(mesh_id) and sm.rigged_mesh_paths.has(mesh_id):
			_instantiate_animesh_mesh(local_id, mesh_id, ar_id)

	# Create light if this object is a light source
	if msg.has("light") and msg["light"] is Dictionary:
		sm.light_mgr.create_or_update_light(local_id, msg["light"], rsi)

	# If this is a root and we have pending children, fix their world positions
	if parent_id == 0 and sm.pending_children.has(local_id):
		for child_id: int in sm.pending_children[local_id]:
			if sm.objects.has(child_id) and sm.child_offset_pos.has(child_id):
				var child_rsi = sm.objects[child_id]
				child_rsi.pos = rsi.pos + rsi.rot * sm.child_offset_pos[child_id]
				child_rsi.rot = rsi.rot * sm.child_offset_rot[child_id]
				child_rsi.push_transform()
		sm.pending_children.erase(local_id)


func handle_object_update_batch(msg: Dictionary) -> void:
	var obj_list: Array = msg.get("objects", [])
	for obj: Dictionary in obj_list:
		var local_id: int = int(obj.get("localId", 0))
		if local_id == 0:
			continue

		var rsi = sm.objects.get(local_id)
		if rsi == null:
			continue

		var _meta: Dictionary = sm.object_meta.get(local_id, {})
		if _meta.get("uuid", "") == _DEBUG_UUID:
			print("[GD ObjDebug] UPDATE localId=%d fseq=%s pos=%s vel=%s rsi.pos=%s" % [local_id, str(obj.get("_fseq", "?")), str(obj.get("position", [])), str(obj.get("velocity", [])), str(rsi.pos)])

		# Parse motion data for interpolation
		var has_motion := false
		var vel := Vector3.ZERO
		var accel := Vector3.ZERO
		var ang_vel := Vector3.ZERO
		if obj.has("velocity"):
			var sv: Array = obj["velocity"]
			vel = Vector3(sv[0], sv[2], -sv[1])
			if vel.length_squared() > 0.0001:
				has_motion = true
		if obj.has("acceleration"):
			var sa: Array = obj["acceleration"]
			accel = Vector3(sa[0], sa[2], -sa[1])
			if accel.length_squared() > 0.0001:
				has_motion = true
		if obj.has("angularVelocity"):
			var sav: Array = obj["angularVelocity"]
			ang_vel = Vector3(sav[0], sav[2], -sav[1])
			if ang_vel.length_squared() > 0.0001:
				has_motion = true

		if sm.object_parent.has(local_id):
			# Child prim — update offsets, parent interpolation handles world pos
			if obj.has("position"):
				sm.child_offset_pos[local_id] = sl_to_godot_pos(obj["position"])
			if obj.has("rotation"):
				sm.child_offset_rot[local_id] = sl_to_godot_quat(obj["rotation"])
			if obj.has("scale"):
				rsi.scl = sl_to_godot_scale(obj["scale"])
			# Recompute world transform from parent
			var parent_rsi = sm.objects.get(sm.object_parent[local_id])
			if parent_rsi and sm.child_offset_pos.has(local_id):
				rsi.pos = parent_rsi.pos + parent_rsi.rot * sm.child_offset_pos[local_id]
				rsi.rot = parent_rsi.rot * sm.child_offset_rot.get(local_id, Quaternion.IDENTITY)
			rsi.push_transform()
		elif has_motion:
			# Root prim with motion — blend from current visual pos toward server pos
			var server_pos: Vector3 = rsi.pos
			if obj.has("position"):
				server_pos = sl_to_godot_pos(obj["position"])
			var server_rot: Quaternion = rsi.rot
			if obj.has("rotation"):
				server_rot = sl_to_godot_quat(obj["rotation"])

			# Blend offset = how far visual pos is from server pos
			var blend_offset: Vector3 = rsi.pos - server_pos
			if blend_offset.length() > BLEND_SNAP_DIST:
				blend_offset = Vector3.ZERO  # too far, snap

			var target: Dictionary = {}
			target["pos"] = server_pos
			target["rot"] = server_rot
			target["vel"] = vel
			target["accel"] = accel
			target["angVel"] = ang_vel
			target["age"] = 0.0
			target["blend_offset"] = blend_offset
			target["blend_time"] = 0.0
			sm.object_targets[local_id] = target
			# Scale always snaps
			if obj.has("scale"):
				rsi.scl = sl_to_godot_scale(obj["scale"])
				rsi.push_transform()
		else:
			# Root prim, no motion — snap immediately
			# BUT if the object is currently being interpolated (physics updates
			# arrived more recently via high-priority), this batch message is stale
			# from the low-priority queue. Skip position/rotation to avoid snapping backward.
			if sm.object_targets.has(local_id):
				# Only allow scale changes from stale batch updates
				if obj.has("scale"):
					rsi.scl = sl_to_godot_scale(obj["scale"])
					rsi.push_transform()
			else:
				if obj.has("position"):
					rsi.pos = sl_to_godot_pos(obj["position"])
				if obj.has("rotation"):
					rsi.rot = sl_to_godot_quat(obj["rotation"])
				if obj.has("scale"):
					rsi.scl = sl_to_godot_scale(obj["scale"])
				rsi.push_transform()

			# Propagate root movement to all children
			if sm.object_children.has(local_id):
				_update_children_transforms(local_id)

		# Sync animesh root Node3D transform with RSInstance
		_sync_animesh_transform(local_id, rsi)

		# Update light (may be added, changed, or removed)
		if obj.has("light"):
			if obj["light"] is Dictionary:
				sm.light_mgr.create_or_update_light(local_id, obj["light"], rsi)
			else:
				# light: null means light was removed
				sm.light_mgr.destroy_light(local_id)
				sm.light_mgr._object_light_data.erase(local_id)
		elif sm.light_mgr.object_lights.has(local_id):
			# Transform changed — update light position
			sm.light_mgr.update_light_transform(local_id, rsi)


## Recompute world positions of all children from parent's current transform
func _update_children_transforms(parent_id: int) -> void:
	var parent_rsi = sm.objects.get(parent_id)
	if parent_rsi == null:
		return
	for child_id: int in sm.object_children[parent_id]:
		if sm.objects.has(child_id) and sm.child_offset_pos.has(child_id):
			var child_rsi = sm.objects[child_id]
			child_rsi.pos = parent_rsi.pos + parent_rsi.rot * sm.child_offset_pos[child_id]
			child_rsi.rot = parent_rsi.rot * sm.child_offset_rot[child_id]
			child_rsi.push_transform()
			# Move child's light with it
			if sm.light_mgr.object_lights.has(child_id):
				sm.light_mgr.update_light_transform(child_id, child_rsi)


## Sync animesh root Node3D transform with its RSInstance (call after any RSInstance transform change)
func _sync_animesh_transform(local_id: int, rsi) -> void:
	if sm.animesh_roots.has(local_id):
		var node: Node3D = sm.animesh_roots[local_id]
		if node and is_instance_valid(node):
			node.position = rsi.pos
			node.quaternion = rsi.rot
			# Scale stays at Vector3.ONE — SL ControlAvatar doesn't scale by prim size


# ─── Animesh ─────────────────────────────────────────

## Instantiate a rigged mesh as Skeleton3D + MeshInstance3D under the animesh root Node3D.
## Called from asset_pipeline when a rigged mesh loads for an animesh-related object.
func _instantiate_animesh_mesh(local_id: int, mesh_id: String, animesh_root_id: int) -> void:
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

	# Hide the RSInstance placeholder (keep it for metadata/transform tracking)
	if rsi != null:
		RenderingServer.instance_set_visible(rsi.rid, false)

	# If we already have pending animations for this root, apply them
	if sm.animesh_roots.has(animesh_root_id):
		_apply_pending_animations(local_id)

	# Log bones with non-identity rest rotations (these need compensation in animation)
	var non_identity_count: int = 0
	for bi in range(skeleton.get_bone_count()):
		var rest_rot: Quaternion = skeleton.get_bone_rest(bi).basis.get_rotation_quaternion()
		if not rest_rot.is_equal_approx(Quaternion.IDENTITY):
			non_identity_count += 1
			if non_identity_count <= 5:  # cap log spam
				print("[Animesh]   bone %s rest_rot=(%.3f, %.3f, %.3f, %.3f)" % [
					skeleton.get_bone_name(bi), rest_rot.x, rest_rot.y, rest_rot.z, rest_rot.w])
	print("[Animesh] Rigged mesh instantiated for object %d (root %d), skeleton bones: %d, non-identity rest: %d" % [
		local_id, animesh_root_id, skeleton.get_bone_count(), non_identity_count])

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


## Handle ObjectAnimation message — stores which animations an animesh root should play.
## Works even if the animesh root node hasn't been created yet (buffered in dictionary).
func handle_object_animation(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	var obj_uuid: String = str(msg.get("uuid", ""))
	var animations: Array = msg.get("animations", [])
	if local_id == 0 or animations.is_empty():
		print("[Animesh] handle_object_animation: ignored (localId=%d, anims=%d)" % [local_id, animations.size()])
		return

	# Store animation IDs for this root (used when skeleton loads later)
	var anim_ids: Array = []
	for a: Dictionary in animations:
		anim_ids.append(str(a.get("animId", "")))
	sm.animesh_pending_anims[local_id] = anim_ids
	print("[Animesh] handle_object_animation: localId=%d uuid=%s anims=%s" % [
		local_id, obj_uuid.left(8), str(anim_ids.map(func(s: String): return s.left(8)))])

	# Check if this localId is a known animesh root
	var is_root: bool = sm.animesh_roots.has(local_id)
	print("[Animesh]   is_known_root=%s, animesh_root_for entries=%d, animesh_skeletons entries=%d" % [
		str(is_root), sm.animesh_root_for.size(), sm.animesh_skeletons.size()])

	# Apply cached animations to all skeletons under this root
	var applied_count: int = 0
	for obj_id: int in sm.animesh_root_for:
		if sm.animesh_root_for[obj_id] == local_id and sm.animesh_skeletons.has(obj_id):
			print("[Animesh]   Applying to skeleton obj_id=%d" % obj_id)
			_apply_pending_animations(obj_id)
			applied_count += 1
	if applied_count == 0:
		print("[Animesh]   No skeletons ready yet for root %d (will apply when skeleton loads)" % local_id)


## Handle animation_ready — build Godot Animation resource from keyframe data
func handle_animation_ready(msg: Dictionary) -> void:
	var anim_id: String = str(msg.get("animId", ""))
	var data: Dictionary = msg.get("data", {})
	if anim_id.is_empty() or data.is_empty():
		print("[Animesh] handle_animation_ready: ignored (animId=%s, data empty=%s)" % [anim_id.left(8), str(data.is_empty())])
		return

	# Build and cache the Animation resource + raw data (for priority-based merging)
	var anim := _build_animation(anim_id, data)
	if anim == null:
		return
	sm.animesh_anim_cache[anim_id] = anim
	sm.animesh_anim_data[anim_id] = data
	print("[Animesh] Animation %s ready (%.1fs, %d joints, priority=%d, loop=%s)" % [
		anim_id.left(8), anim.length, data.get("joints", []).size(),
		int(data.get("priority", 0)), str(anim.loop_mode != Animation.LOOP_NONE)])

	# Apply to all animesh skeletons that are waiting for this animation
	for obj_id: int in sm.animesh_skeletons:
		_apply_pending_animations(obj_id)


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
	# Check if any skeleton exists for this root
	var has_skeleton: bool = false
	for oid: int in sm.animesh_root_for:
		if sm.animesh_root_for[oid] == root_id and sm.animesh_skeletons.has(oid):
			has_skeleton = true
			break
	if not has_skeleton:
		return

	# Collect all available animations with their raw data
	var available: Array = []
	for anim_id: String in pending_anims:
		if sm.animesh_anim_data.has(anim_id):
			available.append(sm.animesh_anim_data[anim_id] as Dictionary)

	if available.is_empty():
		return

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

	# Store eval data for this root — elapsed tracks wall clock, per-joint timing is independent
	sm.animesh_eval[root_id] = {
		"elapsed": 0.0,
		"joints": merged_joints,
	}
	sm.animesh_eval_active = true

	# Log which animation joints match skeleton bones vs unmatched (check ALL skeletons)
	var matched: Array = []
	var all_bone_names: Array = []
	for obj_id2: int in sm.animesh_root_for:
		if sm.animesh_root_for[obj_id2] != root_id:
			continue
		var skel2: Skeleton3D = sm.animesh_skeletons.get(obj_id2)
		if skel2 == null:
			continue
		for bi2 in range(skel2.get_bone_count()):
			var bn: String = skel2.get_bone_name(bi2)
			if bn not in all_bone_names:
				all_bone_names.append(bn)
	var unmatched: Array = []
	for jname2: String in merged_joints:
		if jname2 in all_bone_names:
			if jname2 not in matched:
				matched.append(jname2)
		else:
			if jname2 not in unmatched:
				unmatched.append(jname2)
	# Collect unique durations for logging
	var _durations: Dictionary = {}
	for _jn: String in merged_joints:
		var _d: float = merged_joints[_jn]["duration"]
		_durations[_d] = _durations.get(_d, 0) + 1
	print("[Animesh] _apply_pending_animations: root=%d, %d joints merged, durations=%s" % [
		root_id, merged_joints.size(), str(_durations)])
	if unmatched.size() > 0:
		print("[Animesh]   UNMATCHED joints (no skeleton bone): %s" % [str(unmatched)])
	print("[Animesh]   Matched: %d, Unmatched: %d" % [matched.size(), unmatched.size()])


## Per-frame animesh animation evaluation.
## SL xform.cpp:80: mWorldRotation = mRotation * mParent->getWorldRotation()
## SL's operator*(a,b) = Hamilton(b*a), so this is Hamilton(parent * local).
## Godot uses standard Hamilton, so we write: world = parent * local.
## Then convert SL world to Godot coords and derive pose.
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

		# For each skeleton under this root, compute and apply bone poses
		for obj_id: int in sm.animesh_root_for:
			if sm.animesh_root_for[obj_id] != root_id:
				continue
			var skeleton: Skeleton3D = sm.animesh_skeletons.get(obj_id)
			if skeleton == null:
				continue

			# Build SL world rotations traversing root → leaf, then derive Godot pose
			# SL's operator*(a,b) computes Hamilton b*a (reversed from standard).
			# SL line 80: mWorldRotation = mRotation * mParent->getWorldRotation()
			#   = Hamilton(parent_world * local)
			# Godot uses standard Hamilton, so: world = parent_world * local
			var sl_world: Dictionary = {}  # bone_idx -> Quaternion (SL space)
			var godot_world: Dictionary = {}  # bone_idx -> Quaternion (Godot space)

			for bi in range(skeleton.get_bone_count()):
				var bname: String = skeleton.get_bone_name(bi)
				var parent_bi: int = skeleton.get_bone_parent(bi)

				# SL local rotation: from animation, or rest rotation if not animated
				var q_sl_local: Quaternion
				if sl_local_rot.has(bname):
					q_sl_local = sl_local_rot[bname]
				else:
					# Derive SL rest rotation from Godot bone rest transform
					# Godot→SL coordinate conversion: (x,y,z,w) → (x,-z,y,w)
					var rest_q: Quaternion = skeleton.get_bone_rest(bi).basis.get_rotation_quaternion()
					q_sl_local = Quaternion(rest_q.x, -rest_q.z, rest_q.y, rest_q.w)

				# SL world = Hamilton(parent_world * local)
				# SL writes this as "local * parent" but SL's operator* is reversed.
				# In Godot (standard Hamilton): world = parent * local
				var q_sl_parent_world: Quaternion = sl_world.get(parent_bi, Quaternion.IDENTITY)
				var q_sl_world: Quaternion = q_sl_parent_world * q_sl_local
				sl_world[bi] = q_sl_world

				# Convert SL world to Godot world: (x,y,z,w) → (x,z,-y,w)
				var q_godot_world := Quaternion(
					q_sl_world.x, q_sl_world.z, -q_sl_world.y, q_sl_world.w).normalized()
				godot_world[bi] = q_godot_world

				# Only set pose if this bone is animated (rotation or position)
				var has_rot: bool = sl_local_rot.has(bname)
				var has_pos: bool = sl_local_pos.has(bname)
				if not has_rot and not has_pos and parent_bi < 0:
					continue  # Root bone with no animation — leave at rest

				# Derive Godot pose rotation: global = parent_global * rest * pose
				# → pose = (parent_global * rest)⁻¹ * our_desired_global
				var parent_godot_world: Quaternion = godot_world.get(parent_bi, Quaternion.IDENTITY)
				var rest_rot: Quaternion = skeleton.get_bone_rest(bi).basis.get_rotation_quaternion()
				var combined_inv: Quaternion = (parent_godot_world * rest_rot).inverse()
				var pose_rot: Quaternion = (combined_inv * q_godot_world).normalized()
				skeleton.set_bone_pose_rotation(bi, pose_rot)

				# Apply position keyframe as OFFSET from rest.
				# Animation position values are small offsets (typically <0.03m), not
				# absolute positions. SL's blendJointStates adds them to the current
				# joint position (which defaults to the rest position from the skeleton).
				# Godot's set_bone_pose_position:
				#   final_local.origin = rest.basis * pose_pos + rest.origin
				# For offset: desired = rest.origin + offset_godot
				#   pose_pos = rest.basis.inverse() * offset_godot
				if has_pos:
					var sl_pos: Vector3 = sl_local_pos[bname]
					# SL→Godot position offset: (x,y,z) → (x,z,-y)
					var offset_godot := Vector3(sl_pos.x, sl_pos.z, -sl_pos.y)
					var rest_xf: Transform3D = skeleton.get_bone_rest(bi)
					# Use rotation-only basis (strip scale) to avoid collision volume
					# IBM scale amplification. CV bones have 10-20x scale in rest.basis
					# from their inverse bind matrices.
					var rot_basis := Basis(rest_xf.basis.get_rotation_quaternion())
					var pose_pos: Vector3 = rot_basis.inverse() * offset_godot
					skeleton.set_bone_pose_position(bi, pose_pos)



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


## Handle face updates from material asset fetch (PBR materials resolved after initial object_create)
func handle_update_faces(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	var rsi = sm.objects.get(local_id)
	if rsi == null or rsi.mesh == null:
		return
	var faces: Array = msg.get("faces", [])
	if faces.size() == 0:
		return

	# Purge stale _pending_by_texture entries for faces being replaced.
	# Without this, the old legacy texture arriving later would overwrite PBR.
	var replaced_indices: Dictionary = {}  # face index -> true
	for new_face: Dictionary in faces:
		replaced_indices[int(new_face.get("index", -1))] = true
	var tex_keys_to_check: Array = sm._pending_by_texture.keys()
	for tid: String in tex_keys_to_check:
		var entries: Array = sm._pending_by_texture[tid]
		var filtered: Array = []
		for entry: Dictionary in entries:
			if entry["localId"] == local_id and replaced_indices.has(entry["faceInfo"]["faceIndex"]):
				continue  # drop stale entry
			filtered.append(entry)
		if filtered.size() == 0:
			sm._pending_by_texture.erase(tid)
		else:
			sm._pending_by_texture[tid] = filtered

	# Also remove from per-object pending list
	if sm.pending_textures.has(local_id):
		var pt: Array = sm.pending_textures[local_id]
		pt = pt.filter(func(fi: Dictionary) -> bool: return not replaced_indices.has(fi["faceIndex"]))
		if pt.size() == 0:
			sm.pending_textures.erase(local_id)
		else:
			sm.pending_textures[local_id] = pt

	# Merge into existing face data so texture_ready callbacks still work
	if not sm.object_faces.has(local_id):
		sm.object_faces[local_id] = faces
	else:
		# Update/add faces by index
		var existing: Array = sm.object_faces[local_id]
		for new_face: Dictionary in faces:
			var idx: int = int(new_face.get("index", -1))
			var found := false
			for i: int in range(existing.size()):
				if int(existing[i].get("index", -1)) == idx:
					existing[i] = new_face
					found = true
					break
			if not found:
				existing.append(new_face)
	sm.asset_pipeline.apply_face_materials(rsi, local_id, sm.object_faces[local_id])


func handle_object_kill(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	_cleanup_object(local_id)


## Clean up an object and all its children from all tracking dictionaries
func _cleanup_object(local_id: int) -> void:
	# Recursively clean up children first
	if sm.object_children.has(local_id):
		for child_id: int in sm.object_children[local_id].duplicate():
			_cleanup_object(child_id)
		sm.object_children.erase(local_id)

	# Remove from parent's children list
	if sm.object_parent.has(local_id):
		var pid: int = sm.object_parent[local_id]
		if sm.object_children.has(pid):
			sm.object_children[pid].erase(local_id)
		sm.object_parent.erase(local_id)

	# Free the RenderingServer instance
	if sm.objects.has(local_id):
		sm.objects[local_id].destroy()
		sm.objects.erase(local_id)

	# Destroy associated light
	sm.light_mgr.destroy_light(local_id)
	sm.light_mgr._object_light_data.erase(local_id)
	sm.object_targets.erase(local_id)

	# Clean up animesh data
	if sm.animesh_skeletons.has(local_id):
		sm.animesh_skeletons.erase(local_id)
	sm.animesh_mesh_instances.erase(local_id)
	sm.object_mesh_id.erase(local_id)
	sm.animesh_root_for.erase(local_id)
	if sm.animesh_roots.has(local_id):
		var animesh_node: Node3D = sm.animesh_roots[local_id]
		if animesh_node and is_instance_valid(animesh_node):
			animesh_node.queue_free()
		sm.animesh_roots.erase(local_id)
		sm.animesh_pending_anims.erase(local_id)
		sm.animesh_eval.erase(local_id)
		if sm.animesh_eval.is_empty():
			sm.animesh_eval_active = false

	# Clean up all tracking dicts
	if sm.pending_meshes.has(local_id):
		var mid: String = sm.pending_meshes[local_id]
		sm.pending_meshes.erase(local_id)
		if sm._pending_by_mesh.has(mid):
			sm._pending_by_mesh[mid].erase(local_id)
			if sm._pending_by_mesh[mid].size() == 0:
				sm._pending_by_mesh.erase(mid)
	# Remove from reverse texture index when cleaning up pending_textures
	if sm.pending_textures.has(local_id):
		for fi: Dictionary in sm.pending_textures[local_id]:
			var tid: String = fi["textureId"]
			if sm._pending_by_texture.has(tid):
				sm._pending_by_texture[tid] = sm._pending_by_texture[tid].filter(
					func(e: Dictionary) -> bool: return e["localId"] != local_id)
				if sm._pending_by_texture[tid].size() == 0:
					sm._pending_by_texture.erase(tid)
		sm.pending_textures.erase(local_id)
	sm.object_faces.erase(local_id)
	sm.object_meta.erase(local_id)
	sm.child_offset_pos.erase(local_id)
	sm.child_offset_rot.erase(local_id)
	sm.pending_children.erase(local_id)


# ─── Self Avatar ─────────────────────────────────────

func set_vr_mode(enabled: bool) -> void:
	sm._vr_mode = enabled
	var FrameBudget = sm.FrameBudget
	sm._target_frame_ms = FrameBudget.VR_FINALIZE_STOP_MS if enabled else FrameBudget.DESKTOP_FRAME_MS
	sm._vis_far = FrameBudget.VR_CAMERA_FAR if enabled else FrameBudget.VISIBILITY_FAR
	sm._vis_fade = FrameBudget.VR_VISIBILITY_FADE_MARGIN if enabled else FrameBudget.VISIBILITY_FADE_MARGIN
	for rsi in sm.objects.values():
		rsi.set_vis_range(sm._vis_far, sm._vis_fade)
	for rsi in sm.avatars.values():
		rsi.set_vis_range(sm._vis_far, sm._vis_fade)


func set_first_person_mode(enabled: bool) -> void:
	_first_person_mode = enabled
	_apply_self_avatar_visibility()


func _apply_self_avatar_visibility() -> void:
	if sm.self_avatar_id.is_empty():
		return
	var rsi = sm.avatars.get(sm.self_avatar_id)
	if rsi != null:
		RenderingServer.instance_set_visible(rsi.rid, not _first_person_mode)


func set_self_avatar_id(id: String) -> void:
	sm.self_avatar_id = id
	# If we already have this avatar, emit its position and apply visibility
	if sm.avatars.has(id):
		sm.self_avatar_moved.emit(sm.avatars[id].pos)
	_apply_self_avatar_visibility()


## Set the self avatar's yaw directly (for instant A/D feedback)
func set_self_avatar_yaw(godot_yaw: float) -> void:
	if sm.self_avatar_id.is_empty():
		return
	var rsi = sm.avatars.get(sm.self_avatar_id)
	if rsi == null:
		return
	# Godot yaw around Y axis
	rsi.rot = Quaternion(Vector3.UP, godot_yaw)
	rsi.push_transform()


## Return click-detection data for the self avatar, or empty dict if unavailable
func get_self_avatar_click_data() -> Dictionary:
	if sm.self_avatar_id.is_empty():
		return {}
	var rsi = sm.avatars.get(sm.self_avatar_id)
	if rsi == null or rsi.mesh == null:
		return {}
	var xform := Transform3D(Basis(rsi.rot) * Basis.from_scale(rsi.scl), rsi.pos)
	return { "position": rsi.pos, "transform": xform, "aabb": rsi.mesh.get_aabb() }


# ─── Avatar Handlers ──────────────────────────────────

func handle_avatar_create(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	if avatar_id.is_empty():
		return

	# Remove existing if duplicate
	if sm.avatars.has(avatar_id):
		sm.avatars[avatar_id].destroy()
		sm.avatar_targets.erase(avatar_id)

	var rsi = sm.RSInstance.new(sm._scenario, sm._vis_far, sm._vis_fade)
	rsi.set_mesh(sm.avatar_mesh)
	rsi.set_material_override(sm.avatar_material)

	var pos: Array = msg.get("position", [128, 128, 25])
	var godot_pos := sl_to_godot_pos(pos)
	godot_pos.y += 0.9
	rsi.pos = godot_pos

	var godot_rot := Quaternion.IDENTITY
	if msg.has("rotation"):
		godot_rot = sl_to_godot_quat(msg["rotation"])
		rsi.rot = godot_rot

	rsi.push_transform()
	sm.avatars[avatar_id] = rsi

	# Initialize interpolation target at current position (no lerp on first frame)
	sm.avatar_targets[avatar_id] = { "pos": godot_pos, "rot": godot_rot, "vel": Vector3.ZERO }

	if avatar_id == sm.self_avatar_id:
		sm.self_avatar_moved.emit(rsi.pos)
		_apply_self_avatar_visibility()


func handle_avatar_update(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	if not sm.avatars.has(avatar_id):
		return
	_apply_avatar_target(avatar_id, msg)


func handle_avatar_update_batch(msg: Dictionary) -> void:
	var avatar_list: Array = msg.get("avatars", [])
	for entry: Dictionary in avatar_list:
		var avatar_id: String = entry.get("id", "")
		if avatar_id.is_empty() or not sm.avatars.has(avatar_id):
			continue
		_apply_avatar_target(avatar_id, entry)


## Set interpolation target for an avatar from an update message
func _apply_avatar_target(avatar_id: String, data: Dictionary) -> void:
	var rsi = sm.avatars.get(avatar_id)

	if data.has("position"):
		var godot_pos := sl_to_godot_pos(data["position"])
		godot_pos.y += 0.9

		# Blend offset = current visual position minus new server position
		var blend_offset := Vector3.ZERO
		if rsi:
			blend_offset = rsi.pos - godot_pos
			if blend_offset.length() > AVATAR_MAX_INTERP_DIST:
				blend_offset = Vector3.ZERO  # too far, snap

		if rsi:
			rsi.pos = godot_pos

		var target: Dictionary = {}
		target["pos"] = godot_pos
		target["blend_offset"] = blend_offset
		target["blend_time"] = 0.0
		if data.has("rotation"):
			var r := sl_to_godot_quat(data["rotation"])
			target["rot"] = r
			if rsi:
				rsi.rot = r
		elif rsi:
			target["rot"] = rsi.rot
		else:
			target["rot"] = Quaternion.IDENTITY
		if data.has("velocity"):
			var sl_vel: Array = data["velocity"]
			target["vel"] = Vector3(sl_vel[0], sl_vel[2], -sl_vel[1])
		else:
			target["vel"] = Vector3.ZERO
		target["age"] = 0.0
		sm.avatar_targets[avatar_id] = target
	else:
		# Rotation-only update
		if data.has("rotation"):
			var target: Dictionary = sm.avatar_targets.get(avatar_id, {})
			target["rot"] = sl_to_godot_quat(data["rotation"])
			sm.avatar_targets[avatar_id] = target


func handle_avatar_kill(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	if sm.avatars.has(avatar_id):
		sm.avatars[avatar_id].destroy()
		sm.avatars.erase(avatar_id)
		sm.avatar_targets.erase(avatar_id)


# ─── Interpolation ───────────────────────────────────

## Smoothly move all avatars toward their targets each frame
## Firestorm-style: velocity extrapolation with phase-out, no angular velocity for avatars
func interpolate_avatars(delta: float) -> void:
	for avatar_id: String in sm.avatar_targets:
		var rsi = sm.avatars.get(avatar_id)
		if rsi == null:
			continue

		var target: Dictionary = sm.avatar_targets[avatar_id]
		var vel: Vector3 = target.get("vel", Vector3.ZERO)
		var target_rot: Quaternion = target.get("rot", rsi.rot)

		var age: float = target.get("age", 0.0) + delta
		target["age"] = age

		# Velocity extrapolation (same as objects but no angular velocity for avatars)
		if not vel.is_zero_approx() and age < INTERP_MAX_TIME:
			var phase_out := 1.0
			if age > INTERP_PHASE_OUT_TIME:
				phase_out = clampf((INTERP_MAX_TIME - age) / (INTERP_MAX_TIME - INTERP_PHASE_OUT_TIME), 0.0, 1.0)
			var pos_delta: Vector3 = vel * delta * phase_out
			target["pos"] = target.get("pos", rsi.pos) + pos_delta

		# Decay blend offset (smooth correction from server updates)
		var blend_offset: Vector3 = target.get("blend_offset", Vector3.ZERO)
		var blend_time: float = target.get("blend_time", 0.0) + delta
		target["blend_time"] = blend_time
		var blend_frac := clampf(blend_time / BLEND_TIME, 0.0, 1.0)

		rsi.pos = target.get("pos", rsi.pos) + blend_offset * (1.0 - blend_frac)

		# Slerp rotation (Firestorm restores rotation for non-self avatars, no angular vel)
		rsi.rot = rsi.rot.slerp(target_rot, clampf(AVATAR_SLERP_SPEED * delta, 0.0, 1.0))

		rsi.push_transform()

		# Emit camera follow signal for self avatar
		if avatar_id == sm.self_avatar_id:
			sm.self_avatar_moved.emit(rsi.pos)


## Smoothly move objects with velocity toward their targets each frame.
## Dead reckoning: advance the target by velocity each frame.
## Server updates correct the target position when they arrive.
func interpolate_objects(delta: float) -> void:
	# Firestorm-style: each frame, advance position by vel*dt + 0.5*accel*dt^2
	# Server updates reset pos/vel/accel. Server omits updates when object follows predicted path.
	var to_remove: Array[int] = []
	for local_id: int in sm.object_targets:
		var rsi = sm.objects.get(local_id)
		if rsi == null:
			to_remove.append(local_id)
			continue

		var target: Dictionary = sm.object_targets[local_id]
		var vel: Vector3 = target.get("vel", Vector3.ZERO)
		var accel: Vector3 = target.get("accel", Vector3.ZERO)
		var ang_vel: Vector3 = target.get("angVel", Vector3.ZERO)

		var age: float = target.get("age", 0.0) + delta
		target["age"] = age

		# Blend offset decay (runs even when stationary)
		var blend_offset: Vector3 = target.get("blend_offset", Vector3.ZERO)
		var blend_time: float = target.get("blend_time", 0.0) + delta
		target["blend_time"] = blend_time
		var blend_frac := clampf(blend_time / BLEND_TIME, 0.0, 1.0)

		# Stop entirely after max time (but only if blend is also done)
		if age > INTERP_MAX_TIME:
			if blend_frac >= 1.0:
				to_remove.append(local_id)
				continue

		# Phase out motion if no server update for a while
		var phase_out := 1.0
		if age > INTERP_PHASE_OUT_TIME:
			phase_out = clampf((INTERP_MAX_TIME - age) / (INTERP_MAX_TIME - INTERP_PHASE_OUT_TIME), 0.0, 1.0)

		# Linear motion: pos += (vel + 0.5 * (dt - PHYSICS_TIMESTEP) * accel) * dt
		var stationary := vel.is_zero_approx() and accel.is_zero_approx() and ang_vel.is_zero_approx()
		if not stationary:
			var dt := delta
			var pos_delta: Vector3 = (vel + 0.5 * (dt - PHYSICS_TIMESTEP) * accel) * dt * phase_out
			target["pos"] = target.get("pos", rsi.pos) + pos_delta

			# Update velocity for next frame
			target["vel"] = vel + accel * dt * phase_out

			# Angular velocity: apply rotation delta
			var ang_speed := ang_vel.length()
			if ang_speed > 0.0001:
				var ang_axis := ang_vel / ang_speed
				var dq := Quaternion(ang_axis, ang_speed * dt * phase_out)
				rsi.rot = rsi.rot * dq

		# Apply extrapolated pos + decaying blend offset
		rsi.pos = target.get("pos", rsi.pos) + blend_offset * (1.0 - blend_frac)

		rsi.push_transform()

		# Propagate to linkset children + lights
		if sm.object_children.has(local_id):
			_update_children_transforms(local_id)
		if sm.light_mgr.object_lights.has(local_id):
			sm.light_mgr.update_light_transform(local_id, rsi)
		_sync_animesh_transform(local_id, rsi)

	for local_id: int in to_remove:
		sm.object_targets.erase(local_id)
