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

# Debug skeleton visualization (toggled via Ctrl+Shift+1)
var _debug_skeleton_visible: bool = false

# CV bone SL-space rest rotations — cached from skeleton_builder.
# Used as fallback for unanimated CV bones in animation evaluation.
var _sl_cv_rest_rotations: Dictionary = {}

# Per-root previous SL local rotations for crossfade blending.
# When the winning animation for a joint changes, we slerp from the old
# rotation to the new one to avoid visual snapping (mimics Firestorm's
# ease-in/ease-out crossfade).
var _prev_sl_local_rot: Dictionary = {}  # root_id -> { joint_name -> Quaternion }
const _ANIM_BLEND_SPEED: float = 10.0  # ~0.2s to 95% convergence

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
			# Non-animesh rigged: use cached mesh with AABB correction for prim scale
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
					var _bpos: Vector3 = _get_bone_global_rest_pos(_ss, _bi)
					var _bp: Vector3 = root_node.position + root_node.quaternion * _bpos
					var _bg: Transform3D = _ss.get_bone_global_rest(_bi)
					var _br: Quaternion = root_node.quaternion * _bg.basis.orthonormalized().get_rotation_quaternion()
					var _ap_xf: Array = _get_ap_world_transform(_ap, _bp, _br)
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
## Extracts MeshInstance3D from the GLB, applies joint position overrides from the
## GLB skeleton to the shared skeleton, and binds the mesh to the shared skeleton.
## The GLB's per-mesh Skeleton3D is discarded — only the shared skeleton is used.
func _instantiate_animesh_mesh(local_id: int, mesh_id: String, animesh_root_id: int) -> void:
	# Guard against double instantiation (can be called from cache hit + _apply_mesh_to_pending)
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
		print("[JointOverride] Applying %d overrides for mesh %s" % [override_joints.size(), mesh_id.substr(0, 8)])
		_apply_joint_overrides(glb_skeleton, shared_skel, override_joints)

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
		_apply_pending_animations(local_id)

	if _is_self_avatar(local_id):
		print("[SelfAvatar] Rigged mesh instantiated: localId=%d meshId=%s shared_bones=%d" % [local_id, mesh_id.substr(0, 8), shared_skel.get_bone_count()])

	# Debug: visualize skeleton once per root (check for existing markers)
	if _debug_skeleton_visible:
		var already_has_markers: bool = false
		for child in shared_skel.get_children():
			if child.name.begins_with("dbg_bone_"):
				already_has_markers = true
				break
		if not already_has_markers:
			_debug_visualize_skeleton(shared_skel)

	# Free the GLB scene (GLB skeleton + any remaining nodes)
	scene.queue_free()


## DEBUG: Place a colored sphere on each bone. Uses plain Node3D (not BoneAttachment3D)
## because BoneAttachment3D reads global pose before our manual set_bone_pose calls.
## Markers are positioned each frame in _update_debug_bone_markers() after animation eval.
## Red = standard bones, Green = collision volumes (detected by UPPER_CASE name convention).
func _debug_visualize_skeleton(skel: Skeleton3D) -> void:
	var sphere_mesh := SphereMesh.new()
	sphere_mesh.radius = 0.03
	sphere_mesh.height = 0.06

	var mat_standard := StandardMaterial3D.new()
	mat_standard.albedo_color = Color(1.0, 0.2, 0.2)  # Red
	mat_standard.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	var mat_cv := StandardMaterial3D.new()
	mat_cv.albedo_color = Color(0.2, 1.0, 0.2)  # Green
	mat_cv.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	var count: int = 0
	for bi in range(skel.get_bone_count()):
		var bname: String = skel.get_bone_name(bi)

		var mi := MeshInstance3D.new()
		mi.name = "dbg_bone_%s" % bname
		mi.mesh = sphere_mesh
		# CVs use UPPER_CASE names; standard bones use mCamelCase or lowercase
		var is_cv: bool = bname == bname.to_upper() and not bname.begins_with("m")
		mi.material_override = mat_cv if is_cv else mat_standard
		mi.top_level = true  # Use world-space transform (not relative to skeleton)
		skel.add_child(mi)
		count += 1

	print("[DebugSkel] Placed %d bone markers on skeleton (%d bones)" % [count, skel.get_bone_count()])


