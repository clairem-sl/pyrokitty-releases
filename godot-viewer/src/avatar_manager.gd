extends RefCounted

## Avatar CRUD, shape deformation, and self-avatar management.

var sm  # scene_manager reference

# Self avatar state
var _first_person_mode: bool = false

# Avatar shape deformation — per-avatar bone scale/offset from VisualParam
var _avatar_shapes: Dictionary = {}  # avatarId (String) -> bones Dictionary


func _init(scene_manager) -> void:
	sm = scene_manager


# ─── Self Avatar ─────────────────────────────────────

func set_vr_mode(enabled: bool) -> void:
	sm._vr_mode = enabled
	var FrameBudget = sm.FrameBudget
	sm._target_frame_ms = FrameBudget.DESKTOP_FRAME_MS
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
	# Godot yaw → visual rotation: add PI/2 to match the SL heading offset
	# (godot-input-handler.ts adds PI/2 when converting yaw to SL BodyRotation,
	# so sl_to_godot_quat on the server echo produces yaw + PI/2 around Y)
	rsi.rot = Quaternion(Vector3.UP, godot_yaw + PI / 2.0)
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
	var godot_pos: Vector3 = sm.object_mgr.sl_to_godot_pos(pos)
	var godot_rot := Quaternion.IDENTITY
	if msg.has("rotation"):
		godot_rot = sm.object_mgr.sl_to_godot_quat(msg["rotation"])

	# If avatar is sitting, transform local offset into world space
	var seat_id: int = int(msg.get("parentId", 0))
	var seat_rsi = sm.objects.get(seat_id) if seat_id > 0 else null
	if seat_id > 0:
		if seat_rsi != null:
			godot_pos = seat_rsi.pos + seat_rsi.rot * godot_pos
			godot_rot = seat_rsi.rot * godot_rot
		else:
			# Seat object hasn't arrived yet — queue for deferred resolution
			if not sm.pending_seated_avatars.has(seat_id):
				sm.pending_seated_avatars[seat_id] = []
			sm.pending_seated_avatars[seat_id].append({
				"id": avatar_id, "pos": godot_pos, "rot": godot_rot
			})
			print("[AvatarSit] Deferred: avatar=%s waiting for seat localId=%d" % [avatar_id.substr(0, 8), seat_id])

	print("[AvatarHeight] raw_sl_pos=%s godot_pos=%s seat=%d" % [pos, godot_pos, seat_id])
	rsi.pos = godot_pos
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
		# Apply pending shape if AvatarAppearance arrived before avatar_create
		if _avatar_shapes.has(avatar_id):
			print("[AvatarShape] Applying pending shape for %s at avatar_create" % avatar_id.substr(0, 8))
			_apply_shape_to_skeleton(shared_skel, _avatar_shapes[avatar_id], avatar_id)
			_log_bone_rests(shared_skel, avatar_id, "after_shape")
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
		sm.object_mgr._register_animesh_descendants(local_id, local_id)

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
		var raw_pos: Vector3 = sm.object_mgr.sl_to_godot_pos(data["position"])
		var seat_id: int = int(data.get("parentId", 0))
		var seat_rsi = sm.objects.get(seat_id) if seat_id > 0 else null

		var godot_pos: Vector3
		var godot_rot: Quaternion
		if seat_rsi != null:
			# Sitting: position and rotation are in the seat's local space.
			# World = seat_pos + seat_rot * local_offset (same as child prims).
			godot_pos = seat_rsi.pos + seat_rsi.rot * raw_pos
			if data.has("rotation"):
				godot_rot = seat_rsi.rot * sm.object_mgr.sl_to_godot_quat(data["rotation"])
			else:
				godot_rot = rsi.rot if rsi else Quaternion.IDENTITY
		else:
			godot_pos = raw_pos
			if data.has("rotation"):
				godot_rot = sm.object_mgr.sl_to_godot_quat(data["rotation"])
			else:
				godot_rot = rsi.rot if rsi else Quaternion.IDENTITY

		# Snap when sitting (no blend) — sit position is server-authoritative.
		var blend_offset := Vector3.ZERO
		if seat_rsi == null and rsi:
			blend_offset = rsi.pos - godot_pos
			if blend_offset.length() > sm.interp_mgr.AVATAR_MAX_INTERP_DIST:
				blend_offset = Vector3.ZERO

		if rsi:
			rsi.pos = godot_pos
			# Self avatar rotation is client-authoritative (set_self_avatar_yaw)
			# unless sitting, where the server controls the sit pose.
			if avatar_id != sm.self_avatar_id or seat_rsi != null:
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
			target["rot"] = sm.object_mgr.sl_to_godot_quat(data["rotation"])
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
			# Clean up mesh instance references (nodes freed when avatar_node is queue_freed)
			var to_erase: Array = []
			for mesh_lid: int in sm.animesh_mesh_instances:
				if sm.animesh_root_for.get(mesh_lid, 0) == av_lid:
					to_erase.append(mesh_lid)
			for mesh_lid: int in to_erase:
				sm.animesh_mesh_instances.erase(mesh_lid)
			var node_ref = sm.animesh_roots[av_lid]
			if node_ref is Node3D and is_instance_valid(node_ref):
				node_ref.queue_free()  # Also frees shared skeleton + per-mesh skeletons + meshes
			sm.animesh_roots.erase(av_lid)
			sm.animesh_shared_skeleton.erase(av_lid)
			sm.animesh_eval.erase(av_lid)
			sm.animesh_pending_anims.erase(av_lid)
			sm.animesh_worn_anims.erase(av_lid)
		sm.avatar_local_ids.erase(avatar_id)
		_avatar_shapes.erase(avatar_id)


