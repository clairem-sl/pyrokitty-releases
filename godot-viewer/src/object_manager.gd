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

# Self avatar state
var _first_person_mode: bool = false


func _init(scene_manager) -> void:
	sm = scene_manager


## Short UUID for log messages (first 8 chars, or "?" if not found)
func _uuid_short(local_id: int) -> String:
	var uuid: String = sm.object_uuid.get(local_id, "")
	if uuid.is_empty():
		return "?"
	return uuid.substr(0, 8)


## Check if a localId belongs to the self avatar (is the avatar root or an attachment of it)
func _is_self_avatar(local_id: int) -> bool:
	if sm.self_avatar_id.is_empty():
		return false
	var self_lid: int = sm.avatar_local_ids.get(sm.self_avatar_id, 0)
	if self_lid == 0:
		return false
	if local_id == self_lid:
		return true
	# Check if this object's animesh root is the self avatar
	var root_id: int = sm.animesh_root_for.get(local_id, 0)
	return root_id == self_lid


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

	var parent_id: int = int(msg.get("parentId", 0))

	# Remove existing if duplicate
	if sm.objects.has(local_id):
		_cleanup_object(local_id)

	# Store UUID for log correlation
	var obj_uuid: String = str(msg.get("uuid", ""))
	if not obj_uuid.is_empty():
		sm.object_uuid[local_id] = obj_uuid

	# Store object metadata (uuid; name/description arrive later via object_properties)
	sm.object_meta[local_id] = {
		"uuid": obj_uuid,
		"name": "",
		"description": "",
	}

	var mesh_id: String = msg.get("meshId", "")
	if not mesh_id.is_empty():
		sm.object_mesh_id[local_id] = mesh_id
	var shape: Dictionary = msg.get("shape", {})
	var rsi = sm.RSInstance.new(sm._scenario, sm._vis_far, sm._vis_fade)

	# Will this object be an animesh child? Check early so we can skip RSI mesh for rigged animesh.
	var will_be_animesh: bool = false
	if parent_id > 0:
		if sm.animesh_roots.has(parent_id) or sm.animesh_root_for.has(parent_id):
			will_be_animesh = true

	if not mesh_id.is_empty() and sm.mesh_cache.has(mesh_id):
		var is_rigged: bool = sm.rigged_mesh_paths.has(mesh_id)
		# Animesh child with rigged mesh: use placeholder — the real mesh goes on Skeleton3D
		if is_rigged and will_be_animesh:
			rsi.set_mesh(sm.object_mesh)
		elif is_rigged and not msg.get("animesh", false):
			# Non-animesh rigged: prefer static mesh (no BSM) for correct scale/rotation
			if sm.static_mesh_cache.has(mesh_id):
				rsi.set_mesh(sm.static_mesh_cache[mesh_id])
			elif sm.static_mesh_paths.has(mesh_id):
				rsi.set_mesh(sm.object_mesh)
				if not sm._pending_by_mesh.has(mesh_id + ":static_wait"):
					sm._pending_by_mesh[mesh_id + ":static_wait"] = []
				sm._pending_by_mesh[mesh_id + ":static_wait"].append(local_id)
			else:
				var cached_mesh: Mesh = sm.mesh_cache[mesh_id]
				rsi.set_mesh(cached_mesh)
				var aabb: AABB = cached_mesh.get_aabb()
				if aabb.size.x > 0.001 and aabb.size.y > 0.001 and aabb.size.z > 0.001:
					rsi.scl_divisor = aabb.size
					rsi.scl_center = aabb.get_center()
		else:
			# Animesh root, or unrigged — use normal mesh
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
		elif sm.animesh_roots.has(parent_id):
			# Parent is an avatar or animesh root — use scene tree node transform
			var root_node: Node3D = sm.animesh_roots[parent_id]
			rsi.pos = root_node.position + root_node.quaternion * godot_pos
			rsi.rot = root_node.quaternion * godot_rot
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

	# Animesh root detection — create a Node3D in the scene tree for skeleton parenting.
	# Worn animesh (child of avatar) uses the AVATAR's skeleton and root, matching SL behavior
	# where the ControlAvatar for a worn animesh shares the avatar's skeleton.
	if msg.get("animesh", false):
		if parent_id > 0 and sm.animesh_roots.has(parent_id):
			# Worn animesh attachment — use avatar's animesh root and shared skeleton
			sm.animesh_root_for[local_id] = parent_id
			print("[Animesh] Worn animesh %d uuid=%s → using avatar root %d" % [local_id, _uuid_short(local_id), parent_id])
		else:
			# Standalone animesh object (rezzed on ground) — own root + skeleton
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
			# Create shared skeleton for non-avatar animesh objects too
			if not sm.animesh_shared_skeleton.has(local_id):
				var shared_skel: Skeleton3D = sm.skeleton_builder.create_shared_skeleton()
				animesh_node.add_child(shared_skel)
				sm.animesh_shared_skeleton[local_id] = shared_skel
			if _is_self_avatar(local_id):
				print("[SelfAvatar] Animesh root object %d uuid=%s created" % [local_id, _uuid_short(local_id)])
			# Retroactively register existing children + grandchildren (attachment linksets)
			_register_animesh_descendants(local_id, local_id)

	# Track children of animesh roots (direct children AND grandchildren of linksets)
	if parent_id > 0:
		if sm.animesh_roots.has(parent_id):
			sm.animesh_root_for[local_id] = parent_id
		elif sm.animesh_root_for.has(parent_id):
			# Grandchild — inherit the same animesh root (attachment linkset child)
			sm.animesh_root_for[local_id] = sm.animesh_root_for[parent_id]
		else:
			# Only log for self-avatar attachments — regular linkset children are expected noise
			var self_lid: int = sm.avatar_local_ids.get(sm.self_avatar_id, 0)
			if self_lid > 0 and parent_id == self_lid:
				print("[SelfAvatar] WARNING: obj %d uuid=%s has parentId=%d (self avatar) but NOT an animesh root (animesh_roots has %d entries)" % [local_id, _uuid_short(local_id), parent_id, sm.animesh_roots.size()])

	# [SelfAvatar] log when an attachment is registered for the self avatar
	if _is_self_avatar(local_id):
		print("[SelfAvatar] Attachment created: localId=%d uuid=%s meshId=%s parentId=%d" % [local_id, _uuid_short(local_id), mesh_id.substr(0, 8) if not mesh_id.is_empty() else "none", parent_id])

	# If this object has a cached rigged mesh and belongs to an animesh linkset, instantiate now
	# (bypasses _apply_mesh_to_pending which only runs for uncached meshes)
	if sm.animesh_root_for.has(local_id):
		var ar_id: int = sm.animesh_root_for[local_id]
		var _is_self: bool = _is_self_avatar(local_id)
		if not mesh_id.is_empty() and sm.mesh_cache.has(mesh_id) and sm.rigged_mesh_paths.has(mesh_id):
			if _is_self:
				print("[SelfAvatar] Rigged mesh %s CACHED, instantiating immediately for localId=%d uuid=%s" % [mesh_id.substr(0, 8), local_id, _uuid_short(local_id)])
			_instantiate_animesh_mesh(local_id, mesh_id, ar_id)
			# Re-apply face materials — they were applied before MeshInstance3D existed
			if sm.object_faces.has(local_id):
				sm.asset_pipeline.apply_face_materials(rsi, local_id, sm.object_faces[local_id])
		elif not mesh_id.is_empty() and sm.rigged_mesh_paths.has(mesh_id):
			if _is_self:
				print("[SelfAvatar] Rigged mesh %s NOT cached yet, will wait for mesh_ready (localId=%d uuid=%s)" % [mesh_id.substr(0, 8), local_id, _uuid_short(local_id)])
		elif not mesh_id.is_empty():
			if _is_self:
				print("[SelfAvatar] Mesh %s not in rigged_mesh_paths yet (localId=%d uuid=%s)" % [mesh_id.substr(0, 8), local_id, _uuid_short(local_id)])
		else:
			if _is_self:
				print("[SelfAvatar] No meshId (prim/sculpt) for localId=%d uuid=%s, animesh root=%d" % [local_id, _uuid_short(local_id), ar_id])

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
			# Sync animesh root Node3D for child animesh objects
			_sync_animesh_transform(child_id, child_rsi)
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