## Toggle debug skeleton markers on/off.
func toggle_debug_skeleton() -> void:
	_debug_skeleton_visible = not _debug_skeleton_visible
	print("[DebugSkel] Skeleton markers %s" % ("ON" if _debug_skeleton_visible else "OFF"))
	if _debug_skeleton_visible:
		# Add markers to all existing shared skeletons
		for root_id in sm.animesh_shared_skeleton:
			var skel: Skeleton3D = sm.animesh_shared_skeleton[root_id]
			var already_has_markers: bool = false
			for child in skel.get_children():
				if child.name.begins_with("dbg_bone_"):
					already_has_markers = true
					break
			if not already_has_markers:
				_debug_visualize_skeleton(skel)
	else:
		# Remove markers from all shared skeletons
		for root_id in sm.animesh_shared_skeleton:
			var skel: Skeleton3D = sm.animesh_shared_skeleton[root_id]
			var to_remove: Array[Node] = []
			for child in skel.get_children():
				if child.name.begins_with("dbg_bone_"):
					to_remove.append(child)
			for child in to_remove:
				child.queue_free()


## Update debug bone marker positions after animation evaluation.
## Called from process_animesh() so markers reflect the current frame's poses.
func _update_debug_bone_markers(skel: Skeleton3D) -> void:
	var skel_global: Transform3D = skel.global_transform
	for child in skel.get_children():
		if not child.name.begins_with("dbg_bone_"):
			continue
		var bname: String = child.name.substr(9)  # Strip "dbg_bone_" prefix
		var bi: int = skel.find_bone(bname)
		if bi < 0:
			continue
		# Compute bone global transform manually (rest * pose through parent chain)
		var chain: Array[int] = []
		var cur: int = bi
		while cur >= 0:
			chain.append(cur)
			cur = skel.get_bone_parent(cur)
		chain.reverse()
		var bone_xf := Transform3D.IDENTITY
		for idx: int in chain:
			var rest_xf: Transform3D = skel.get_bone_rest(idx)
			var pose_rot: Quaternion = skel.get_bone_pose_rotation(idx)
			var pose_pos: Vector3 = skel.get_bone_pose_position(idx)
			bone_xf = bone_xf * rest_xf * Transform3D(Basis(pose_rot), pose_pos)
		child.global_position = (skel_global * bone_xf).origin


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

	# Build per-joint per-CHANNEL priority maps.
	# SL claims rotation and position independently: an animation with position
	# keys but no rotation keys claims the position channel without blocking
	# lower-priority animations from providing rotation (and vice versa).
	var joint_best_rot: Dictionary = {}  # joint_name -> {priority, data_idx, joint_data}
	var joint_best_pos: Dictionary = {}
	for ai in range(available.size()):
		var data: Dictionary = available[ai]
		var base_priority: int = int(data.get("priority", 0))
		var joints: Array = data.get("joints", [])
		for joint_data: Dictionary in joints:
			var jname: String = str(joint_data.get("name", ""))
			if jname.is_empty():
				continue
			var jpri: int = int(joint_data.get("priority", base_priority))
			if (joint_data.get("rotationKeys", []) as Array).size() > 0:
				if not joint_best_rot.has(jname) or jpri >= joint_best_rot[jname]["priority"]:
					joint_best_rot[jname] = {"priority": jpri, "data_idx": ai, "joint_data": joint_data}
			if (joint_data.get("positionKeys", []) as Array).size() > 0:
				if not joint_best_pos.has(jname) or jpri >= joint_best_pos[jname]["priority"]:
					joint_best_pos[jname] = {"priority": jpri, "data_idx": ai, "joint_data": joint_data}

	# Build merged joint keyframe map (SL space — NOT coordinate-converted)
	# Rotation and position may come from different animations. Each channel
	# uses the winning animation's timing for keyframe interpolation.
	var prev_eval: Dictionary = sm.animesh_eval.get(root_id, {}) as Dictionary
	var prev_joints: Dictionary = prev_eval.get("joints", {}) as Dictionary
	var prev_elapsed: float = prev_eval.get("elapsed", 0.0)

	# Collect all joints that won at least one channel
	var all_joint_names: Dictionary = {}
	for jname in joint_best_rot:
		all_joint_names[jname] = true
	for jname in joint_best_pos:
		all_joint_names[jname] = true

	var merged_joints: Dictionary = {}
	for jname: String in all_joint_names:
		var rot_entry: Dictionary = joint_best_rot.get(jname, {}) as Dictionary
		var pos_entry: Dictionary = joint_best_pos.get(jname, {}) as Dictionary

		var rot_keys: Array = []
		var pos_keys: Array = []

		# Pick the rotation winner's animation for timing (most joints are rot-driven)
		var src_anim: Dictionary = {}
		var anim_uuid: String = ""
		if not rot_entry.is_empty():
			rot_keys = (rot_entry["joint_data"] as Dictionary).get("rotationKeys", [])
			src_anim = available[int(rot_entry["data_idx"])]
			anim_uuid = str(src_anim.get("uuid", ""))
		if not pos_entry.is_empty():
			pos_keys = (pos_entry["joint_data"] as Dictionary).get("positionKeys", [])
			if src_anim.is_empty():
				src_anim = available[int(pos_entry["data_idx"])]
				anim_uuid = str(src_anim.get("uuid", ""))

		# If same animation still wins this joint, keep its start time
		var start_elapsed: float = prev_elapsed
		if prev_joints.has(jname):
			var prev_jdata: Dictionary = prev_joints[jname]
			if prev_jdata.get("anim_uuid", "") == anim_uuid:
				start_elapsed = float(prev_jdata.get("start_elapsed", prev_elapsed))
		merged_joints[jname] = {
			"rot_keys": rot_keys,
			"pos_keys": pos_keys,
			"duration": float(src_anim.get("duration", 1.0)),
			"loop": src_anim.get("loop", false),
			"loop_in": float(src_anim.get("loopInPoint", 0.0)),
			"loop_out": float(src_anim.get("loopOutPoint", src_anim.get("duration", 1.0))),
			"ease_in_time": float(src_anim.get("easeInTime", 0.0)),
			"ease_out_time": float(src_anim.get("easeOutTime", 0.0)),
			"anim_uuid": anim_uuid,
			"start_elapsed": start_elapsed,
		}

	# Store eval data — preserve elapsed and since_eval if already running
	var prev_since_eval: float = prev_eval.get("since_eval", 0.0)
	sm.animesh_eval[root_id] = {
		"elapsed": prev_elapsed,
		"since_eval": prev_since_eval,
		"joints": merged_joints,
	}
	sm.animesh_eval_active = true

	if _is_self_avatar(root_id):
		print("[SelfAvatar] Animations applied: %d joints merged from %d animations" % [merged_joints.size(), available.size()])


