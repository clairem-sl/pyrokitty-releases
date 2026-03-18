extends RefCounted

## Object CRUD, linkset hierarchy, animesh instantiation, and coordinate conversion.

var sm  # scene_manager reference

# Attachment point ID → bone name (from avatar_lad.xml)
# IDs 31-38 are HUDs (filtered out on the bridge side, never sent to Godot)
const ATTACH_POINT_BONES: Dictionary = {
	1: "mChest",          # Chest
	2: "mHead",           # Skull
	3: "mCollarLeft",     # Left Shoulder
	4: "mCollarRight",    # Right Shoulder
	5: "mWristLeft",      # Left Hand
	6: "mWristRight",     # Right Hand
	7: "mFootLeft",       # Left Foot
	8: "mFootRight",      # Right Foot
	9: "mChest",          # Spine (Back)
	10: "mPelvis",        # Pelvis
	11: "mHead",          # Mouth
	12: "mHead",          # Chin
	13: "mHead",          # Left Ear
	14: "mHead",          # Right Ear
	15: "mEyeLeft",       # Left Eyeball
	16: "mEyeRight",      # Right Eyeball
	17: "mHead",          # Nose
	18: "mShoulderRight",  # R Upper Arm
	19: "mElbowRight",    # R Forearm
	20: "mShoulderLeft",  # L Upper Arm
	21: "mElbowLeft",     # L Forearm
	22: "mHipRight",      # Right Hip
	23: "mHipRight",      # R Upper Leg
	24: "mKneeRight",     # R Lower Leg
	25: "mHipLeft",       # Left Hip
	26: "mHipLeft",       # L Upper Leg
	27: "mKneeLeft",      # L Lower Leg
	28: "mPelvis",        # Stomach
	29: "mTorso",         # Left Pec
	30: "mTorso",         # Right Pec
	39: "mNeck",          # Neck
	40: "mRoot",          # Avatar Center
	41: "mHandRing1Left",  # Left Ring Finger
	42: "mHandRing1Right", # Right Ring Finger
	43: "mTail1",         # Tail Base
	44: "mTail6",         # Tail Tip
	45: "mWing4Left",     # Left Wing
	46: "mWing4Right",    # Right Wing
	47: "mFaceJaw",       # Jaw
	48: "mFaceEar1Left",  # Alt Left Ear
	49: "mFaceEar1Right", # Alt Right Ear
	50: "mFaceEyeAltLeft",  # Alt Left Eye
	51: "mFaceEyeAltRight", # Alt Right Eye
	52: "mFaceTongueTip", # Tongue
	53: "mGroin",         # Groin
	54: "mHindLimb4Left", # Left Hind Foot
	55: "mHindLimb4Right", # Right Hind Foot
}