# ─── Avatar Shape ─────────────────────────────────────

func handle_avatar_shape(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("avatarId", "")
	if avatar_id.is_empty():
		return
	var bones: Dictionary = msg.get("bones", {})
	_avatar_shapes[avatar_id] = bones

	var av_lid: int = sm.avatar_local_ids.get(avatar_id, 0)
	if av_lid <= 0:
		return
	var shared_skel: Skeleton3D = sm.animesh_shared_skeleton.get(av_lid)
	if shared_skel == null:
		return

	_apply_shape_to_skeleton(shared_skel, bones, avatar_id)
	_log_bone_rests(shared_skel, avatar_id, "after_shape")
	_reapply_joint_overrides(av_lid, shared_skel, avatar_id)
	_log_bone_rests(shared_skel, avatar_id, "after_reapply_overrides")
	print("[AvatarShape] Applied shape for avatar %s (%d bones modified)" % [avatar_id.substr(0, 8), bones.size()])


## Reset skeleton bone rests to XML baseline + shape scale/offset deltas.
## In SL (xform.cpp), a joint's scale affects its CHILDREN's positions:
##   child.worldPos = parent.worldRot * (child.localPos * parent.scale) + parent.worldPos
## where parent.scale is the parent's LOCAL scale (not world/cumulative).
## We bake the immediate parent scale into each bone's rest position.
## We do NOT put scale into the basis — Godot's rest basis scale would cascade
## through the entire subtree, which is not how SL works.
func _apply_shape_to_skeleton(skeleton: Skeleton3D, bones: Dictionary, avatar_id: String) -> void:
	var xml_bones: Array = sm.skeleton_builder.get_bone_data()
	var xml_by_name: Dictionary = {}
	for bd: Dictionary in xml_bones:
		xml_by_name[bd["name"]] = bd

	# Build parent_name → shape scale lookup (immediate parent scale only)
	var parent_scale: Dictionary = {}  # bone_name -> Vector3 (SL space scale)
	for bname: String in bones:
		var shape_data: Dictionary = bones[bname]
		var s: Array = shape_data.get("scale", [1, 1, 1])
		parent_scale[bname] = Vector3(s[0], s[1], s[2])

	var debug_bones: Array = ["mPelvis", "mHipLeft", "mHipRight", "mKneeLeft", "mKneeRight", "mAnkleLeft", "mAnkleRight", "mFootLeft", "mFootRight"]

	for bi in range(skeleton.get_bone_count()):
		var bname: String = skeleton.get_bone_name(bi)
		var xml_data: Dictionary = xml_by_name.get(bname, {})
		if xml_data.is_empty():
			continue  # dynamically-added bone, skip

		var rest := Transform3D()
		var sp: Vector3 = xml_data["pos"]  # SL space local position
		var is_debug: bool = debug_bones.has(bname)

		if is_debug:
			print("[ShapeDebug] %s %s: xml_pos_sl=(%s, %s, %s)" % [avatar_id.substr(0, 8), bname, "%.6f" % sp.x, "%.6f" % sp.y, "%.6f" % sp.z])

		# Apply shape offset to this bone's position (in SL space)
		if bones.has(bname):
			var shape_data: Dictionary = bones[bname]
			var o: Array = shape_data.get("offset", [0, 0, 0])
			var offset := Vector3(o[0], o[1], o[2])
			if is_debug:
				print("[ShapeDebug] %s %s: shape_offset_sl=(%s, %s, %s)" % [avatar_id.substr(0, 8), bname, "%.6f" % offset.x, "%.6f" % offset.y, "%.6f" % offset.z])
			sp += offset

		# Apply immediate parent's shape scale to this bone's position (in SL space).
		# SL xform.cpp: mWorldPosition.scaleVec(mParent->getScale()) where getScale()
		# returns the parent's LOCAL scale. The cascading through ancestors happens
		# naturally via each parent's already-scaled world position.
		var pname: String = xml_data.get("parent_name", "")
		if not pname.is_empty() and parent_scale.has(pname):
			var ps: Vector3 = parent_scale[pname]
			if is_debug:
				print("[ShapeDebug] %s %s: parent=%s parent_scale_sl=(%s, %s, %s) pos_before_scale=(%s, %s, %s)" % [avatar_id.substr(0, 8), bname, pname, "%.6f" % ps.x, "%.6f" % ps.y, "%.6f" % ps.z, "%.6f" % sp.x, "%.6f" % sp.y, "%.6f" % sp.z])
			sp = Vector3(sp.x * ps.x, sp.y * ps.y, sp.z * ps.z)
			if is_debug:
				print("[ShapeDebug] %s %s: pos_after_scale=(%s, %s, %s)" % [avatar_id.substr(0, 8), bname, "%.6f" % sp.x, "%.6f" % sp.y, "%.6f" % sp.z])

		# SL → Godot position conversion
		rest.origin = Vector3(sp.x, sp.z, -sp.y)
		if is_debug:
			print("[ShapeDebug] %s %s: final_godot=(%s, %s, %s)" % [avatar_id.substr(0, 8), bname, "%.6f" % rest.origin.x, "%.6f" % rest.origin.y, "%.6f" % rest.origin.z])
		skeleton.set_bone_rest(bi, rest)


## Re-apply joint overrides from all rigged meshes on an avatar after shape change.
## Override priority: lowest mesh UUID wins (matches SL's std::map<LLUUID> ordering).
func _reapply_joint_overrides(root_local_id: int, shared_skel: Skeleton3D, avatar_id: String) -> void:
	# Clear override ownership — shape just reset all bones, start fresh
	sm.bone_override_owner.erase(root_local_id)
	for mesh_lid: int in sm.animesh_mesh_instances:
		if sm.animesh_root_for.get(mesh_lid, 0) != root_local_id:
			continue
		var mesh_id: String = sm.object_mesh_id.get(mesh_lid, "")
		if mesh_id.is_empty():
			continue
		var override_joints: Array = sm.mesh_joint_overrides.get(mesh_id, [])
		if override_joints.is_empty():
			continue
		# Need the GLB skeleton to get the override rest transforms.
		# The override rest was already copied to shared_skel during initial setup,
		# and shape just reset all rests to XML baseline. Re-apply from the GLB.
		print("[ReapplyOverrides] %s mesh_lid=%d mesh_id=%s overrides=%s" % [avatar_id.substr(0, 8), mesh_lid, mesh_id.substr(0, 16), str(override_joints)])
		var glb_path: String = sm.rigged_mesh_paths.get(mesh_id, "")
		if glb_path.is_empty():
			continue
		var doc := GLTFDocument.new()
		var state := GLTFState.new()
		var err := doc.append_from_file(glb_path, state)
		if err != OK:
			continue
		var scene: Node = doc.generate_scene(state)
		if scene == null:
			continue
		var glb_skel: Skeleton3D = sm.object_mgr._find_node_of_type(scene, "Skeleton3D")
		if glb_skel != null:
			sm.animation_mgr._apply_joint_overrides(glb_skel, shared_skel, override_joints, mesh_id)
		scene.queue_free()


## Debug: log all bones whose rest differs from XML baseline
func _log_bone_rests(skel: Skeleton3D, avatar_id: String, stage: String) -> void:
	var xml_bones: Array = sm.skeleton_builder.get_bone_data()
	var xml_by_name: Dictionary = {}
	for bd: Dictionary in xml_bones:
		var sp: Vector3 = bd["pos"]
		xml_by_name[bd["name"]] = Vector3(sp.x, sp.z, -sp.y)  # SL → Godot

	var modified: int = 0
	for bi in range(skel.get_bone_count()):
		var bname: String = skel.get_bone_name(bi)
		var r: Transform3D = skel.get_bone_rest(bi)
		var xml_origin: Vector3 = xml_by_name.get(bname, r.origin)
		var origin_diff: float = (r.origin - xml_origin).length()
		var basis_is_identity: bool = r.basis.is_equal_approx(Basis.IDENTITY)
		if origin_diff > 0.0001 or not basis_is_identity:
			modified += 1
			print("[AvatarShape] %s %s %s rest=(%s, %s, %s) xml=(%s, %s, %s) delta=%.4f basis_id=%s" % [
				avatar_id.substr(0, 8), stage, bname,
				"%.4f" % r.origin.x, "%.4f" % r.origin.y, "%.4f" % r.origin.z,
				"%.4f" % xml_origin.x, "%.4f" % xml_origin.y, "%.4f" % xml_origin.z,
				origin_diff, str(basis_is_identity)])
	print("[AvatarShape] %s %s: %d bones modified from XML baseline" % [avatar_id.substr(0, 8), stage, modified])