## Per-frame animesh animation evaluation.
## All meshes bind to the shared skeleton — one evaluation pass per avatar/animesh root.
## SL xform.cpp:80: mWorldRotation = mRotation * mParent->getWorldRotation()
## SL's operator*(a,b) = Hamilton(b*a), so this is Hamilton(parent * local).
## Godot uses standard Hamilton, so we write: world = parent * local.
## Skeleton evaluation runs at 30 Hz — the visual difference vs 72 Hz is
## negligible for humanoid motion and this halves the Skeleton3D API call
## budget on alternating frames.
const _ANIM_EVAL_INTERVAL: float = 1.0 / 30.0

func process_animesh(delta: float) -> void:
	for root_id: int in sm.animesh_eval:
		var eval: Dictionary = sm.animesh_eval[root_id]

		# Advance wall-clock elapsed time every frame so animation timing
		# stays accurate even when skeleton evaluation is skipped.
		eval["elapsed"] += delta

		# Throttle skeleton evaluation to 30 Hz.
		var since_eval: float = eval.get("since_eval", _ANIM_EVAL_INTERVAL)
		since_eval += delta
		if since_eval < _ANIM_EVAL_INTERVAL:
			eval["since_eval"] = since_eval
			continue
		eval["since_eval"] = 0.0

		var elapsed: float = eval["elapsed"]

		var joints: Dictionary = eval["joints"]  # joint_name -> {rot_keys, pos_keys, duration, loop}

		# Evaluate SL local rotations and positions (SL space, NOT converted).
		# Each joint uses its own start_elapsed (when its winning animation was first
		# assigned) so that frequent animation-set rebuilds don't reset joint timing.
		# Looping animations use inPoint/outPoint to define the loop region:
		#   - First play: 0 → outPoint (plays ease-in + loop body once)
		#   - Subsequent: loops inPoint → outPoint
		var sl_local_rot: Dictionary = {}  # joint_name -> Quaternion (SL space)
		var sl_local_pos: Dictionary = {}  # joint_name -> Vector3 (SL space, meters)
		for jname: String in joints:
			var jdata: Dictionary = joints[jname]
			var jdur: float = jdata["duration"]
			var joint_elapsed: float = elapsed - float(jdata.get("start_elapsed", 0.0))
			var t: float
			if jdur <= 0.0:
				t = 0.0  # Static pose (e.g. hand pose anims: dur=0, single keyframe)
			elif jdata["loop"]:
				var loop_in: float = float(jdata.get("loop_in", 0.0))
				var loop_out: float = float(jdata.get("loop_out", jdur))
				var loop_len: float = loop_out - loop_in
				if loop_len <= 0.0:
					t = loop_in
				elif float(jdata.get("ease_in_time", 0.0)) > loop_len:
					# Ease-in reference frame at loopInPoint: easeInTime exceeds
					# the loop region, so the first keyframe is a blend-from
					# reference (e.g. identity on hand/finger poses), not real
					# content.  Clamp to loopOutPoint after the first pass so the
					# target pose holds steady instead of oscillating back through
					# the reference frame.
					t = minf(joint_elapsed, loop_out)
				elif joint_elapsed <= loop_out:
					# First pass: play from 0 through loop_out (includes ease-in)
					t = minf(joint_elapsed, loop_out)
				else:
					# Subsequent passes: loop within inPoint → outPoint
					t = loop_in + fmod(joint_elapsed - loop_out, loop_len)
			else:
				t = minf(joint_elapsed, jdur)
			var rot_keys: Array = jdata["rot_keys"]
			if rot_keys.size() > 0:
				sl_local_rot[jname] = _interp_sl_rotation(rot_keys, t)
			var pos_keys: Array = jdata["pos_keys"]
			if pos_keys.size() > 0:
				sl_local_pos[jname] = _interp_sl_position(pos_keys, t)

		# TEMP DEBUG: log finger joint state every ~3 seconds
		if Engine.get_frames_drawn() % 180 == 0:
			var finger_in_joints: int = 0
			var finger_in_rot: int = 0
			var finger_missing: Array = []
			var sample: String = ""
			var sample_rot: String = ""
			for jname2: String in joints:
				if jname2.contains("Thumb") or jname2.contains("Index") or jname2.contains("Middle") or jname2.contains("Ring") or jname2.contains("Pinky"):
					finger_in_joints += 1
					if not sl_local_rot.has(jname2):
						finger_missing.append(jname2)
					var jd2: Dictionary = joints[jname2]
					if sample.is_empty():
						var je: float = elapsed - float(jd2.get("start_elapsed", 0.0))
						sample = "%s dur=%.2f rkeys=%d loop=%s anim=%s je=%.2f" % [jname2, jd2["duration"], (jd2["rot_keys"] as Array).size(), str(jd2["loop"]), str(jd2.get("anim_uuid", "?")).substr(0, 8), je]
						if sl_local_rot.has(jname2):
							var q: Quaternion = sl_local_rot[jname2]
							sample_rot = " rot=(%.3f,%.3f,%.3f,%.3f)" % [q.x, q.y, q.z, q.w]
			for jname2 in sl_local_rot:
				if (jname2 as String).contains("Thumb") or (jname2 as String).contains("Index") or (jname2 as String).contains("Middle") or (jname2 as String).contains("Ring") or (jname2 as String).contains("Pinky"):
					finger_in_rot += 1
			if finger_in_joints > 0:
				var missing_str: String = "" if finger_missing.is_empty() else " MISSING=%s" % ",".join(finger_missing.slice(0, 5))
				print("[FingerDbg] root=%d fingers_in_merged=%d fingers_with_rot=%d elapsed=%.1f %s%s%s" % [root_id, finger_in_joints, finger_in_rot, elapsed, sample, sample_rot, missing_str])
			# TEMP DEBUG: log ankle/foot/toe joint state
			var foot_joints: Array = []
			for jname2 in joints:
				var jn_lower: String = (jname2 as String).to_lower()
				if jn_lower.contains("ankle") or jn_lower.contains("foot") or jn_lower.contains("toe"):
					var jd2: Dictionary = joints[jname2]
					var rkeys: int = (jd2["rot_keys"] as Array).size()
					var pkeys: int = (jd2["pos_keys"] as Array).size()
					var has_r: String = "ROT" if sl_local_rot.has(jname2) else "norot"
					var anim_id: String = str(jd2.get("anim_uuid", "?")).substr(0, 8)
					foot_joints.append("%s(rk=%d,pk=%d,%s,anim=%s,dur=%.1f)" % [jname2, rkeys, pkeys, has_r, anim_id, float(jd2.get("duration", 0.0))])
			if foot_joints.size() > 0:
				print("[FootDbg] root=%d %s" % [root_id, ", ".join(foot_joints)])

		# Per-animation ease-in blending (matches SL viewer's motion controller).
		# Each animation has an easeInTime during which its contribution ramps
		# from 0→1 using a cubic smoothstep curve.  Combined with the per-frame
		# crossfade this produces smooth transitions when animations start.
		var prev_rot: Dictionary = _prev_sl_local_rot.get(root_id, {}) as Dictionary
		var base_blend: float = 1.0 - exp(-_ANIM_BLEND_SPEED * since_eval)
		for jname3: String in sl_local_rot:
			var blend: float = base_blend
			# Cap blend rate by per-animation ease-in weight (cubic smoothstep)
			if joints.has(jname3):
				var jdata3: Dictionary = joints[jname3]
				var ease_in: float = float(jdata3.get("ease_in_time", 0.0))
				if ease_in > 0.0:
					var je3: float = elapsed - float(jdata3.get("start_elapsed", 0.0))
					if je3 < ease_in:
						var f: float = clampf(je3 / ease_in, 0.0, 1.0)
						var ease_weight: float = f * f * (3.0 - 2.0 * f)
						blend = minf(blend, ease_weight)
			if prev_rot.has(jname3):
				var prev_q: Quaternion = prev_rot[jname3]
				var new_q: Quaternion = sl_local_rot[jname3]
				if prev_q.dot(new_q) < 0.0:
					new_q = -new_q
				sl_local_rot[jname3] = prev_q.slerp(new_q, blend)
			elif blend < 1.0:
				# No previous rotation — blend from identity (rest pose in SL space)
				sl_local_rot[jname3] = Quaternion.IDENTITY.slerp(sl_local_rot[jname3], blend)
		_prev_sl_local_rot[root_id] = sl_local_rot.duplicate()

		# Evaluate on shared skeleton — all meshes bind to it via Godot skinning
		var shared_skel: Skeleton3D = sm.animesh_shared_skeleton.get(root_id)
		if shared_skel != null:
			_evaluate_skeleton_animation(shared_skel, sl_local_rot, sl_local_pos)
			_update_bone_attachments(root_id, shared_skel)
			if _debug_skeleton_visible:
				_update_debug_bone_markers(shared_skel)