# Attachment point local offsets relative to the bone (from avatar_lad.xml).
# Stored as SL-space position (x=fwd, y=left, z=up) and Euler degrees (roll, pitch, yaw).
# Only entries with non-zero pos or rot are included — all others are identity.
const ATTACH_POINT_OFFSETS: Dictionary = {
	1:  {"pos": Vector3(0.15, 0.0, -0.1),    "rot": Vector3(0, 90, 90)},   # Chest
	2:  {"pos": Vector3(0.0, 0.0, 0.15),     "rot": Vector3(0, 0, 90)},    # Skull
	3:  {"pos": Vector3(0.0, 0.0, 0.08),     "rot": Vector3(0, 0, 0)},     # Left Shoulder
	4:  {"pos": Vector3(0.0, 0.0, 0.08),     "rot": Vector3(0, 0, 0)},     # Right Shoulder
	5:  {"pos": Vector3(0.0, 0.08, -0.02),   "rot": Vector3(0, 0, 0)},     # Left Hand
	6:  {"pos": Vector3(0.0, -0.08, -0.02),  "rot": Vector3(0, 0, 0)},     # Right Hand
	9:  {"pos": Vector3(-0.15, 0.0, -0.1),   "rot": Vector3(0, -90, 90)},  # Spine
	10: {"pos": Vector3(0.0, 0.0, -0.15),    "rot": Vector3(0, 0, 0)},     # Pelvis
	11: {"pos": Vector3(0.12, 0.0, 0.001),   "rot": Vector3(0, 0, 0)},     # Mouth
	12: {"pos": Vector3(0.12, 0.0, -0.04),   "rot": Vector3(0, 0, 0)},     # Chin
	13: {"pos": Vector3(0.015, 0.08, 0.017), "rot": Vector3(0, 0, 0)},     # Left Ear
	14: {"pos": Vector3(0.015, -0.08, 0.017),"rot": Vector3(0, 0, 0)},     # Right Ear
	17: {"pos": Vector3(0.1, 0.0, 0.05),     "rot": Vector3(0, 0, 0)},     # Nose
	18: {"pos": Vector3(0.01, -0.13, 0.01),  "rot": Vector3(0, 0, 0)},     # R Upper Arm
	19: {"pos": Vector3(0.0, -0.12, 0.0),    "rot": Vector3(0, 0, 0)},     # R Forearm
	20: {"pos": Vector3(0.01, 0.15, -0.01),  "rot": Vector3(0, 0, 0)},     # L Upper Arm
	21: {"pos": Vector3(0.0, 0.113, 0.0),    "rot": Vector3(0, 0, 0)},     # L Forearm
	23: {"pos": Vector3(-0.017, 0.041, -0.310),  "rot": Vector3(0, 0, 0)}, # R Upper Leg
	24: {"pos": Vector3(-0.044, -0.007, -0.262), "rot": Vector3(0, 0, 0)}, # R Lower Leg
	26: {"pos": Vector3(-0.019, -0.034, -0.310), "rot": Vector3(0, 0, 0)}, # L Upper Leg
	27: {"pos": Vector3(-0.044, -0.007, -0.261), "rot": Vector3(0, 0, 0)}, # L Lower Leg
	28: {"pos": Vector3(0.092, 0.0, 0.088),  "rot": Vector3(0, 0, 0)},     # Stomach
	29: {"pos": Vector3(0.104, 0.082, 0.247),"rot": Vector3(0, 0, 0)},     # Left Pec
	30: {"pos": Vector3(0.104, -0.082, 0.247),"rot": Vector3(0, 0, 0)},    # Right Pec
	41: {"pos": Vector3(-0.006, 0.019, -0.002),"rot": Vector3(0, 0, 0)},   # Left Ring Finger
	42: {"pos": Vector3(-0.006, -0.019, -0.002),"rot": Vector3(0, 0, 0)},  # Right Ring Finger
	44: {"pos": Vector3(-0.025, 0.0, 0.0),   "rot": Vector3(0, 0, 0)},     # Tail Tip
}


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


