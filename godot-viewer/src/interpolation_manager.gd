extends RefCounted

## Avatar and object interpolation — velocity extrapolation + damping.
## Avatars and objects: server velocity extrapolation + exponential damping.
## Self avatar rotation is client-authoritative (set_self_avatar_yaw).

var sm  # scene_manager reference

# Interpolation constants
const PHYSICS_TIMESTEP: float = 1.0 / 45.0
const INTERP_PHASE_OUT_TIME: float = 2.0  # Start fading extrapolation
const INTERP_MAX_TIME: float = 3.0        # Stop extrapolation entirely

# Firestorm drawable-level damping (lldrawable.cpp OBJECT_DAMPING_TIME_CONSTANT)
# Applied as a second pass: the "object system" position is extrapolated from server
# velocity, then the "rendered" position lerps toward it each frame.  This low-pass
# filter smooths out discrete server updates without predicting ahead.
const DAMPING_TIME_CONSTANT: float = 0.06
# Pelvis lag — Firestorm slerps the avatar root rotation with u = dt / lag_time.
# Flying: 0.22s, Walking: 0.4s, Mouselook: 0.15s.  We use the walking value
# since we don't have mouselook and can refine flying later.
const PELVIS_LAG_TIME: float = 0.4


func _init(scene_manager) -> void:
	sm = scene_manager


## Firestorm-style exponential interpolant: 1 - pow(2, -dt / timeConstant)
## Matches LLSmoothInterpolation::getInterpolant / LLCriticalDamp::calcInterpolant.
func _damping_lerp(delta: float) -> float:
	return clampf(1.0 - pow(2.0, -delta / DAMPING_TIME_CONSTANT), 0.0, 1.0)


# ─── Avatar Interpolation ────────────────────────────

## Smoothly move all avatars toward their targets each frame.
## Server velocity extrapolation + exponential damping.
## Self avatar rotation is client-authoritative (set by set_self_avatar_yaw each frame).
func interpolate_avatars(delta: float) -> void:
	var lerp_amt := _damping_lerp(delta)

	for avatar_id: String in sm.avatar_targets:
		var rsi = sm.avatars.get(avatar_id)
		if rsi == null:
			continue

		var target: Dictionary = sm.avatar_targets[avatar_id]
		var vel: Vector3 = target.get("vel", Vector3.ZERO)
		var target_rot: Quaternion = target.get("rot", rsi.rot)

		var age: float = target.get("age", 0.0) + delta
		target["age"] = age

		# Extrapolate target position from server velocity
		if not vel.is_zero_approx() and age < INTERP_MAX_TIME:
			var phase_out := 1.0
			if age > INTERP_PHASE_OUT_TIME:
				phase_out = clampf((INTERP_MAX_TIME - age) / (INTERP_MAX_TIME - INTERP_PHASE_OUT_TIME), 0.0, 1.0)
			var pos_delta: Vector3 = vel * delta * phase_out
			target["pos"] = target.get("pos", rsi.pos) + pos_delta

		# Damped rendering
		var target_pos: Vector3 = target.get("pos", rsi.pos)
		rsi.pos = rsi.pos.lerp(target_pos, lerp_amt)

		# Self avatar: slerp toward client yaw (client-authoritative).
		# When seated, use server rotation (sit pose).
		# Non-self avatars: damp toward server rotation.
		if avatar_id == sm.self_avatar_id and not target.get("seated", false):
			# Pelvis lag: linear slerp matching Firestorm's updateCharacter
			var u: float = clampf(delta / PELVIS_LAG_TIME, 0.0, 1.0)
			rsi.rot = rsi.rot.slerp(sm.self_avatar_target_rot, u)
		else:
			rsi.rot = rsi.rot.slerp(target_rot, lerp_amt)

		rsi.push_transform()

		# Sync avatar skeleton root Node3D with RSInstance position
		if sm.animesh_roots.has(avatar_id):
			var node: Node3D = sm.animesh_roots[avatar_id]
			if node and is_instance_valid(node):
				node.position = rsi.pos
				node.quaternion = rsi.rot
			_update_children_world_pos(avatar_id, rsi.pos, rsi.rot)
			if sm.animesh_shared_skeleton.has(avatar_id):
				var cached_overrides: Dictionary = sm.animation_mgr._last_global_overrides.get(avatar_id, {})
				sm.animation_mgr._update_bone_attachments(avatar_id, sm.animesh_shared_skeleton[avatar_id], cached_overrides)

		# Emit camera follow signal for self avatar
		if avatar_id == sm.self_avatar_id:
			sm.self_avatar_moved.emit(rsi.pos)