## Recursively register all descendants of a parent as animesh children.
## Handles attachment linksets: root prim is direct child of avatar, child prims
## are grandchildren but still rig to the same avatar skeleton.
func _register_animesh_descendants(parent_id: int, root_id: int) -> void:
	if not sm.object_children.has(parent_id):
		return
	for child_id: int in sm.object_children[parent_id]:
		if not sm.animesh_root_for.has(child_id):
			sm.animesh_root_for[child_id] = root_id
			var child_mid: String = sm.object_mesh_id.get(child_id, "")
			if not child_mid.is_empty() and sm.mesh_cache.has(child_mid) and sm.rigged_mesh_paths.has(child_mid):
				_instantiate_animesh_mesh(child_id, child_mid, root_id)
				if sm.object_faces.has(child_id) and sm.objects.has(child_id):
					sm.asset_pipeline.apply_face_materials(sm.objects[child_id], child_id, sm.object_faces[child_id])
		# Recurse into grandchildren
		_register_animesh_descendants(child_id, root_id)


## Instantiate a rigged mesh under the shared skeleton for this animesh root.
## Extracts MeshInstance3D + Skin from the GLB, discards the per-mesh Skeleton3D,
## and binds the mesh to the shared skeleton via Godot's SkinReference system.
func _instantiate_animesh_mesh(local_id: int, mesh_id: String, animesh_root_id: int) -> void:
	# Guard against double instantiation (can be called from cache hit + _apply_mesh_to_pending)
	if sm.animesh_mesh_instances.has(local_id):
		return
	var glb_path: String = sm.rigged_mesh_paths.get(mesh_id, "")
	if glb_path.is_empty():
		push_warning("[Animesh] No GLB path for rigged mesh %s (obj %d uuid=%s)" % [mesh_id, local_id, _uuid_short(local_id)])
		return
	# Hybrid approach: shared skeleton for animation eval, per-mesh skeleton for rendering.
	# We still need the shared skeleton to exist (for process_animesh to evaluate poses).
	if not sm.animesh_shared_skeleton.has(animesh_root_id):
		push_warning("[Animesh] No shared skeleton for root %d uuid=%s (obj %d uuid=%s)" % [animesh_root_id, _uuid_short(animesh_root_id), local_id, _uuid_short(local_id)])
		return
	var animesh_root: Node3D = sm.animesh_roots.get(animesh_root_id)
	if animesh_root == null:
		return

	# Parse GLB and generate full scene tree (includes per-mesh Skeleton3D + MeshInstance3D)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(glb_path, state)
	if err != OK:
		push_warning("[Animesh] Failed to parse GLB %s: %s (obj %d uuid=%s)" % [glb_path, error_string(err), local_id, _uuid_short(local_id)])
		return
	var scene: Node = doc.generate_scene(state)
	if scene == null:
		push_warning("[Animesh] generate_scene returned null for %s (obj %d uuid=%s)" % [glb_path, local_id, _uuid_short(local_id)])
		return

	var mesh_instance: MeshInstance3D = _find_node_of_type(scene, "MeshInstance3D")
	if mesh_instance == null:
		push_warning("[Animesh] No MeshInstance3D in GLB for object %d uuid=%s" % [local_id, _uuid_short(local_id)])
		scene.queue_free()
		return

	var glb_skel: Skeleton3D = _find_node_of_type(scene, "Skeleton3D") as Skeleton3D
	if glb_skel == null:
		push_warning("[Animesh] No Skeleton3D in GLB for object %d uuid=%s" % [local_id, _uuid_short(local_id)])
		scene.queue_free()
		return

	# Populate skin bind names from GLB skeleton (Godot glTF importer may use indices only)
	var skin: Skin = mesh_instance.skin
	if skin != null:
		for i in range(skin.get_bind_count()):
			if skin.get_bind_name(i).is_empty():
				var bidx: int = skin.get_bind_bone(i)
				if bidx >= 0 and bidx < glb_skel.get_bone_count():
					skin.set_bind_name(i, glb_skel.get_bone_name(bidx))

	# Hybrid approach: keep the GLB's own Skeleton3D for rendering.
	# The mesh stays bound to its own skeleton (IBMs match rest transforms).
	# Animation poses are propagated from the shared skeleton in process_animesh.
	glb_skel.set_owner(null)
	glb_skel.get_parent().remove_child(glb_skel)
	glb_skel.name = "skel_%d" % local_id
	animesh_root.add_child(glb_skel)
	# MeshInstance3D stays as child of glb_skel — already correctly skinned to it

	# Store references
	sm.animesh_mesh_instances[local_id] = mesh_instance
	sm.animesh_mesh_skeletons[local_id] = glb_skel

	# Double-sided shadow casting reduces shadow acne near deformed joints
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_DOUBLE_SIDED

	# Hide the RSInstance placeholder (keep it for metadata/transform tracking)
	var rsi = sm.objects.get(local_id)
	if rsi != null:
		RenderingServer.instance_set_visible(rsi.rid, false)
		RenderingServer.instance_geometry_set_cast_shadows_setting(
			rsi.rid, RenderingServer.SHADOW_CASTING_SETTING_OFF)

	# Hide the avatar placeholder (blue box) once first rigged mesh appears
	for av_id: String in sm.avatar_local_ids:
		if sm.avatar_local_ids[av_id] == animesh_root_id and sm.avatars.has(av_id):
			var av_rsi = sm.avatars[av_id]
			RenderingServer.instance_set_visible(av_rsi.rid, false)
			RenderingServer.instance_geometry_set_cast_shadows_setting(
				av_rsi.rid, RenderingServer.SHADOW_CASTING_SETTING_OFF)
			break

	# If we already have pending animations for this root, apply them
	if sm.animesh_roots.has(animesh_root_id):
		_apply_pending_animations(local_id)

	if _is_self_avatar(local_id):
		print("[SelfAvatar] Rigged mesh instantiated (hybrid): localId=%d meshId=%s bones=%d" % [local_id, mesh_id.substr(0, 8), glb_skel.get_bone_count()])

	# Free the now-empty GLB scene root (skeleton + mesh have been reparented out)
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


