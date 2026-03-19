extends RefCounted

## Avatar and object interpolation — velocity extrapolation, blend offsets, and child repositioning.

var sm  # scene_manager reference

# Interpolation constants
const AVATAR_MAX_INTERP_DIST: float = 10.0  # snap if further than this (meters)
const AVATAR_SLERP_SPEED: float = 15.0      # rotation slerp rate (per second)
const PHYSICS_TIMESTEP: float = 1.0 / 45.0
const INTERP_PHASE_OUT_TIME: float = 2.0  # Start fading extrapolation
const INTERP_MAX_TIME: float = 3.0        # Stop extrapolation entirely
const BLEND_TIME: float = 0.25            # Seconds to blend correction offset to zero
const BLEND_SNAP_DIST: float = 10.0       # Snap if correction exceeds this (meters)


func _init(scene_manager) -> void:
	sm = scene_manager


# ─── Avatar Interpolation ────────────────────────────

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

		# Self avatar: rotation is set directly by set_self_avatar_yaw() each frame
		# from the client's camera heading — don't fight it with a slerp toward
		# the stale server echo.  Matches Firestorm, which derives self rotation
		# from agent.getAtAxis() and ignores the server rotation for self.
		# Non-self avatars: slerp toward server rotation (no angular velocity).
		if avatar_id != sm.self_avatar_id:
			rsi.rot = rsi.rot.slerp(target_rot, clampf(AVATAR_SLERP_SPEED * delta, 0.0, 1.0))

		rsi.push_transform()

		# Sync avatar skeleton root Node3D with RSInstance position
		if sm.animesh_roots.has(avatar_id):
			var node: Node3D = sm.animesh_roots[avatar_id]
			if node and is_instance_valid(node):
				node.position = rsi.pos
				node.quaternion = rsi.rot
			# Update ALL attachment child RSInstance positions so they follow the avatar.
			# Rigged MeshInstance3Ds follow via scene tree, but their hidden RSIs and
			# any non-rigged attachments need explicit repositioning.
			_update_children_world_pos(avatar_id, rsi.pos, rsi.rot)
			# Bone-tracked attachments need skeleton-relative positioning every frame,
			# even before animations load (rest pose has bone positions from XML).
			if sm.animesh_shared_skeleton.has(avatar_id):
				sm.animation_mgr._update_bone_attachments(avatar_id, sm.animesh_shared_skeleton[avatar_id])

		# Emit camera follow signal for self avatar
		if avatar_id == sm.self_avatar_id:
			sm.self_avatar_moved.emit(rsi.pos)


# ─── Object Interpolation ────────────────────────────

## Smoothly move objects with velocity toward their targets each frame.
## Dead reckoning: advance the target by velocity each frame.
## Server updates correct the target position when they arrive.
func interpolate_objects(delta: float) -> void:
	# Firestorm-style: each frame, advance position by vel*dt + 0.5*accel*dt^2
	# Server updates reset pos/vel/accel. Server omits updates when object follows predicted path.
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

		# Blend offset decay (runs even when stationary)
		var blend_offset: Vector3 = target.get("blend_offset", Vector3.ZERO)
		var blend_time: float = target.get("blend_time", 0.0) + delta
		target["blend_time"] = blend_time
		var blend_frac := clampf(blend_time / BLEND_TIME, 0.0, 1.0)

		# Stop entirely after max time (but only if blend is also done)
		if age > INTERP_MAX_TIME:
			if blend_frac >= 1.0:
				to_remove.append(obj_uuid)
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
		# Recurse into grandchildren (attachment linksets)
		_update_children_world_pos(child_id, child_rsi.pos, child_rsi.rot)