## Update non-rigged avatar attachments to follow their attachment bone each frame.
## Uses the shared skeleton (which has joint position overrides from mesh IBMs applied).
## Since all meshes bind to the shared skeleton, bone transforms are read directly
## from it — no per-mesh skeleton search needed.
func _update_bone_attachments(root_id: int, shared_skel: Skeleton3D) -> void:
	if not sm.object_children.has(root_id):
		return
	var root_node: Node3D = sm.animesh_roots.get(root_id)
	if root_node == null or not is_instance_valid(root_node):
		return
	for child_id: int in sm.object_children[root_id]:
		if not sm.attach_bone.has(child_id):
			continue
		# Skip rigged mesh attachments — they follow the skeleton via skinning
		if sm.animesh_mesh_instances.has(child_id):
			continue
		var child_rsi = sm.objects.get(child_id)
		if child_rsi == null:
			continue
		var bone_name: String = sm.attach_bone[child_id]

		var bi: int = shared_skel.find_bone(bone_name)
		if bi < 0:
			continue

		# Compute bone global transform from shared skeleton (rest * pose through parent chain)
		var chain: Array[int] = []
		var cur: int = bi
		while cur >= 0:
			chain.append(cur)
			cur = shared_skel.get_bone_parent(cur)
		chain.reverse()

		var bone_global_xf := Transform3D.IDENTITY
		for idx: int in chain:
			var rest_xf: Transform3D = shared_skel.get_bone_rest(idx)
			var pose_rot: Quaternion = shared_skel.get_bone_pose_rotation(idx)
			var pose_pos: Vector3 = shared_skel.get_bone_pose_position(idx)
			bone_global_xf = bone_global_xf * rest_xf * Transform3D(Basis(pose_rot), pose_pos)

		var bone_pos: Vector3 = bone_global_xf.origin
		var bone_rot: Quaternion = bone_global_xf.basis.orthonormalized().get_rotation_quaternion()

		# Debug: log once per child
		if not sm._attach_bone_logged.has(child_id):
			sm._attach_bone_logged[child_id] = true
			var _dbg_offset_pos: Vector3 = sm.child_offset_pos.get(child_id, Vector3.ZERO)
			var _dbg_ap_id: int = sm.attach_point_id.get(child_id, 0)
			print("[AttachBone] child=%d bone=%s bone_pos=%s offset_pos=%s ap=%d root=%d" % [child_id, bone_name, bone_pos, _dbg_offset_pos, _dbg_ap_id, root_id])

		var bone_world_pos: Vector3 = root_node.position + root_node.quaternion * bone_pos
		var bone_world_rot: Quaternion = root_node.quaternion * bone_rot
		var ap_id: int = sm.attach_point_id.get(child_id, 0)
		var ap_xf: Array = _get_ap_world_transform(ap_id, bone_world_pos, bone_world_rot)
		var offset_pos: Vector3 = sm.child_offset_pos.get(child_id, Vector3.ZERO)
		var offset_rot: Quaternion = sm.child_offset_rot.get(child_id, Quaternion.IDENTITY)
		child_rsi.pos = ap_xf[0] + ap_xf[2] * offset_pos
		child_rsi.rot = ap_xf[2] * offset_rot
		child_rsi.push_transform()
		_sync_animesh_transform(child_id, child_rsi)
		if sm.light_mgr.object_lights.has(child_id):
			sm.light_mgr.update_light_transform(child_id, child_rsi)
		if sm.object_children.has(child_id):
			_update_children_world_pos(child_id, child_rsi.pos, child_rsi.rot)


