extends RefCounted

## Animation evaluation, skeleton posing, keyframe interpolation, and debug skeleton visualization.

var sm  # scene_manager reference

# Debug skeleton visualization (toggled via Ctrl+Shift+1)
var _debug_skeleton_visible: bool = false

# CV bone SL-space rest rotations — cached from skeleton_builder.
# Used as fallback for unanimated CV bones in animation evaluation.
var _sl_cv_rest_rotations: Dictionary = {}

# CV bone default SL-space scales — cached from skeleton_builder XML data.
# Used by _apply_global_pose_overrides for CV scale inheritance + volume morphs.
var _cv_default_scales: Dictionary = {}  # cvName -> Vector3 (SL space)

# Per-root previous SL local rotations for crossfade blending.
# When the winning animation for a joint changes, we slerp from the old
# rotation to the new one to avoid visual snapping (mimics Firestorm's
# ease-in/ease-out crossfade).
var _prev_sl_local_rot: Dictionary = {}  # root_id -> { joint_name -> Quaternion }
const _ANIM_BLEND_SPEED: float = 10.0  # ~0.2s to 95% convergence

# Skeleton evaluation runs at 30 Hz — the visual difference vs 72 Hz is
# negligible for humanoid motion and this halves the Skeleton3D API call
# budget on alternating frames.
const _ANIM_EVAL_INTERVAL: float = 1.0 / 30.0


func _init(scene_manager) -> void:
	sm = scene_manager


# ─── Animation Batch Handling ────────────────────────