# ─── Object Handlers ──────────────────────────────────
# Note: Coordinate conversion (SL→Godot) is done on the TypeScript side before sending.
# All position/rotation/scale arrays arrive pre-converted to Godot space.

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

	# Phase 1 placeholder — mesh, shape, and faces arrive later via object_complete
	# Sculpts skip the placeholder box — their real mesh may be a megaprim and the
	# placeholder box at that scale wrecks the scene until the sculpt mesh loads.
	var is_sculpt: bool = msg.get("sculpt", false)
	var _vfar: float = sm.FrameBudget.VR_CAMERA_FAR if sm._vr_mode else sm._vis_far
	var _vfade: float = sm.FrameBudget.VR_VISIBILITY_FADE_MARGIN if sm._vr_mode else sm._vis_fade
	var rsi = sm.RSInstance.new(sm._scenario, _vfar, _vfade)
	if not is_sculpt:
		rsi.set_mesh(sm.object_mesh)
		rsi.set_material_override(sm.object_material)

	# Apply transform
	var pos: Array = msg.get("position", [0, 0, 0])
	var rot: Array = msg.get("rotation", [0, 0, 0, 1])
	var scl: Array = msg.get("scale", [0.5, 0.5, 0.5])

	var godot_pos := Vector3(pos[0], pos[1], pos[2])
	var godot_rot := Quaternion(rot[0], rot[1], rot[2], rot[3])
	var godot_scale := Vector3(scl[0], scl[1], scl[2])

	rsi.scl = godot_scale  # SL prims have independent scale — no compensation

	if parent_id > 0:
		# Child prim — store relative offset for linkset movement
		sm.object_parent[local_id] = parent_id
		sm.child_offset_pos[local_id] = godot_pos
		sm.child_offset_rot[local_id] = godot_rot
		var _dbg_ap: int = msg.get("attachmentPoint", 0)
		if _dbg_ap > 0:
			print("[AttachDebug] localId=%d attachPt=%d offset_pos=%s offset_rot=%s" % [local_id, _dbg_ap, godot_pos, godot_rot])

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
			# If this attachment has a bone, use bone position for initial placement.
			# Shared skeleton has joint position overrides from mesh IBMs applied.
			var _ap: int = msg.get("attachmentPoint", 0)
			var _bn: String = ATTACH_POINT_BONES.get(_ap, "") if _ap > 0 else ""
			if not _bn.is_empty() and sm.animesh_shared_skeleton.has(parent_id):
				var _ss: Skeleton3D = sm.animesh_shared_skeleton[parent_id]
				var _bi: int = _ss.find_bone(_bn)
				if _bi >= 0:
					var _bpos: Vector3 = sm.animation_mgr._get_bone_global_rest_pos(_ss, _bi)
					var _bp: Vector3 = root_node.position + root_node.quaternion * _bpos
					var _bg: Transform3D = _ss.get_bone_global_rest(_bi)
					var _br: Quaternion = root_node.quaternion * _bg.basis.orthonormalized().get_rotation_quaternion()
					var _bone_scale: Vector3 = sm.bone_shape_scales.get(parent_id, {}).get(_bn, Vector3.ONE)
					var _ap_xf: Array = sm.animation_mgr._get_ap_world_transform(_ap, _bp, _br, _bone_scale)
					rsi.pos = _ap_xf[0] + _ap_xf[2] * godot_pos
					rsi.rot = _ap_xf[2] * godot_rot
				else:
					rsi.pos = root_node.position + root_node.quaternion * godot_pos
					rsi.rot = root_node.quaternion * godot_rot
			else:
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

	# Track attachment point bone for non-rigged attachments that follow skeleton bones.
	# Only store if the bone actually exists in the shared skeleton (mRoot doesn't — it's
	# not a real skeleton bone, just the avatar root. Those fall through to normal positioning).
	var attach_point: int = msg.get("attachmentPoint", 0)
	if attach_point > 0 and parent_id > 0 and sm.animesh_roots.has(parent_id):
		var bone_name: String = ATTACH_POINT_BONES.get(attach_point, "")
		if not bone_name.is_empty() and sm.animesh_shared_skeleton.has(parent_id):
			var _ss: Skeleton3D = sm.animesh_shared_skeleton[parent_id]
			var _bi: int = _ss.find_bone(bone_name)
			if _bi >= 0:
				sm.attach_bone[local_id] = bone_name
				sm.attach_point_id[local_id] = attach_point
				print("[AttachBone] localId=%d uuid=%s → bone=%s (attachPt=%d) parent=%d" % [local_id, _uuid_short(local_id), bone_name, attach_point, parent_id])
			else:
				print("[AttachBone] localId=%d bone=%s NOT FOUND in skeleton (attachPt=%d)" % [local_id, bone_name, attach_point])
		elif bone_name.is_empty():
			print("[AttachBone] localId=%d unknown attachmentPoint=%d" % [local_id, attach_point])
	elif attach_point > 0 and parent_id > 0:
		print("[AttachBone] localId=%d attachPt=%d but parent %d not in animesh_roots" % [local_id, attach_point, parent_id])

	# Animesh root detection — create a Node3D in the scene tree for skeleton parenting.
	# Worn animesh (child of avatar) uses the AVATAR's skeleton and root, matching SL behavior
	# where the ControlAvatar for a worn animesh shares the avatar's skeleton.
	if msg.get("animesh", false):
		if parent_id > 0 and sm.animesh_roots.has(parent_id):
			# Worn animesh attachment — gets its OWN skeleton, parented under the avatar's
			# root node so it follows the avatar's transform. Its child prims' joint
			# overrides must NOT affect the avatar's skeleton (they define a separate
			# rigged mesh, e.g. animated tail/wings on a dog avatar).
			var avatar_node: Node3D = sm.animesh_roots[parent_id]
			var animesh_node := Node3D.new()
			animesh_node.name = "worn_animesh_%d" % local_id
			avatar_node.add_child(animesh_node)
			animesh_node.position = Vector3.ZERO
			animesh_node.quaternion = Quaternion.IDENTITY
			animesh_node.scale = Vector3.ONE
			sm.animesh_roots[local_id] = animesh_node
			sm.animesh_root_for[local_id] = local_id
			if not sm.animesh_shared_skeleton.has(local_id):
				var shared_skel: Skeleton3D = sm.skeleton_builder.create_shared_skeleton()
				animesh_node.add_child(shared_skel)
				sm.animesh_shared_skeleton[local_id] = shared_skel
			_register_animesh_descendants(local_id, local_id)
			print("[Animesh] Worn animesh %d uuid=%s → own skeleton under avatar root %d" % [local_id, _uuid_short(local_id), parent_id])
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
			# Create shared skeleton — ALL meshes bind to this one skeleton (no per-mesh skeletons).
			# Added to scene tree as parent of MeshInstance3D nodes (Godot's expected pattern).
			if not sm.animesh_shared_skeleton.has(local_id):
				var shared_skel: Skeleton3D = sm.skeleton_builder.create_shared_skeleton()
				animesh_node.add_child(shared_skel)
				sm.animesh_shared_skeleton[local_id] = shared_skel
			if _is_self_avatar(local_id):
				print("[SelfAvatar] Animesh root object %d uuid=%s created" % [local_id, _uuid_short(local_id)])
			# Retroactively register existing children + grandchildren (attachment linksets)
			_register_animesh_descendants(local_id, local_id)

	# Track children of animesh roots (direct children AND grandchildren of linksets).
	# Skip if this object already has a root assigned (e.g. worn animesh that just
	# created its own root above — don't let child tracking overwrite it).
	if parent_id > 0 and not sm.animesh_root_for.has(local_id):
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
		print("[SelfAvatar] Attachment created: localId=%d uuid=%s parentId=%d" % [local_id, _uuid_short(local_id), parent_id])

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

	# Resolve any seated avatars waiting for this object as their seat
	if sm.pending_seated_avatars.has(local_id):
		for entry: Dictionary in sm.pending_seated_avatars[local_id]:
			var av_id: String = entry["id"]
			if sm.avatars.has(av_id):
				var world_pos: Vector3 = rsi.pos + rsi.rot * entry["pos"]
				var world_rot: Quaternion = rsi.rot * entry["rot"]
				sm.avatars[av_id].pos = world_pos
				sm.avatars[av_id].rot = world_rot
				sm.avatars[av_id].push_transform()
				sm.avatar_targets[av_id] = { "pos": world_pos, "rot": world_rot, "vel": Vector3.ZERO }
				# Update skeleton root node too
				var av_lid: int = sm.avatar_local_ids.get(av_id, 0)
				if av_lid > 0 and sm.animesh_roots.has(av_lid):
					var av_node: Node3D = sm.animesh_roots[av_lid]
					av_node.position = world_pos
					av_node.quaternion = world_rot
				print("[AvatarSit] Resolved: avatar=%s seat=%d pos=%s" % [av_id.substr(0, 8), local_id, world_pos])
		sm.pending_seated_avatars.erase(local_id)


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
			vel = Vector3(sv[0], sv[1], sv[2])
			if vel.length_squared() > 0.0001:
				has_motion = true
		if obj.has("acceleration"):
			var sa: Array = obj["acceleration"]
			accel = Vector3(sa[0], sa[1], sa[2])
			if accel.length_squared() > 0.0001:
				has_motion = true
		if obj.has("angularVelocity"):
			var sav: Array = obj["angularVelocity"]
			ang_vel = Vector3(sav[0], sav[1], sav[2])
			if ang_vel.length_squared() > 0.0001:
				has_motion = true

		if sm.object_parent.has(local_id):
			# Child prim — update offsets, parent interpolation handles world pos
			if obj.has("position"):
				var cp: Array = obj["position"]
				sm.child_offset_pos[local_id] = Vector3(cp[0], cp[1], cp[2])
			if obj.has("rotation"):
				var cr: Array = obj["rotation"]
				sm.child_offset_rot[local_id] = Quaternion(cr[0], cr[1], cr[2], cr[3])
			if obj.has("scale"):
				var cs: Array = obj["scale"]
				rsi.scl = Vector3(cs[0], cs[1], cs[2])
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
				var sp: Array = obj["position"]
				server_pos = Vector3(sp[0], sp[1], sp[2])
			var server_rot: Quaternion = rsi.rot
			if obj.has("rotation"):
				var sr: Array = obj["rotation"]
				server_rot = Quaternion(sr[0], sr[1], sr[2], sr[3])

			# Blend offset = how far visual pos is from server pos
			var blend_offset: Vector3 = rsi.pos - server_pos
			if blend_offset.length() > sm.interp_mgr.BLEND_SNAP_DIST:
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
				var ms: Array = obj["scale"]
				rsi.scl = Vector3(ms[0], ms[1], ms[2])
				rsi.push_transform()
		else:
			# Root prim, no motion — snap immediately
			# BUT if the object is currently being interpolated (physics updates
			# arrived more recently via high-priority), this batch message is stale
			# from the low-priority queue. Skip position/rotation to avoid snapping backward.
			if sm.object_targets.has(local_id):
				# Only allow scale changes from stale batch updates
				if obj.has("scale"):
					var ss: Array = obj["scale"]
					rsi.scl = Vector3(ss[0], ss[1], ss[2])
					rsi.push_transform()
			else:
				if obj.has("position"):
					var np: Array = obj["position"]
					rsi.pos = Vector3(np[0], np[1], np[2])
				if obj.has("rotation"):
					var nr: Array = obj["rotation"]
					rsi.rot = Quaternion(nr[0], nr[1], nr[2], nr[3])
				if obj.has("scale"):
					var ns: Array = obj["scale"]
					rsi.scl = Vector3(ns[0], ns[1], ns[2])
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
## Extracts MeshInstance3D from the GLB, applies joint position overrides from the
## GLB skeleton to the shared skeleton, and binds the mesh to the shared skeleton.
## The GLB's per-mesh Skeleton3D is discarded — only the shared skeleton is used.
func _instantiate_animesh_mesh(local_id: int, mesh_id: String, animesh_root_id: int) -> void:
	# Guard against double instantiation (can be called from cache hit + retry)
	if sm.animesh_mesh_instances.has(local_id):
		return
	var glb_path: String = sm.rigged_mesh_paths.get(mesh_id, "")
	if glb_path.is_empty():
		push_warning("[Animesh] No GLB path for rigged mesh %s (obj %d uuid=%s)" % [mesh_id, local_id, _uuid_short(local_id)])
		return
	var root_node: Node3D = sm.animesh_roots.get(animesh_root_id)
	if root_node == null:
		push_warning("[Animesh] No root node for animesh root %d uuid=%s (obj %d uuid=%s)" % [animesh_root_id, _uuid_short(animesh_root_id), local_id, _uuid_short(local_id)])
		return
	var shared_skel: Skeleton3D = sm.animesh_shared_skeleton.get(animesh_root_id)
	if shared_skel == null:
		push_warning("[Animesh] No shared skeleton for animesh root %d (obj %d uuid=%s)" % [animesh_root_id, local_id, _uuid_short(local_id)])
		return

	# Parse GLB and generate full scene tree (includes Skeleton3D + MeshInstance3D)
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

	# Find Skeleton3D and MeshInstance3D in the generated scene tree
	var glb_skeleton: Skeleton3D = _find_node_of_type(scene, "Skeleton3D")
	var mesh_instance: MeshInstance3D = _find_node_of_type(scene, "MeshInstance3D")
	if glb_skeleton == null or mesh_instance == null:
		push_warning("[Animesh] No Skeleton3D/MeshInstance3D in GLB for object %d uuid=%s" % [local_id, _uuid_short(local_id)])
		scene.queue_free()
		return

	# Apply joint position overrides from GLB skeleton to shared skeleton.
	# Override list comes from mesh_ready message, stored on scene_manager.
	var override_joints: Array = sm.mesh_joint_overrides.get(mesh_id, [])
	if override_joints.size() > 0:
		var av_uuid: String = sm.object_uuid.get(animesh_root_id, "?")
		print("[JointOverride] Applying %d overrides for mesh %s (avatar root=%d uuid=%s)" % [override_joints.size(), mesh_id.substr(0, 16), animesh_root_id, av_uuid.substr(0, 8)])
		sm.animation_mgr._apply_joint_overrides(glb_skeleton, shared_skel, override_joints, mesh_id)

	# Duplicate skin and remap bone indices to shared skeleton order.
	# Bones not in the shared skeleton (e.g. attachment point joints like "Pelvis",
	# "Mouth") are added dynamically with rest transforms from the GLB skeleton.
	var orig_skin: Skin = mesh_instance.skin

	if orig_skin != null:
		var new_skin: Skin = orig_skin.duplicate()
		for i in range(new_skin.get_bind_count()):
			var glb_bi: int = new_skin.get_bind_bone(i)
			if glb_bi >= 0 and glb_bi < glb_skeleton.get_bone_count():
				var bone_name: String = glb_skeleton.get_bone_name(glb_bi)
				var shared_bi: int = shared_skel.find_bone(bone_name)
				# No case-insensitive fallback — SL bone names are case-sensitive.
				# "Pelvis" (attachment point) != "PELVIS" (collision volume).
				# "Mouth" (attachment point) != "MOUTH" (collision volume, if any).
				# Mismatched names should fall through to dynamic bone addition.
				if shared_bi < 0:
					# Bone not in shared skeleton — add it dynamically.
					# This handles attachment point joints (e.g. "Pelvis", "Mouth")
					# that content creators rig vertices to. The GLB has the correct
					# rest transform (derived from IBM in mesh-converter.ts).
					shared_bi = shared_skel.add_bone(bone_name)
					var glb_rest: Transform3D = glb_skeleton.get_bone_rest(glb_bi)
					shared_skel.set_bone_rest(shared_bi, glb_rest)
					# Parent to the GLB bone's parent in the shared skeleton
					var glb_parent_bi: int = glb_skeleton.get_bone_parent(glb_bi)
					if glb_parent_bi >= 0:
						var parent_name: String = glb_skeleton.get_bone_name(glb_parent_bi)
						var shared_parent_bi: int = shared_skel.find_bone(parent_name)
						if shared_parent_bi >= 0:
							shared_skel.set_bone_parent(shared_bi, shared_parent_bi)
					print("[Animesh] Added missing bone '%s' (idx %d) to shared skeleton" % [bone_name, shared_bi])
				if shared_bi >= 0:
					new_skin.set_bind_bone(i, shared_bi)
		mesh_instance.skin = new_skin

	# Reparent mesh under shared skeleton
	mesh_instance.set_owner(null)
	mesh_instance.get_parent().remove_child(mesh_instance)
	shared_skel.add_child(mesh_instance)
	mesh_instance.transform = Transform3D.IDENTITY  # Reset local transform
	mesh_instance.skeleton = mesh_instance.get_path_to(shared_skel)

	# Store reference
	sm.animesh_mesh_instances[local_id] = mesh_instance

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
		sm.animation_mgr._apply_pending_animations(local_id)

	if _is_self_avatar(local_id):
		print("[SelfAvatar] Rigged mesh instantiated: localId=%d meshId=%s shared_bones=%d" % [local_id, mesh_id.substr(0, 8), shared_skel.get_bone_count()])

	# Debug: visualize skeleton once per root (check for existing markers)
	if sm.animation_mgr._debug_skeleton_visible:
		var already_has_markers: bool = false
		for child in shared_skel.get_children():
			if child.name.begins_with("dbg_bone_"):
				already_has_markers = true
				break
		if not already_has_markers:
			sm.animation_mgr._debug_visualize_skeleton(shared_skel)

	# Free the GLB scene (GLB skeleton + any remaining nodes)
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