## Compute the world rotation of an attachment point given the bone's world rotation.
## Returns [_, _, ap_world_rot] (only index [2] is used — the AP world orientation).
## ap_xf[2] = bone_world_rot * ap_rot_godot, used for child_offset_rot orientation.
## NOTE: Position is NOT derived here. SL network sends child positions in avatar-root-local
## space (already includes AP height). Position = root_node.pos + root_node.rot * child_offset.
func _get_ap_world_transform(ap_id: int, bone_world_pos: Vector3, bone_world_rot: Quaternion) -> Array:
	if ap_id <= 0 or not ATTACH_POINT_OFFSETS.has(ap_id):
		return [bone_world_pos, bone_world_rot, bone_world_rot]
	var ap_data: Dictionary = ATTACH_POINT_OFFSETS[ap_id]
	var sl_pos: Vector3 = ap_data["pos"]
	var sl_euler: Vector3 = ap_data["rot"]
	var ap_pos_godot := Vector3(sl_pos.x, sl_pos.z, -sl_pos.y)
	var ap_rot_godot: Quaternion = _sl_euler_to_godot_quat(sl_euler.x, sl_euler.y, sl_euler.z)
	var ap_world_pos: Vector3 = bone_world_pos + bone_world_rot * ap_pos_godot
	var ap_world_rot: Quaternion = bone_world_rot * ap_rot_godot
	return [ap_world_pos, bone_world_rot, ap_world_rot]