# ─── Object Interpolation ────────────────────────────

## Smoothly move objects with velocity toward their targets each frame.
## Dead reckoning: advance the target by velocity each frame.
## Server updates correct the target position when they arrive.
func interpolate_objects(delta: float) -> void:
	var lerp_amt := _damping_lerp(delta)
	var to_remove: Array[String] = []
	for obj_uuid: String in sm.object_targets:
		var rsi = sm.objects.get(obj_uuid)
		if rsi == null:
			to_remove.append(obj_uuid)
			continue

		var target: Dictionary = sm.object_targets[obj_uuid]
		var vel: Vector3 = target.get("vel", Vector3.ZERO)
		var accel: Vector3 = target.get("accel", Vector3.ZERO)
		var ang_vel: Vector3 = target.get("angVel", Vector3.ZERO)

		var age: float = target.get("age", 0.0) + delta
		target["age"] = age

		if age > INTERP_MAX_TIME:
			to_remove.append(obj_uuid)
			continue

		# Phase out motion if no server update for a while
		var phase_out := 1.0
		if age > INTERP_PHASE_OUT_TIME:
			phase_out = clampf((INTERP_MAX_TIME - age) / (INTERP_MAX_TIME - INTERP_PHASE_OUT_TIME), 0.0, 1.0)

		# Layer 1: extrapolate target from server velocity/acceleration
		var stationary := vel.is_zero_approx() and accel.is_zero_approx() and ang_vel.is_zero_approx()
		if not stationary:
			var dt := delta
			var pos_delta: Vector3 = (vel + 0.5 * (dt - PHYSICS_TIMESTEP) * accel) * dt * phase_out
			target["pos"] = target.get("pos", rsi.pos) + pos_delta
			target["vel"] = vel + accel * dt * phase_out

			# Angular velocity: apply rotation delta
			var ang_speed := ang_vel.length()
			if ang_speed > 0.0001:
				var ang_axis := ang_vel / ang_speed
				var dq := Quaternion(ang_axis, ang_speed * dt * phase_out)
				rsi.rot = rsi.rot * dq

		# Layer 2: damped rendering (Firestorm's updateXform)
		var target_pos: Vector3 = target.get("pos", rsi.pos)
		rsi.pos = rsi.pos.lerp(target_pos, lerp_amt)

		rsi.push_transform()

		# Propagate to linkset children + lights
		if sm.object_children.has(obj_uuid):
			sm.object_mgr._update_children_transforms(obj_uuid)
		if sm.light_mgr.object_lights.has(obj_uuid):
			sm.light_mgr.update_light_transform(obj_uuid, rsi)
		sm.object_mgr._sync_animesh_transform(obj_uuid, rsi)

	for obj_uuid: String in to_remove:
		sm.object_targets.erase(obj_uuid)


# ─── Child Repositioning ─────────────────────────────

## Recursively reposition all children of a parent to follow it.
## Used for avatar attachments and their sub-linksets.
func _update_children_world_pos(parent_uuid: String, parent_pos: Vector3, parent_rot: Quaternion) -> void:
	if not sm.object_children.has(parent_uuid):
		return
	for child_id: String in sm.object_children[parent_uuid]:
		# Skip bone-tracked attachments — _update_bone_attachments handles them each frame
		if sm.attach_bone.has(child_id) and sm.animesh_roots.has(parent_uuid):
			continue
		var child_rsi = sm.objects.get(child_id)
		if child_rsi == null or not sm.child_offset_pos.has(child_id):
			continue
		child_rsi.pos = parent_pos + parent_rot * sm.child_offset_pos[child_id]
		child_rsi.rot = parent_rot * sm.child_offset_rot[child_id]
		child_rsi.push_transform()
		# Sync animesh root Node3D for child animesh objects (e.g. tail attached to avatar)
		sm.object_mgr._sync_animesh_transform(child_id, child_rsi)
		# Sync flexi prim root Node3D so Verlet simulation anchors to new position
		if sm.flexi_params.has(child_id):
			sm.flexi_mgr.UpdateTransform(child_id, child_rsi.pos, child_rsi.rot)
		# Recurse into grandchildren (attachment linksets)
		_update_children_world_pos(child_id, child_rsi.pos, child_rsi.rot)