# ─── Object Complete (Phase 2) ────────────────────────

## Handle object_complete — applies mesh, shape, and face materials to an existing placeholder.
## Sent by the readiness tracker once all assets (mesh + textures) are cached on disk.
func handle_object_complete(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	var rsi = sm.objects.get(local_id)
	if rsi == null:
		return  # killed before completion

	var mesh_id: String = msg.get("meshId", "")
	var faces: Array = msg.get("faces", [])
	var shape: Dictionary = msg.get("shape", {})

	# Apply mesh
	if not mesh_id.is_empty():
		if sm.mesh_cache.has(mesh_id):
			var is_rigged: bool = sm.rigged_mesh_paths.has(mesh_id)
			var will_be_animesh: bool = sm.animesh_root_for.has(local_id)

			if is_rigged and will_be_animesh and not sm.animesh_roots.has(local_id):
				# Animesh child with rigged mesh: use placeholder — real mesh goes on Skeleton3D
				pass  # keep existing placeholder mesh
			elif is_rigged and not sm.animesh_roots.has(local_id) and not will_be_animesh:
				# Non-animesh rigged: use cached mesh with AABB correction
				var cached_mesh: Mesh = sm.mesh_cache[mesh_id]
				rsi.set_mesh(cached_mesh)
				var aabb: AABB = cached_mesh.get_aabb()
				if aabb.size.x > 0.001 and aabb.size.y > 0.001 and aabb.size.z > 0.001:
					rsi.scl_divisor = aabb.size
					rsi.scl_center = aabb.get_center()
				rsi.push_transform()
			else:
				rsi.set_mesh(sm.mesh_cache[mesh_id])

			sm.object_mesh_id[local_id] = mesh_id

			# Animesh rigged mesh instantiation
			if sm.animesh_root_for.has(local_id) and sm.rigged_mesh_paths.has(mesh_id):
				var ar_id: int = sm.animesh_root_for[local_id]
				if not sm.animesh_mesh_instances.has(local_id):
					_instantiate_animesh_mesh(local_id, mesh_id, ar_id)
		else:
			# mesh_ready hasn't been processed yet — retry when mesh loads
			if not sm.asset_pipeline._pending_complete_by_mesh.has(mesh_id):
				sm.asset_pipeline._pending_complete_by_mesh[mesh_id] = []
			sm.asset_pipeline._pending_complete_by_mesh[mesh_id].append(msg)
			# Re-request from TS if not in-flight (may have been evicted)
			if not sm.asset_pipeline._mesh_in_flight.has(mesh_id):
				sm.asset_pipeline._request_mesh(mesh_id)
	elif not shape.is_empty():
		rsi.set_mesh(sm.prim_generator.get_or_generate(shape))

	# Apply face materials (textures should be cached)
	if faces.size() > 0:
		sm.object_faces[local_id] = faces
		sm.asset_pipeline.apply_face_materials(rsi, local_id, faces)


# ─── Face/Material Updates ───────────────────────────

## Handle face updates from material asset fetch (PBR materials resolved after initial object_create)
func handle_update_faces(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	var rsi = sm.objects.get(local_id)
	if rsi == null or rsi.mesh == null:
		return
	var faces: Array = msg.get("faces", [])
	if faces.size() == 0:
		return

	# Merge into existing face data so apply_face_materials picks up PBR updates
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


## Handle batched face updates (multiple objects in one message)
func handle_update_faces_batch(msg: Dictionary) -> void:
	var obj_list: Array = msg.get("objects", [])
	for entry: Dictionary in obj_list:
		handle_update_faces(entry)


# ─── Object Cleanup ──────────────────────────────────

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

	# Clean up animesh mesh instance (child of shared skeleton, freed individually)
	if sm.animesh_mesh_instances.has(local_id):
		var ami_ref = sm.animesh_mesh_instances[local_id]
		if ami_ref is MeshInstance3D and is_instance_valid(ami_ref):
			ami_ref.queue_free()
		sm.animesh_mesh_instances.erase(local_id)
	sm.object_mesh_id.erase(local_id)
	sm.attach_bone.erase(local_id)
	sm.animesh_root_for.erase(local_id)
	if sm.animesh_roots.has(local_id):
		var animesh_ref = sm.animesh_roots[local_id]
		if animesh_ref is Node3D and is_instance_valid(animesh_ref):
			animesh_ref.queue_free()
		sm.erase_animesh_state(local_id)

	# Clean up asset pipeline retry queues
	var mid: String = sm.object_mesh_id.get(local_id, "")
	if not mid.is_empty() and sm.asset_pipeline._pending_complete_by_mesh.has(mid):
		var msgs: Array = sm.asset_pipeline._pending_complete_by_mesh[mid]
		msgs = msgs.filter(func(m: Dictionary) -> bool: return int(m.get("localId", 0)) != local_id)
		if msgs.size() == 0:
			sm.asset_pipeline._pending_complete_by_mesh.erase(mid)
		else:
			sm.asset_pipeline._pending_complete_by_mesh[mid] = msgs
	# Remove from texture waiting lists
	for tid: String in sm.asset_pipeline._tex_waiting.keys():
		sm.asset_pipeline._tex_waiting[tid].erase(local_id)
		if sm.asset_pipeline._tex_waiting[tid].size() == 0:
			sm.asset_pipeline._tex_waiting.erase(tid)
	sm.object_faces.erase(local_id)
	sm.object_meta.erase(local_id)
	sm.object_uuid.erase(local_id)
	sm.child_offset_pos.erase(local_id)
	sm.child_offset_rot.erase(local_id)
	sm.pending_children.erase(local_id)