## Handle animations_batch — bridge has collected ALL animation data for a root.
## Contains the full set of animations with their parsed keyframe data.
## Replaces the old object_animation + avatar_animation + animation_ready flow.
func handle_animations_batch(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	var msg_uuid: String = str(msg.get("uuid", ""))
	if not msg_uuid.is_empty() and local_id > 0:
		sm.object_uuid[local_id] = msg_uuid
	var animations: Dictionary = msg.get("animations", {})
	if sm.object_mgr._is_self_avatar(local_id):
		print("[SelfAvatar] animations_batch: localId=%d uuid=%s, %d animations, is_animesh_root=%s, has_shared_skel=%s" % [
			local_id, sm.object_mgr._uuid_short(local_id), animations.size(),
			str(sm.animesh_roots.has(local_id)),
			str(sm.animesh_shared_skeleton.has(local_id))])
	if local_id == 0:
		return

	# TAG 100
	# Empty batch = all animations stopped — clear eval state so old animation stops
	if animations.is_empty():
		var anim_root: int = sm.animesh_root_for.get(local_id, local_id)
		sm.animesh_pending_anims.erase(anim_root)
		sm.animesh_eval.erase(anim_root)
		_prev_sl_local_rot.erase(anim_root)
		# Reset skeleton to rest pose
		var shared_skel: Skeleton3D = sm.animesh_shared_skeleton.get(anim_root)
		if shared_skel != null:
			for bi in range(shared_skel.get_bone_count()):
				shared_skel.set_bone_pose_rotation(bi, Quaternion.IDENTITY)
				shared_skel.set_bone_pose_position(bi, Vector3.ZERO)
		if sm.object_mgr._is_self_avatar(local_id):
			print("[SelfAvatar] Animations cleared for localId=%d" % local_id)
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

	if sm.object_mgr._is_self_avatar(local_id) or sm.object_mgr._is_self_avatar(anim_root):
		print("[SelfAvatar] Animations batch received: localId=%d root=%d, %d animations [%s]" % [local_id, anim_root, anim_ids.size(), ", ".join(anim_ids.map(func(a: String) -> String: return a.substr(0, 8)))])

	# Trigger rebuild if shared skeleton exists for the root
	if sm.animesh_shared_skeleton.has(anim_root):
		_apply_pending_animations(anim_root)
	elif sm.object_mgr._is_self_avatar(anim_root):
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
		if sm.object_mgr._is_self_avatar(root_id):
			print("[SelfAvatar] _apply_pending root=%d uuid=%s: %d pending, 0 available, %d missing" % [root_id, sm.object_mgr._uuid_short(root_id), pending_anims.size(), missing])
		return
	if sm.object_mgr._is_self_avatar(root_id):
		print("[SelfAvatar] _apply_pending root=%d uuid=%s: %d available, %d missing, %d total joints" % [root_id, sm.object_mgr._uuid_short(root_id), available.size(), missing, available.reduce(func(acc: int, d: Dictionary): return acc + (d.get("joints", []) as Array).size(), 0)])

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

	# ─── Synthetic head_rot (Firestorm built-in, computed per-frame) ───
	# Inject a placeholder at MEDIUM_PRIORITY (1) so the priority system
	# correctly lets it win over pri-0 standing anims but lose to pri-2+
	# body animations.  Actual rotation values are computed per-frame in
	# process_animesh via compute_head_rot().
	var _hr_idx: int = available.size()
	var _hr_placeholder_key: Array = [{"time": 0.0, "value": [0.0, 0.0, 0.0]}]
	available.append({
		"uuid": HEAD_ROT_ANIM_UUID,
		"priority": HEAD_ROT_PRIORITY,
		"duration": 0.0,
		"loop": true,
		"loopInPoint": 0.0,
		"loopOutPoint": 0.0,
		"easeInTime": 0.0,
		"easeOutTime": 0.0,
		"joints": [
			{"name": "mHead", "priority": HEAD_ROT_PRIORITY, "rotationKeys": _hr_placeholder_key, "positionKeys": []},
			{"name": "mNeck", "priority": HEAD_ROT_PRIORITY, "rotationKeys": _hr_placeholder_key, "positionKeys": []},
			{"name": "mTorso", "priority": HEAD_ROT_PRIORITY, "rotationKeys": _hr_placeholder_key, "positionKeys": []},
		],
	})
	for _hr_jd: Dictionary in (available[_hr_idx] as Dictionary).get("joints", []):
		var _hr_jname: String = str(_hr_jd.get("name", ""))
		var _hr_jpri: int = HEAD_ROT_PRIORITY
		if (_hr_jd.get("rotationKeys", []) as Array).size() > 0:
			if not joint_best_rot.has(_hr_jname) or _hr_jpri >= joint_best_rot[_hr_jname]["priority"]:
				joint_best_rot[_hr_jname] = {"priority": _hr_jpri, "data_idx": _hr_idx, "joint_data": _hr_jd}

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

	if sm.object_mgr._is_self_avatar(root_id):
		print("[SelfAvatar] Animations applied: %d joints merged from %d animations" % [merged_joints.size(), available.size()])


# ─── Per-Frame Animation Processing ─────────────────

## Per-frame animesh animation evaluation.
## All meshes bind to the shared skeleton — one evaluation pass per avatar/animesh root.
## SL xform.cpp:80: mWorldRotation = mRotation * mParent->getWorldRotation()
## SL's operator*(a,b) = Hamilton(b*a), so this is Hamilton(parent * local).
## Godot uses standard Hamilton, so we write: world = parent * local.
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

		# ─── Per-frame head_rot computation ───
		# Replace placeholder keyframe values with computed "look forward" rotation
		# based on the current body animation state and head position offset.
		var _hr_active: bool = false
		for _hr_jn: String in ["mHead", "mNeck", "mTorso"]:
			if joints.has(_hr_jn) and str((joints[_hr_jn] as Dictionary).get("anim_uuid", "")) == HEAD_ROT_ANIM_UUID:
				_hr_active = true
				break
		if _hr_active:
			var _hr_skel: Skeleton3D = sm.animesh_shared_skeleton.get(root_id)
			if _hr_skel != null and is_instance_valid(_hr_skel):
				var _hr_scales: Dictionary = sm.bone_shape_scales.get(root_id, {})
				var hr_rotations: Dictionary = compute_head_rot(sl_local_rot, sl_local_pos, _hr_skel, _hr_scales)
				for _hr_jn2: String in hr_rotations:
					if joints.has(_hr_jn2) and str((joints[_hr_jn2] as Dictionary).get("anim_uuid", "")) == HEAD_ROT_ANIM_UUID:
						sl_local_rot[_hr_jn2] = hr_rotations[_hr_jn2]

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
		if shared_skel != null and is_instance_valid(shared_skel):
			_evaluate_skeleton_animation(shared_skel, sl_local_rot, sl_local_pos)
			_apply_global_pose_overrides(shared_skel, root_id)
			_update_bone_attachments(root_id, shared_skel)
			if _debug_skeleton_visible:
				_update_debug_bone_markers(shared_skel)


# ─── Global Pose Overrides ────────────────────────────

## Compute and apply global pose overrides for a skeleton.
## Called every frame for ALL skeletons so that skinning and attachments
## always see correct bone positions (not just rest).
##
## Two SL behaviors are applied here dynamically (matching xform.cpp):
## 1. PARENT SCALE on child position (xform.cpp:76):
##    child.worldPos = parent.worldRot * (child.localPos * parent.scale) + parent.worldPos
##    Scale does NOT cascade through rotation/basis — only affects child position.
## 2. BONE'S OWN SCALE in skinning matrix (xform.cpp:93):
##    worldMatrix.initAll(mScale, mWorldRotation, mWorldPosition)
##    Scale is included in the world matrix upper 3x3 for vertex deformation
##    but does NOT cascade to children's scale (SL: worldScale = localScale).
func _apply_global_pose_overrides(skeleton: Skeleton3D, root_id: int) -> void:
	var shape_scales: Dictionary = sm.bone_shape_scales.get(root_id, {})
	var bone_count: int = skeleton.get_bone_count()

	# Position+rotation chain (NO scale in basis) — used for child positioning
	var pos_globals: Array[Transform3D] = []
	pos_globals.resize(bone_count)

	for bi in range(bone_count):
		var rest_xf: Transform3D = skeleton.get_bone_rest(bi)
		var pose_rot: Quaternion = skeleton.get_bone_pose_rotation(bi)
		var pose_pos: Vector3 = skeleton.get_bone_pose_position(bi)
		var parent_bi: int = skeleton.get_bone_parent(bi)

		# Apply parent shape scale to this bone's rest position dynamically (xform.cpp:76)
		if parent_bi >= 0:
			var parent_name: String = skeleton.get_bone_name(parent_bi)
			if shape_scales.has(parent_name):
				rest_xf = _apply_parent_scale(rest_xf, shape_scales[parent_name])

		# Position+rotation chain (no scale in basis — prevents scale cascade)
		var local_xf: Transform3D = rest_xf * Transform3D(Basis(pose_rot), pose_pos)
		if parent_bi >= 0:
			pos_globals[bi] = pos_globals[parent_bi] * local_xf
		else:
			pos_globals[bi] = local_xf

		# Apply this bone's OWN shape scale to the skinning transform basis.
		# SL puts scale into the world matrix for vertex deformation but does NOT
		# cascade it to children (worldScale = localScale, not parent * local).
		#
		# Apply this bone's shape scale to the skinning transform basis.
		# Standard bones: use shape scale directly (default is 1,1,1 so scale IS deformation).
		# CV bones: IBM fixup already cancels the CV's default scale, so we need the
		# DEFORMATION RATIO (current/default), not the absolute scale.
		# Formula: deformation = parent_shape + vm_delta / cv_default (element-wise).
		# CVs use UPPER_CASE names; standard bones use mCamelCase.
		var bname: String = skeleton.get_bone_name(bi)
		var final_xf: Transform3D = pos_globals[bi]
		var is_cv: bool = bname == bname.to_upper() and not bname.begins_with("m")
		if not is_cv:
			# Standard bone: shape scale IS the deformation (default = 1,1,1)
			if shape_scales.has(bname):
				var bs: Vector3 = shape_scales[bname]
				var godot_scale := Vector3(bs.x, bs.z, bs.y)
				final_xf = Transform3D(
					pos_globals[bi].basis * Basis.from_scale(godot_scale),
					pos_globals[bi].origin
				)
		else:
			# CV bone: compute deformation ratio = (cv_default * parent_shape + vm_delta) / cv_default
			# = parent_shape + vm_delta / cv_default
			# This is needed because the IBM fixup cancels the CV's default scale.
			var cv_default: Vector3 = _get_cv_default_scale(bname)
			var deformation: Vector3 = Vector3.ONE
			# Inherit parent shape scale (same ratio as parent)
			if parent_bi >= 0:
				var parent_name: String = skeleton.get_bone_name(parent_bi)
				if shape_scales.has(parent_name):
					deformation = shape_scales[parent_name]
			# Add volume morph contribution: vm_delta / cv_default (element-wise)
			var vol_morphs: Dictionary = sm.cv_volume_morphs.get(root_id, {})
			if vol_morphs.has(bname):
				var vm: Dictionary = vol_morphs[bname]
				var vm_s: Array = vm.get("scale", [0, 0, 0])
				if cv_default.x > 0.0001:
					deformation.x += vm_s[0] / cv_default.x
				if cv_default.y > 0.0001:
					deformation.y += vm_s[1] / cv_default.y
				if cv_default.z > 0.0001:
					deformation.z += vm_s[2] / cv_default.z
			if deformation != Vector3.ONE:
				var godot_scale := Vector3(deformation.x, deformation.z, deformation.y)
				final_xf = Transform3D(
					pos_globals[bi].basis * Basis.from_scale(godot_scale),
					pos_globals[bi].origin
				)

		skeleton.set_bone_global_pose_override(bi, final_xf, 1.0, true)


# ─── Skeleton Evaluation ─────────────────────────────

## Evaluate SL animation on a skeleton using its own rest transforms.
## Computes SL world rotations from animation keyframes + skeleton rest poses,
## converts to Godot space, and derives per-bone pose rotations.
## Each skeleton is evaluated independently so its IBM-derived rest transforms
## stay consistent with the world rotations (avoids XML vs GLB rest mismatch).
func _evaluate_skeleton_animation(skeleton: Skeleton3D, sl_local_rot: Dictionary, sl_local_pos: Dictionary) -> void:
	# Lazy-init CV rest rotations cache
	if _sl_cv_rest_rotations.is_empty():
		_sl_cv_rest_rotations = sm.skeleton_builder.get_sl_rest_rotations()

	# TAG 100
	# Reset ROTATION poses to identity so bones not in the current animation set
	# return to rest rotation (prevents stale walking/standing rotations persisting).
	# POSITION poses are NOT reset — Firestorm's blendJointStates starts from the
	# joint's current position, so positions persist from previous animations.
	# This matches SL behavior where position-only "snap pose" animations (dur=0,
	# loop=false) set positions once and they stick even after the animation stops.
	for bi in range(skeleton.get_bone_count()):
		skeleton.set_bone_pose_rotation(bi, Quaternion.IDENTITY)

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

	# Global pose overrides are applied separately in _apply_global_pose_overrides,
	# called unconditionally for ALL skeletons every frame (not just during anim eval).


# ─── Bone Attachments ────────────────────────────────

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
		var chain: Array[int] = _bone_chain_to_root(shared_skel, bi)

		var shape_scales: Dictionary = sm.bone_shape_scales.get(root_id, {})
		var bone_global_xf := Transform3D.IDENTITY
		for idx: int in chain:
			var rest_xf: Transform3D = shared_skel.get_bone_rest(idx)
			var pose_rot: Quaternion = shared_skel.get_bone_pose_rotation(idx)
			var pose_pos: Vector3 = shared_skel.get_bone_pose_position(idx)
			var parent_idx: int = shared_skel.get_bone_parent(idx)
			if parent_idx >= 0:
				var parent_name: String = shared_skel.get_bone_name(parent_idx)
				if shape_scales.has(parent_name):
					rest_xf = _apply_parent_scale(rest_xf, shape_scales[parent_name])
			bone_global_xf = bone_global_xf * rest_xf * Transform3D(Basis(pose_rot), pose_pos)

		var bone_pos: Vector3 = bone_global_xf.origin
		var bone_rot: Quaternion = bone_global_xf.basis.orthonormalized().get_rotation_quaternion()

		# Debug: log once per child
		if not sm._attach_bone_logged.has(child_id):
			sm._attach_bone_logged[child_id] = true
			print("[AttachBone] child=%d bone=%s ap=%d root=%d" % [child_id, bone_name, sm.attach_point_id.get(child_id, 0), root_id])

		# Include skeleton's local offset (hover height) when computing world position
		var skel_offset: Vector3 = shared_skel.position
		var bone_world_pos: Vector3 = root_node.position + root_node.quaternion * (skel_offset + bone_pos)
		var bone_world_rot: Quaternion = root_node.quaternion * bone_rot
		var ap_id: int = sm.attach_point_id.get(child_id, 0)
		# Pass bone's shape scale so AP offset is scaled by parent bone (xform.cpp:76)
		var bone_scale: Vector3 = shape_scales.get(bone_name, Vector3.ONE)
		var ap_xf: Array = _get_ap_world_transform(ap_id, bone_world_pos, bone_world_rot, bone_scale)
		var offset_pos: Vector3 = sm.child_offset_pos.get(child_id, Vector3.ZERO)
		var offset_rot: Quaternion = sm.child_offset_rot.get(child_id, Quaternion.IDENTITY)
		child_rsi.pos = ap_xf[0] + ap_xf[2] * offset_pos
		child_rsi.rot = ap_xf[2] * offset_rot
		child_rsi.push_transform()
		sm.object_mgr._sync_animesh_transform(child_id, child_rsi)
		if sm.light_mgr.object_lights.has(child_id):
			sm.light_mgr.update_light_transform(child_id, child_rsi)
		if sm.object_children.has(child_id):
			sm.interp_mgr._update_children_world_pos(child_id, child_rsi.pos, child_rsi.rot)


## Compute the world transform of an attachment point given the bone's world transform.
## Returns [ap_world_pos, bone_world_rot, ap_world_rot].
## The AP is a child of the bone in SL's skeleton hierarchy, so its local position
## is scaled by the bone's shape scale (xform.cpp:76: child.localPos * parent.scale).
## bone_shape_scale is in SL space (sx, sy, sz).
func _get_ap_world_transform(ap_id: int, bone_world_pos: Vector3, bone_world_rot: Quaternion, bone_shape_scale: Vector3 = Vector3.ONE) -> Array:
	if ap_id <= 0 or not sm.object_mgr.ATTACH_POINT_OFFSETS.has(ap_id):
		return [bone_world_pos, bone_world_rot, bone_world_rot]
	var ap_data: Dictionary = sm.object_mgr.ATTACH_POINT_OFFSETS[ap_id]
	var sl_pos: Vector3 = ap_data["pos"]
	var sl_euler: Vector3 = ap_data["rot"]
	# Apply bone shape scale to AP offset in SL space (xform.cpp:76: child.localPos * parent.scale)
	var scaled_sl_pos := Vector3(sl_pos.x * bone_shape_scale.x, sl_pos.y * bone_shape_scale.y, sl_pos.z * bone_shape_scale.z)
	var ap_pos_godot := Vector3(scaled_sl_pos.x, scaled_sl_pos.z, -scaled_sl_pos.y)
	var ap_rot_godot: Quaternion = _sl_euler_to_godot_quat(sl_euler.x, sl_euler.y, sl_euler.z)
	var ap_world_pos: Vector3 = bone_world_pos + bone_world_rot * ap_pos_godot
	var ap_world_rot: Quaternion = bone_world_rot * ap_rot_godot
	return [ap_world_pos, bone_world_rot, ap_world_rot]


## Apply parent shape scale to a bone's rest position (SL xform.cpp:76).
## Modifies rest_xf.origin in-place. SL scale (sx,sy,sz) → Godot: gx*=sx, gy*=sz, gz*=sy.
static func _apply_parent_scale(rest_xf: Transform3D, parent_scale: Vector3) -> Transform3D:
	var o: Vector3 = rest_xf.origin
	rest_xf.origin = Vector3(o.x * parent_scale.x, o.y * parent_scale.z, o.z * parent_scale.y)
	return rest_xf


## Build a parent-to-root bone index chain (reversed to root-first order).
static func _bone_chain_to_root(skeleton: Skeleton3D, bi: int) -> Array[int]:
	var chain: Array[int] = []
	var cur: int = bi
	while cur >= 0:
		chain.append(cur)
		cur = skeleton.get_bone_parent(cur)
	chain.reverse()
	return chain


## Get the XML default scale for a collision volume bone (lazy-cached).
func _get_cv_default_scale(cv_name: String) -> Vector3:
	if _cv_default_scales.is_empty():
		# Build cache from skeleton builder bone data
		for bd: Dictionary in sm.skeleton_builder.get_bone_data():
			if bd.get("is_cv", false):
				_cv_default_scales[bd["name"]] = bd["scale"] as Vector3
	return _cv_default_scales.get(cv_name, Vector3.ONE)


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


# ─── Joint Overrides ─────────────────────────────────

## Get a bone's accumulated global rest position by walking the parent chain.
func _get_bone_global_rest_pos(skel: Skeleton3D, bi: int) -> Vector3:
	return _get_bone_global_rest_xf(skel, bi).origin


## Get a bone's accumulated global rest transform by walking the parent chain.
func _get_bone_global_rest_xf(skel: Skeleton3D, bi: int) -> Transform3D:
	var global_xf := Transform3D.IDENTITY
	var chain: Array[int] = _bone_chain_to_root(skel, bi)
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
## In SL, joint overrides REPLACE the shape-computed local position for that bone.
## Parent shape scale is applied dynamically each frame in _apply_global_pose_overrides
## (matching xform.cpp:76), NOT baked into the rest position. This keeps override rest
## consistent with GLB IBMs (both without parent scale), preventing skinning mismatch.
func _apply_joint_overrides(glb_skel: Skeleton3D, shared_skel: Skeleton3D, override_joints: Array, mesh_id: String) -> void:
	# Find the avatar root for priority tracking
	var avatar_root_id: int = -1
	for av_lid: int in sm.animesh_shared_skeleton:
		if sm.animesh_shared_skeleton[av_lid] == shared_skel:
			avatar_root_id = av_lid
			break

	var xml_bones: Array = sm.skeleton_builder.get_bone_data()
	var xml_parent: Dictionary = {}  # bone_name -> parent_name
	var xml_pos: Dictionary = {}     # bone_name -> Vector3 (SL space default position)
	for bd: Dictionary in xml_bones:
		xml_parent[bd["name"]] = bd.get("parent_name", "")
		xml_pos[bd["name"]] = bd["pos"] as Vector3

	# Override priority: lowest mesh UUID wins (matches SL's std::map<LLUUID> ordering).
	# Multiple meshes may override the same bone — only the lowest UUID's value is used.
	if not sm.bone_override_owner.has(avatar_root_id):
		sm.bone_override_owner[avatar_root_id] = {}
	var owners: Dictionary = sm.bone_override_owner[avatar_root_id]

	var override_count: int = 0
	var skipped_default: int = 0
	var skipped_priority: int = 0
	for jname in override_joints:
		var glb_bi: int = glb_skel.find_bone(jname as String)
		var shared_bi: int = shared_skel.find_bone(jname as String)
		if glb_bi < 0 or shared_bi < 0:
			continue
		var glb_rest: Transform3D = glb_skel.get_bone_rest(glb_bi)

		# Convert GLB rest (Godot space) to SL space for parent scale application
		var godot_pos: Vector3 = glb_rest.origin
		var sl_pos := Vector3(godot_pos.x, -godot_pos.z, godot_pos.y)

		# Skip overrides at default position (Firestorm: aboveJointPosThreshold, 0.1mm).
		var default_pos: Vector3 = xml_pos.get(jname as String, sl_pos)
		if (sl_pos - default_pos).length() < 0.0001:
			skipped_default += 1
			continue

		# Priority check: only apply if this mesh UUID is lower than the current owner.
		# SL uses std::map<LLUUID> which sorts by UUID — lowest wins.
		var bone_key: String = jname as String
		if owners.has(bone_key) and mesh_id >= owners[bone_key]:
			skipped_priority += 1
			continue
		owners[bone_key] = mesh_id

		# Parent scale NOT baked — applied dynamically in _apply_global_pose_overrides

		var final_godot := Vector3(sl_pos.x, sl_pos.z, -sl_pos.y)

		var new_rest := Transform3D()
		new_rest.origin = final_godot
		shared_skel.set_bone_rest(shared_bi, new_rest)
		override_count += 1

	if override_count > 0 or skipped_default > 0 or skipped_priority > 0:
		print("[JointOverride] mesh=%s applied=%d/%d (skipped: %d default, %d priority)" % [mesh_id.substr(0, 8), override_count, override_joints.size(), skipped_default, skipped_priority])

	# Recompute body size offset — mesh body overrides change hip/knee/ankle/head
	# rest positions which feed into the pelvisToFoot and bodyHeight formulas.
	# Only for avatars (not animesh objects which don't use body offset).
	if override_count > 0 and avatar_root_id > 0:
		var _avatar_uuid: String = str(sm.object_uuid.get(avatar_root_id, ""))
		if sm.avatar_local_ids.has(_avatar_uuid):
			sm.avatar_mgr._recompute_body_offset(avatar_root_id, shared_skel)

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


# ─── Keyframe Interpolation ──────────────────────────

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


# ─── Built-in head_rot Motion ────────────────────────

## Unique identifier for the synthetic head_rot animation.
const HEAD_ROT_ANIM_UUID: String = "_builtin_head_rot"
## Priority matches Firestorm's LLJoint::MEDIUM_PRIORITY.
const HEAD_ROT_PRIORITY: int = 1
## Firestorm constants for distributing rotation across joints.
const HEAD_ROT_TORSO_LAG: float = 0.35
const HEAD_ROT_NECK_LAG: float = 0.5
## Max rotation angle (Firestorm: F_PI_BY_TWO * 0.8 = ~72°)
const HEAD_ROT_MAX_ANGLE: float = 1.2566

## Compute head_rot joint rotations to face a target direction.
## Returns a Dictionary { "mTorso": Quaternion, "mNeck": Quaternion, "mHead": Quaternion }
## in SL local-rotation space.
##
## [param sl_local_rot] Current SL local rotations from animation evaluation.
## [param sl_local_pos] Current SL local positions from animation evaluation.
## [param skeleton] The shared Skeleton3D (used for bone rest positions).
## [param shape_scales] Per-bone shape scales (parent scale affects child position).
## [param target_sl] Target direction in SL world space from head position
##                   (default: null = "look forward" = compute direction from
##                   head position toward 2.5m in front of root, matching
##                   Firestorm's privacy-spoofed look-at target).
##
## The rotation compensates for body animation rotations in the
## pelvis→torso→chest→neck chain so the head faces the target regardless
## of what the body is doing (e.g. sitting, dancing).
func compute_head_rot(sl_local_rot: Dictionary, sl_local_pos: Dictionary, skeleton: Skeleton3D, shape_scales: Dictionary, target_sl: Variant = null) -> Dictionary:
	# Walk the pelvis→head chain accumulating SL world rotations AND positions.
	# SL standard bones have identity rest rotation, so:
	#   world_rot = parent_world_rot * anim_local_rot
	#   world_pos = parent_world_pos + parent_world_rot * rest_offset
	var chain: Array = ["mPelvis", "mTorso", "mChest", "mNeck", "mHead"]
	var world_rot: Dictionary = {}
	var world_pos: Dictionary = {}

	for ci in range(chain.size()):
		var cname: String = chain[ci]
		var local_rot: Quaternion = sl_local_rot.get(cname, Quaternion.IDENTITY)
		if ci == 0:
			world_rot[cname] = local_rot
			# Use animation position if available, else zero
			if sl_local_pos.has(cname):
				var p: Vector3 = sl_local_pos[cname]
				world_pos[cname] = Vector3(p.x, p.y, p.z)
			else:
				world_pos[cname] = Vector3.ZERO
		else:
			var pname: String = chain[ci - 1]
			world_rot[cname] = world_rot[pname] * local_rot
			# Get bone offset: use animation position if available, else rest offset
			var bone_offset := Vector3.ZERO
			if sl_local_pos.has(cname):
				bone_offset = sl_local_pos[cname]
			else:
				var bi: int = skeleton.find_bone(cname)
				if bi >= 0:
					var godot_rest: Vector3 = skeleton.get_bone_rest(bi).origin
					# Godot (x,z,-y) → SL (x,-z,y)
					bone_offset = Vector3(godot_rest.x, -godot_rest.z, godot_rest.y)
			# Apply parent shape scale to child offset (matches xform.cpp:76)
			var parent_scale: Vector3 = shape_scales.get(pname, Vector3.ONE)
			bone_offset *= parent_scale
			world_pos[cname] = world_pos[pname] + world_rot[pname] * bone_offset

	var pelvis_rot: Quaternion = world_rot["mPelvis"]
	var neck_world_rot: Quaternion = world_rot["mNeck"]
	var head_pos: Vector3 = world_pos["mHead"]

	# Compute look-at direction from head position.
	var look_dir: Vector3
	if target_sl != null:
		look_dir = (target_sl as Vector3).normalized()
	else:
		# Default: "look forward" = target is 2.5m in front of root.
		# Firestorm privacy-spoofed target: avatar_pos + rootRot * (2.5, 0, 0).
		# In root-local space, root forward is always +X regardless of pelvis
		# animation rotation (the pelvis sits UNDER the root).
		var target_pos := Vector3(2.5, 0.0, 0.0)  # root forward in root-local space
		look_dir = (target_pos - head_pos)
		if look_dir.length_squared() < 0.01:
			look_dir = Vector3(1.0, 0.0, 0.0)
		else:
			look_dir = look_dir.normalized()

	# Build rotation quaternion facing look_dir in root-local space.
	# SL: +X = forward, +Z = up.
	var root_up := Vector3(0.0, 0.0, 1.0)  # root-local up is just +Z
	var left: Vector3 = root_up.cross(look_dir)
	if left.length_squared() < 0.15:
		# Look direction nearly parallel to up — blend toward root forward
		var root_fwd2 := Vector3(1.0, 0.0, 0.0)
		look_dir = look_dir.lerp(root_fwd2, 0.4).normalized()
		left = root_up.cross(look_dir)
	left = left.normalized()
	var adjusted_up: Vector3 = look_dir.cross(left)
	# LL uses row-major (axes as rows), Godot Basis takes columns.
	# Transpose to match LL's quaternion-from-basis convention.
	var head_rot_local: Quaternion = Basis(look_dir, left, adjusted_up).transposed().get_rotation_quaternion()
	# head_rot_local is already in root-local space (we computed everything there)

	# Constrain to ±72°
	var angle: float = head_rot_local.get_angle()
	if angle > HEAD_ROT_MAX_ANGLE:
		head_rot_local = Quaternion.IDENTITY.slerp(head_rot_local, HEAD_ROT_MAX_ANGLE / angle)

	# Distribute torso portion (usually overridden by higher-pri body anims)
	var torso_rot: Quaternion = Quaternion.IDENTITY.slerp(head_rot_local, HEAD_ROT_TORSO_LAG)

	# Remove torso's contribution from the chain, split remainder between neck and head
	# (Matches Firestorm: head_rot_local *= ~torsoRotLocal, then split 50/50)
	var remaining: Quaternion = head_rot_local
	var neck_rot: Quaternion = Quaternion.IDENTITY.slerp(remaining, HEAD_ROT_NECK_LAG)
	var head_rot: Quaternion = Quaternion.IDENTITY.slerp(remaining, 1.0 - HEAD_ROT_NECK_LAG)

	return {"mTorso": torso_rot, "mNeck": neck_rot, "mHead": head_rot}


## Reconstruct SL quaternion from xyz components (w = sqrt(1 - x² - y² - z²), always >= 0)
func _sl_quat_from_xyz(x: float, y: float, z: float) -> Quaternion:
	var w_sq: float = 1.0 - x * x - y * y - z * z
	var w: float = sqrt(max(w_sq, 0.0))
	return Quaternion(x, y, z, w)


# ─── Debug Skeleton ──────────────────────────────────

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
		# Compute bone global transform (rest * pose + dynamic parent scale)
		var chain: Array[int] = _bone_chain_to_root(skel, bi)
		# Find root_id for shape scale lookup
		var dbg_root_id: int = 0
		for rid: int in sm.animesh_shared_skeleton:
			if sm.animesh_shared_skeleton[rid] == skel:
				dbg_root_id = rid
				break
		var dbg_shape_scales: Dictionary = sm.bone_shape_scales.get(dbg_root_id, {})
		var bone_xf := Transform3D.IDENTITY
		for idx: int in chain:
			var rest_xf: Transform3D = skel.get_bone_rest(idx)
			var pose_rot: Quaternion = skel.get_bone_pose_rotation(idx)
			var pose_pos: Vector3 = skel.get_bone_pose_position(idx)
			var parent_idx: int = skel.get_bone_parent(idx)
			if parent_idx >= 0:
				var parent_name: String = skel.get_bone_name(parent_idx)
				if dbg_shape_scales.has(parent_name):
					rest_xf = _apply_parent_scale(rest_xf, dbg_shape_scales[parent_name])
			bone_xf = bone_xf * rest_xf * Transform3D(Basis(pose_rot), pose_pos)
		child.global_position = (skel_global * bone_xf).origin