## Convert SL Euler angles (roll, pitch, yaw in degrees, ZYX order) to a Godot quaternion.
## Matches LLQuaternion::setQuat(roll, pitch, yaw) used by the LL viewer for attachment point rotations.
func _sl_euler_to_godot_quat(roll_deg: float, pitch_deg: float, yaw_deg: float) -> Quaternion:
	if roll_deg == 0.0 and pitch_deg == 0.0 and yaw_deg == 0.0:
		return Quaternion.IDENTITY
	var r: float = deg_to_rad(roll_deg) * 0.5
	var p: float = deg_to_rad(pitch_deg) * 0.5
	var y: float = deg_to_rad(yaw_deg) * 0.5
	var sr := sin(r); var cr := cos(r)
	var sp := sin(p); var cp := cos(p)
	var sy := sin(y); var cy := cos(y)
	var sl_x: float = sr * cp * cy - cr * sp * sy
	var sl_y: float = cr * sp * cy + sr * cp * sy
	var sl_z: float = cr * cp * sy - sr * sp * cy
	var sl_w: float = cr * cp * cy + sr * sp * sy
	return Quaternion(sl_x, sl_z, -sl_y, sl_w).normalized()


## Get a bone's accumulated global rest position by walking the parent chain.
func _get_bone_global_rest_pos(skel: Skeleton3D, bi: int) -> Vector3:
	return _get_bone_global_rest_xf(skel, bi).origin