## Handle animations_batch — bridge has collected ALL animation data for a root.
## Contains the full set of animations with their parsed keyframe data.
## Replaces the old object_animation + avatar_animation + animation_ready flow.
func handle_animations_batch(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	var msg_uuid: String = str(msg.get("uuid", ""))
	if not msg_uuid.is_empty() and local_id > 0:
		sm.object_uuid[local_id] = msg_uuid
	var animations: Dictionary = msg.get("animations", {})
	if _is_self_avatar(local_id):
		print("[SelfAvatar] animations_batch: localId=%d uuid=%s, %d animations, is_animesh_root=%s, has_shared_skel=%s" % [
			local_id, _uuid_short(local_id), animations.size(),
			str(sm.animesh_roots.has(local_id)),
			str(sm.animesh_shared_skeleton.has(local_id))])
	if local_id == 0 or animations.is_empty():
		return

	# Cache all animation data and build pending anim list
	var anim_ids: Array = []
	for anim_id: String in animations:
		var data: Dictionary = animations[anim_id]
		if data.is_empty():
			continue
		if not sm.animesh_anim_data.has(anim_id):
			sm.animesh_anim_data[anim_id] = data
		anim_ids.append(anim_id)

	# Route animations to the correct root (worn animesh → avatar root)
	var anim_root: int = sm.animesh_root_for.get(local_id, local_id)
	if anim_root != local_id:
		# Worn animesh: store separately so avatar batch updates don't overwrite
		sm.animesh_worn_anims[anim_root] = sm.animesh_worn_anims.get(anim_root, []) as Array
		for aid: String in anim_ids:
			if not (sm.animesh_worn_anims[anim_root] as Array).has(aid):
				(sm.animesh_worn_anims[anim_root] as Array).append(aid)
	else:
		sm.animesh_pending_anims[local_id] = anim_ids

	if _is_self_avatar(local_id) or _is_self_avatar(anim_root):
		print("[SelfAvatar] Animations batch received: localId=%d root=%d, %d animations [%s]" % [local_id, anim_root, anim_ids.size(), ", ".join(anim_ids.map(func(a: String) -> String: return a.substr(0, 8)))])

	# Trigger rebuild if shared skeleton exists for the root
	if sm.animesh_shared_skeleton.has(anim_root):
		_apply_pending_animations(anim_root)
	elif _is_self_avatar(anim_root):
		print("[SelfAvatar] Batch for root=%d: %d anims cached, but NO shared skeleton yet" % [anim_root, anim_ids.size()])


## Apply any pending animations to a specific animesh root.
## Merges all pending animations by per-joint priority and stores merged keyframe data
## for manual per-frame evaluation (required because SL composes bone rotations as
## world = local * parent, while Godot uses world = parent * local).
func _apply_pending_animations(obj_id: int) -> void:
	var root_id: int = sm.animesh_root_for.get(obj_id, obj_id)
	if root_id == 0:
		return
	# Combine root's own animations with worn animesh animations
	var pending_anims: Array = sm.animesh_pending_anims.get(root_id, []).duplicate()
	var worn: Array = sm.animesh_worn_anims.get(root_id, [])
	for aid: String in worn:
		if not pending_anims.has(aid):
			pending_anims.append(aid)
	if pending_anims.is_empty():
		return

	# Need shared skeleton to exist
	if not sm.animesh_shared_skeleton.has(root_id):
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
		if _is_self_avatar(root_id):
			print("[SelfAvatar] _apply_pending root=%d uuid=%s: %d pending, 0 available, %d missing" % [root_id, _uuid_short(root_id), pending_anims.size(), missing])
		return
	if _is_self_avatar(root_id):
		print("[SelfAvatar] _apply_pending root=%d uuid=%s: %d available, %d missing, %d total joints" % [root_id, _uuid_short(root_id), available.size(), missing, available.reduce(func(acc: int, d: Dictionary): return acc + (d.get("joints", []) as Array).size(), 0)])

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

	if _is_self_avatar(root_id):
		print("[SelfAvatar] Animations applied: %d joints merged from %d animations" % [merged_joints.size(), available.size()])


## Per-frame animesh animation evaluation.
## Evaluates each skeleton independently so all bones get animated regardless
## of which skeleton they appear in. Different attachments (head, body, boots)
## have different bone subsets — a single reference skeleton would miss bones
## that only exist on other skeletons.
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

		# Hybrid approach: evaluate SL world rotations on the shared skeleton (all 159 bones),
		# then propagate poses to each per-mesh skeleton using ITS rest transforms.
		var shared_skel: Skeleton3D = sm.animesh_shared_skeleton.get(root_id)
		if shared_skel == null:
			continue

		# Compute SL/Godot world rotations for ALL bones (by name, skeleton-independent)
		var sl_world_by_name: Dictionary = {}    # bname -> Quaternion (SL space)
		var godot_world_by_name: Dictionary = {} # bname -> Quaternion (Godot space)

		for bi in range(shared_skel.get_bone_count()):
			var bname: String = shared_skel.get_bone_name(bi)
			var parent_bi: int = shared_skel.get_bone_parent(bi)

			# SL local rotation: from animation keyframes or default rest rotation
			var q_sl_local: Quaternion
			if sl_local_rot.has(bname):
				q_sl_local = sl_local_rot[bname]
			else:
				# Standard bones: rest rot = identity → SL local = identity
				# Collision volumes: rest has rotation from XML → convert Godot→SL
				var rest_q: Quaternion = shared_skel.get_bone_rest(bi).basis.orthonormalized().get_rotation_quaternion()
				q_sl_local = Quaternion(rest_q.x, -rest_q.z, rest_q.y, rest_q.w)

			var parent_bname: String = ""
			if parent_bi >= 0:
				parent_bname = shared_skel.get_bone_name(parent_bi)
			var q_sl_parent: Quaternion = sl_world_by_name.get(parent_bname, Quaternion.IDENTITY)
			var q_sl_world: Quaternion = q_sl_parent * q_sl_local
			sl_world_by_name[bname] = q_sl_world

			var q_godot_world := Quaternion(
				q_sl_world.x, q_sl_world.z, -q_sl_world.y, q_sl_world.w).normalized()
			godot_world_by_name[bname] = q_godot_world

		# Propagate poses to each per-mesh skeleton for this root
		for mesh_lid: int in sm.animesh_mesh_skeletons:
			if sm.animesh_root_for.get(mesh_lid, 0) != root_id:
				continue
			var mesh_skel: Skeleton3D = sm.animesh_mesh_skeletons[mesh_lid]
			if mesh_skel == null or not is_instance_valid(mesh_skel):
				continue
			_apply_world_to_mesh_skeleton(mesh_skel, godot_world_by_name, sl_local_pos)



## Apply Godot world rotations (from shared skeleton evaluation) to a per-mesh skeleton.
## Each bone's pose is derived relative to the mesh skeleton's own rest transforms,
## so vertices render correctly (mesh IBMs match mesh skeleton rests).
func _apply_world_to_mesh_skeleton(mesh_skel: Skeleton3D, godot_world: Dictionary, sl_local_pos: Dictionary) -> void:
	for bi in range(mesh_skel.get_bone_count()):
		var bname: String = mesh_skel.get_bone_name(bi)
		if not godot_world.has(bname):
			continue  # bone not in animation evaluation → stays at rest

		var q_gw: Quaternion = godot_world[bname]

		# Get parent's Godot world rotation (by name, from the shared skeleton evaluation)
		var parent_bi: int = mesh_skel.get_bone_parent(bi)
		var parent_gw: Quaternion = Quaternion.IDENTITY
		if parent_bi >= 0:
			var parent_bname: String = mesh_skel.get_bone_name(parent_bi)
			parent_gw = godot_world.get(parent_bname, Quaternion.IDENTITY)

		# Derive pose rotation: pose = inv(parent_world * rest) * world
		var rest_rot: Quaternion = mesh_skel.get_bone_rest(bi).basis.orthonormalized().get_rotation_quaternion()
		var combined_inv: Quaternion = (parent_gw * rest_rot).inverse()
		var pose_rot: Quaternion = (combined_inv * q_gw).normalized()
		mesh_skel.set_bone_pose_rotation(bi, pose_rot)

		# Position keyframes: SL-space offset converted to mesh skeleton's bone space
		if sl_local_pos.has(bname):
			var sl_pos: Vector3 = sl_local_pos[bname]
			var offset_godot := Vector3(sl_pos.x, sl_pos.z, -sl_pos.y)
			var rest_xf: Transform3D = mesh_skel.get_bone_rest(bi)
			var rot_basis := Basis(rest_xf.basis.orthonormalized().get_rotation_quaternion())
			var pose_pos: Vector3 = rot_basis.inverse() * offset_godot
			mesh_skel.set_bone_pose_position(bi, pose_pos)


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

	# Clean up animesh mesh instance and per-mesh skeleton
	if sm.animesh_mesh_instances.has(local_id):
		var ami: MeshInstance3D = sm.animesh_mesh_instances[local_id]
		if ami and is_instance_valid(ami):
			ami.queue_free()
		sm.animesh_mesh_instances.erase(local_id)
	if sm.animesh_mesh_skeletons.has(local_id):
		var mskel: Skeleton3D = sm.animesh_mesh_skeletons[local_id]
		if mskel and is_instance_valid(mskel):
			mskel.queue_free()  # also frees child MeshInstance3D
		sm.animesh_mesh_skeletons.erase(local_id)
	sm.object_mesh_id.erase(local_id)
	sm.animesh_root_for.erase(local_id)
	if sm.animesh_roots.has(local_id):
		var animesh_node: Node3D = sm.animesh_roots[local_id]
		if animesh_node and is_instance_valid(animesh_node):
			animesh_node.queue_free()
		sm.animesh_roots.erase(local_id)
		sm.animesh_shared_skeleton.erase(local_id)
		sm.animesh_pending_anims.erase(local_id)
		sm.animesh_worn_anims.erase(local_id)
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
	sm.object_uuid.erase(local_id)
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
	var local_id: int = int(msg.get("localId", 0))

	# Remove existing if duplicate
	if sm.avatars.has(avatar_id):
		sm.avatars[avatar_id].destroy()
		sm.avatar_targets.erase(avatar_id)
		# Clean up old skeleton root if present
		var old_lid: int = sm.avatar_local_ids.get(avatar_id, 0)
		if old_lid > 0 and sm.animesh_roots.has(old_lid):
			var old_node: Node3D = sm.animesh_roots[old_lid]
			if old_node and is_instance_valid(old_node):
				old_node.queue_free()
			sm.animesh_roots.erase(old_lid)

	var rsi = sm.RSInstance.new(sm._scenario, sm._vis_far, sm._vis_fade)
	# Small blue placeholder so we can see avatar position while attachments load
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

	# Create skeleton root for this avatar (same as animesh root).
	# Avatar attachments arrive as objects with parentId = this localId.
	if local_id > 0:
		sm.avatar_local_ids[avatar_id] = local_id
		sm.object_uuid[local_id] = avatar_id
		var avatar_node := Node3D.new()
		avatar_node.name = "avatar_%d" % local_id
		sm.add_child(avatar_node)
		avatar_node.position = godot_pos
		avatar_node.quaternion = godot_rot
		avatar_node.scale = Vector3.ONE
		sm.animesh_roots[local_id] = avatar_node
		# Create shared skeleton from avatar_skeleton.xml (ONE per avatar)
		var shared_skel: Skeleton3D = sm.skeleton_builder.create_shared_skeleton()
		avatar_node.add_child(shared_skel)
		sm.animesh_shared_skeleton[local_id] = shared_skel
		if avatar_id == sm.self_avatar_id:
			print("[SelfAvatar] === Skeleton root created: localId=%d bones=%d ===" % [local_id, shared_skel.get_bone_count()])

		# Resolve pending children that arrived before this avatar —
		# fix their world positions
		if sm.pending_children.has(local_id):
			for child_id: int in sm.pending_children[local_id]:
				if sm.objects.has(child_id) and sm.child_offset_pos.has(child_id):
					var child_rsi = sm.objects[child_id]
					child_rsi.pos = avatar_node.position + avatar_node.quaternion * sm.child_offset_pos[child_id]
					child_rsi.rot = avatar_node.quaternion * sm.child_offset_rot[child_id]
					child_rsi.push_transform()
			sm.pending_children.erase(local_id)

		# Register ALL descendants (children, grandchildren, etc.) as animesh children.
		# Handles attachment linksets where child prims also need skeleton rigging.
		_register_animesh_descendants(local_id, local_id)

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
		var raw_pos := sl_to_godot_pos(data["position"])
		var seat_id: int = int(data.get("parentId", 0))
		var seat_rsi = sm.objects.get(seat_id) if seat_id > 0 else null

		var godot_pos: Vector3
		var godot_rot: Quaternion
		if seat_rsi != null:
			# Sitting: position and rotation are in the seat's local space.
			# World = seat_pos + seat_rot * local_offset (same as child prims).
			godot_pos = seat_rsi.pos + seat_rsi.rot * raw_pos
			if data.has("rotation"):
				godot_rot = seat_rsi.rot * sl_to_godot_quat(data["rotation"])
			else:
				godot_rot = rsi.rot if rsi else Quaternion.IDENTITY
		else:
			godot_pos = raw_pos
			godot_pos.y += 0.9
			if data.has("rotation"):
				godot_rot = sl_to_godot_quat(data["rotation"])
			else:
				godot_rot = rsi.rot if rsi else Quaternion.IDENTITY

		# Snap when sitting (no blend) — sit position is server-authoritative.
		var blend_offset := Vector3.ZERO
		if seat_rsi == null and rsi:
			blend_offset = rsi.pos - godot_pos
			if blend_offset.length() > AVATAR_MAX_INTERP_DIST:
				blend_offset = Vector3.ZERO

		if rsi:
			rsi.pos = godot_pos
			rsi.rot = godot_rot

		var target: Dictionary = {}
		target["pos"] = godot_pos
		target["rot"] = godot_rot
		target["blend_offset"] = blend_offset
		target["blend_time"] = 0.0
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
		# Clean up skeleton root
		var av_lid: int = sm.avatar_local_ids.get(avatar_id, 0)
		if av_lid > 0 and sm.animesh_roots.has(av_lid):
			# Clean up per-mesh skeletons belonging to this avatar
			var to_erase: Array = []
			for mesh_lid: int in sm.animesh_mesh_skeletons:
				if sm.animesh_root_for.get(mesh_lid, 0) == av_lid:
					to_erase.append(mesh_lid)
			for mesh_lid: int in to_erase:
				sm.animesh_mesh_skeletons.erase(mesh_lid)
				sm.animesh_mesh_instances.erase(mesh_lid)
			var node: Node3D = sm.animesh_roots[av_lid]
			if node and is_instance_valid(node):
				node.queue_free()  # Also frees shared skeleton + per-mesh skeletons + meshes
			sm.animesh_roots.erase(av_lid)
			sm.animesh_shared_skeleton.erase(av_lid)
			sm.animesh_eval.erase(av_lid)
			sm.animesh_pending_anims.erase(av_lid)
			sm.animesh_worn_anims.erase(av_lid)
		sm.avatar_local_ids.erase(avatar_id)


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

		# Sync avatar skeleton root Node3D with RSInstance position
		var av_lid: int = sm.avatar_local_ids.get(avatar_id, 0)
		if av_lid > 0 and sm.animesh_roots.has(av_lid):
			var node: Node3D = sm.animesh_roots[av_lid]
			if node and is_instance_valid(node):
				node.position = rsi.pos
				node.quaternion = rsi.rot
			# Update ALL attachment child RSInstance positions so they follow the avatar.
			# Rigged MeshInstance3Ds follow via scene tree, but their hidden RSIs and
			# any non-rigged attachments need explicit repositioning.
			_update_children_world_pos(av_lid, rsi.pos, rsi.rot)

		# Emit camera follow signal for self avatar
		if avatar_id == sm.self_avatar_id:
			sm.self_avatar_moved.emit(rsi.pos)


## Recursively reposition all children of a parent to follow it.
## Used for avatar attachments and their sub-linksets.
func _update_children_world_pos(parent_id: int, parent_pos: Vector3, parent_rot: Quaternion) -> void:
	if not sm.object_children.has(parent_id):
		return
	for child_id: int in sm.object_children[parent_id]:
		var child_rsi = sm.objects.get(child_id)
		if child_rsi == null or not sm.child_offset_pos.has(child_id):
			continue
		child_rsi.pos = parent_pos + parent_rot * sm.child_offset_pos[child_id]
		child_rsi.rot = parent_rot * sm.child_offset_rot[child_id]
		child_rsi.push_transform()
		# Sync animesh root Node3D for child animesh objects (e.g. tail attached to avatar)
		_sync_animesh_transform(child_id, child_rsi)
		# Recurse into grandchildren (attachment linksets)
		_update_children_world_pos(child_id, child_rsi.pos, child_rsi.rot)


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