## Get a bone's accumulated global rest transform by walking the parent chain.
func _get_bone_global_rest_xf(skel: Skeleton3D, bi: int) -> Transform3D:
	var global_xf := Transform3D.IDENTITY
	var chain: Array[int] = []
	var cur: int = bi
	while cur >= 0:
		chain.append(cur)
		cur = skel.get_bone_parent(cur)
	chain.reverse()
	for idx: int in chain:
		global_xf = global_xf * skel.get_bone_rest(idx)
	return global_xf


## Apply joint position overrides from a GLB skeleton to the shared skeleton.
## Only overrides joints in override_joints list (from mesh extras.jointOverrides).
## Copies the GLB skeleton's local rest transform directly — the mesh-converter
## already set each override bone's local rest from the alt_inverse_bind_matrix.
## Using world→local conversion was wrong: if a DIFFERENT mesh had previously
## overridden an ancestor bone, the shared skeleton's parent chain would differ
## from the GLB's parent chain, producing incorrect local rests.
## Last mesh to set a bone wins (same as SL/Firestorm).
func _apply_joint_overrides(glb_skel: Skeleton3D, shared_skel: Skeleton3D, override_joints: Array) -> void:
	var override_count: int = 0
	for jname in override_joints:
		var glb_bi: int = glb_skel.find_bone(jname as String)
		var shared_bi: int = shared_skel.find_bone(jname as String)
		if glb_bi < 0 or shared_bi < 0:
			continue
		shared_skel.set_bone_rest(shared_bi, glb_skel.get_bone_rest(glb_bi))
		override_count += 1

	if override_count > 0:
		print("[JointOverride] Applied %d/%d bone overrides from GLB → shared skeleton" % [override_count, override_joints.size()])

## Convert a Basis to its rotation quaternion safely.
## Returns IDENTITY if the basis is degenerate (zero or near-zero columns from
## collision volume IBM scale amplification or failed matrix inversion in GLB export).
func _safe_basis_rotation(b: Basis) -> Quaternion:
	var on := b.orthonormalized()
	# orthonormalized() returns zero columns if input columns are zero-length.
	# det of a valid rotation matrix is 1; degenerate result is near 0.
	if absf(on.determinant()) < 0.5:
		return Quaternion.IDENTITY
	return on.get_rotation_quaternion()



## Evaluate SL animation on a skeleton using its own rest transforms.
## Computes SL world rotations from animation keyframes + skeleton rest poses,
## converts to Godot space, and derives per-bone pose rotations.
## Each skeleton is evaluated independently so its IBM-derived rest transforms
## stay consistent with the world rotations (avoids XML vs GLB rest mismatch).
func _evaluate_skeleton_animation(skeleton: Skeleton3D, sl_local_rot: Dictionary, sl_local_pos: Dictionary) -> void:
	# Lazy-init CV rest rotations cache
	if _sl_cv_rest_rotations.is_empty():
		_sl_cv_rest_rotations = sm.skeleton_builder.get_sl_rest_rotations()

	var sl_world: Dictionary = {}     # bone_idx -> Quaternion (SL space)
	var godot_world: Dictionary = {}  # bone_idx -> Quaternion (Godot space)
	var bone_animated: Dictionary = {}  # bone_idx -> bool

	for bi in range(skeleton.get_bone_count()):
		var bname: String = skeleton.get_bone_name(bi)
		var parent_bi: int = skeleton.get_bone_parent(bi)

		var has_rot: bool = sl_local_rot.has(bname)
		var has_pos: bool = sl_local_pos.has(bname)
		var has_cv_rest: bool = _sl_cv_rest_rotations.has(bname)
		var parent_was_animated: bool = bone_animated.get(parent_bi, false)

		# Only process bones that have animation data, CV rest rotation, or an animated ancestor
		if not has_rot and not has_pos and not has_cv_rest and not parent_was_animated:
			bone_animated[bi] = false
			continue  # No animation influence — leave at rest pose

		bone_animated[bi] = has_rot or has_pos or has_cv_rest or parent_was_animated

		# SL local rotation: from animation, or CV rest rotation if this is an
		# unanimated collision volume, or Identity for standard bones.
		# CV rest rotations are NOT in the Godot rest transforms (translation-only)
		# but must still participate in the SL rotation chain so children are correct.
		var q_sl_local: Quaternion
		if has_rot:
			q_sl_local = sl_local_rot[bname]
		elif has_cv_rest:
			q_sl_local = _sl_cv_rest_rotations[bname]
		else:
			q_sl_local = Quaternion.IDENTITY

		var q_sl_parent_world: Quaternion = sl_world.get(parent_bi, Quaternion.IDENTITY)
		var q_sl_world: Quaternion = q_sl_parent_world * q_sl_local
		sl_world[bi] = q_sl_world

		var q_godot_world := Quaternion(
			q_sl_world.x, q_sl_world.z, -q_sl_world.y, q_sl_world.w).normalized()
		godot_world[bi] = q_godot_world

		# Derive Godot pose rotation (rest basis is Identity, so just undo parent)
		var parent_godot_world: Quaternion = godot_world.get(parent_bi, Quaternion.IDENTITY)
		var pose_rot: Quaternion = (parent_godot_world.inverse() * q_godot_world).normalized()
		skeleton.set_bone_pose_rotation(bi, pose_rot)

		if has_pos:
			# SL position keyframes are ABSOLUTE joint positions (replace, not add).
			# Godot's pose position is additive on rest, so subtract rest origin
			# to convert: local_origin = rest_origin + (absolute - rest_origin) = absolute.
			var sl_pos: Vector3 = sl_local_pos[bname]
			var absolute_godot := Vector3(sl_pos.x, sl_pos.z, -sl_pos.y)
			var rest_origin: Vector3 = skeleton.get_bone_rest(bi).origin
			skeleton.set_bone_pose_position(bi, absolute_godot - rest_origin)

	# Compute and apply global pose overrides (same as marker code).
	# Godot's internal pose_global doesn't include rest transforms when we set
	# bone poses manually after the skeleton update step. Override with our own
	# correctly computed values so the skin pipeline uses them.
	var bone_globals: Array[Transform3D] = []
	bone_globals.resize(skeleton.get_bone_count())
	for bi in range(skeleton.get_bone_count()):
		var rest_xf: Transform3D = skeleton.get_bone_rest(bi)
		var pose_rot: Quaternion = skeleton.get_bone_pose_rotation(bi)
		var pose_pos: Vector3 = skeleton.get_bone_pose_position(bi)
		var local_xf: Transform3D = rest_xf * Transform3D(Basis(pose_rot), pose_pos)
		var parent_bi: int = skeleton.get_bone_parent(bi)
		if parent_bi >= 0:
			bone_globals[bi] = bone_globals[parent_bi] * local_xf
		else:
			bone_globals[bi] = local_xf
		skeleton.set_bone_global_pose_override(bi, bone_globals[bi], 1.0, true)


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
		sm.animesh_roots.erase(local_id)
		sm.animesh_shared_skeleton.erase(local_id)
		sm.animesh_pending_anims.erase(local_id)
		sm.animesh_worn_anims.erase(local_id)
		sm.bone_global_overrides.erase(local_id)
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
	var godot_rot := Quaternion.IDENTITY
	if msg.has("rotation"):
		godot_rot = sl_to_godot_quat(msg["rotation"])

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
			# Bone-tracked attachments need skeleton-relative positioning every frame,
			# even before animations load (rest pose has bone positions from XML).
			if sm.animesh_shared_skeleton.has(av_lid):
				_update_bone_attachments(av_lid, sm.animesh_shared_skeleton[av_lid])

		# Emit camera follow signal for self avatar
		if avatar_id == sm.self_avatar_id:
			sm.self_avatar_moved.emit(rsi.pos)


## Recursively reposition all children of a parent to follow it.
## Used for avatar attachments and their sub-linksets.
func _update_children_world_pos(parent_id: int, parent_pos: Vector3, parent_rot: Quaternion) -> void:
	if not sm.object_children.has(parent_id):
		return
	for child_id: int in sm.object_children[parent_id]:
		# Skip bone-tracked attachments — _update_bone_attachments handles them each frame
		if sm.attach_bone.has(child_id) and sm.animesh_roots.has(parent_id):
			continue
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
