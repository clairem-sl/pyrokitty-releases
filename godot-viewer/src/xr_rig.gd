extends XROrigin3D

## VR rig: controllers, laser pointer, and locomotion.
##
## Left controller:  thumbstick = move (forward/back/strafe)
## Right controller: thumbstick = snap turn, trigger = interact (laser pointer)
##
## Receives xr_pose_updated(eye_pos, yaw) from camera_controller.gd to stay
## positioned at the avatar's eye height.

signal vr_object_picked(hit: Dictionary)

var _active: bool = false
var _camera_ctrl  # Camera3D (camera_controller.gd)
var _main_node: Node

# Controllers
var _left_controller: XRController3D
var _right_controller: XRController3D

# Laser pointer (right hand)
var _laser_mesh: MeshInstance3D
var _laser_material: StandardMaterial3D
var _laser_dot: MeshInstance3D  # hit marker
var _laser_length: float = 50.0
var _laser_active: bool = false

# Snap turn
const SNAP_TURN_DEGREES: float = 30.0
const THUMBSTICK_DEADZONE: float = 0.3
var _snap_turn_ready: bool = true  # prevents repeated turns while held


func activate(camera_ctrl: Camera3D) -> void:
	_active = true
	visible = true
	_camera_ctrl = camera_ctrl
	_main_node = camera_ctrl.get_parent()

	# Connect to camera_controller's signal for position updates
	if camera_ctrl.has_signal("xr_pose_updated"):
		camera_ctrl.xr_pose_updated.connect(_on_pose_updated)

	_create_controllers()
	_create_laser_pointer()


const TELEPORT_THRESHOLD: float = 2.0  # snap instantly above this distance
const LERP_SPEED: float = 8.0          # position smoothing (units/sec factor)

func _on_pose_updated(eye_pos: Vector3, yaw: float) -> void:
	if not _active:
		return
	var delta := eye_pos.distance_to(global_position)
	if delta > TELEPORT_THRESHOLD or delta == 0.0:
		global_position = eye_pos
	else:
		global_position = global_position.lerp(eye_pos, clamp(LERP_SPEED * get_process_delta_time(), 0.0, 1.0))
	rotation = Vector3(0.0, yaw, 0.0)


# ─── Controller Setup ────────────────────────────────────


func _create_controllers() -> void:
	_left_controller = XRController3D.new()
	_left_controller.name = "LeftController"
	_left_controller.tracker = "left_hand"
	add_child(_left_controller)

	_right_controller = XRController3D.new()
	_right_controller.name = "RightController"
	_right_controller.tracker = "right_hand"
	add_child(_right_controller)

	# Right controller: trigger = interact
	_right_controller.button_pressed.connect(_on_right_button_pressed)
	_right_controller.button_released.connect(_on_right_button_released)

	# Both controllers: thumbstick input
	_left_controller.input_vector2_changed.connect(_on_left_thumbstick)
	_right_controller.input_vector2_changed.connect(_on_right_thumbstick)


# ─── Laser Pointer ────────────────────────────────────────


func _create_laser_pointer() -> void:
	# Beam: thin box stretched along -Z (controller forward)
	# BoxMesh has zero intermediate vertices — no jagged wobble when moving
	_laser_mesh = MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.003, 0.003, 1.0)  # Z-length scaled dynamically
	_laser_mesh.mesh = box
	_laser_mesh.visible = false

	_laser_material = StandardMaterial3D.new()
	_laser_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_laser_material.albedo_color = Color(0.3, 0.7, 1.0, 0.8)
	_laser_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_laser_mesh.material_override = _laser_material

	_right_controller.add_child(_laser_mesh)

	# Hit dot: small sphere at intersection point
	_laser_dot = MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.015
	sphere.height = 0.03
	_laser_dot.mesh = sphere
	var dot_mat := StandardMaterial3D.new()
	dot_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	dot_mat.albedo_color = Color(1.0, 1.0, 1.0, 0.9)
	dot_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_laser_dot.material_override = dot_mat
	_laser_dot.visible = false
	# Dot is a child of the rig (not controller) so it stays at the hit point
	add_child(_laser_dot)


var _pick_timer: float = 0.0
var _cached_beam_len: float = 50.0
var _cached_hit: Dictionary = {}
const PICK_INTERVAL: float = 0.05  # pick every 50ms, not every frame

func _update_laser(delta: float) -> void:
	if not _right_controller or not _laser_active:
		_laser_mesh.visible = false
		_laser_dot.visible = false
		return

	# Throttle the expensive pick — reuse cached result between picks
	_pick_timer += delta
	if _pick_timer >= PICK_INTERVAL:
		_pick_timer = 0.0
		var ray_origin: Vector3 = _right_controller.global_position
		var ray_dir: Vector3 = -_right_controller.global_transform.basis.z
		var sm = _camera_ctrl.scene_manager if _camera_ctrl else null
		if sm:
			_cached_hit = sm.pick_object_detailed(ray_origin, ray_dir)
		else:
			_cached_hit = {}
		_cached_beam_len = _cached_hit["distance"] if not _cached_hit.is_empty() else _laser_length

	if not _cached_hit.is_empty():
		var ray_origin: Vector3 = _right_controller.global_position
		var ray_dir: Vector3 = -_right_controller.global_transform.basis.z
		_laser_dot.global_position = ray_origin + ray_dir * _cached_beam_len
		_laser_dot.visible = true
	else:
		_laser_dot.visible = false

	_laser_mesh.scale = Vector3(1.0, 1.0, _cached_beam_len)
	_laser_mesh.position = Vector3(0.0, 0.0, -_cached_beam_len * 0.5)
	_laser_mesh.visible = true


# ─── Input Handling ────────────────────────────────────────


func _on_right_button_pressed(button_name: String) -> void:
	if button_name == "trigger_click":
		_laser_active = true
	elif button_name == "grip_click":
		pass  # reserved for future secondary action


func _on_right_button_released(button_name: String) -> void:
	if button_name == "trigger_click":
		# Fire the pick on release (like mouse click)
		if _laser_active:
			_fire_laser_pick()
		_laser_active = false


func _fire_laser_pick() -> void:
	if not _right_controller:
		return
	var ray_origin: Vector3 = _right_controller.global_position
	var ray_dir: Vector3 = -_right_controller.global_transform.basis.z
	var sm = _camera_ctrl.scene_manager if _camera_ctrl else null
	if not sm:
		return
	var hit: Dictionary = sm.pick_object_detailed(ray_origin, ray_dir)
	if not hit.is_empty():
		# Route through action bar if available, matching desktop click flow
		if _camera_ctrl._action_bar:
			# Convert to a screen position for the action bar (it needs one for UI placement)
			# In VR mode, the 3D action bar will be used instead, but for now
			# we emit the signal so the system can handle it
			vr_object_picked.emit(hit)
			# Direct touch for now — the 3D action bar (Task #5) will replace this
			var pos_local: Vector3 = hit.get("hitPosLocal", Vector3.ZERO)
			var norm: Vector3 = hit.get("normal", Vector3.FORWARD)
			var st: Vector2 = hit.get("st", Vector2(0.5, 0.5))
			_main_node.send_message({
				"type": "object_touch",
				"uuid": hit["uuid"],
				"faceIndex": hit.get("faceIndex", 0),
				"st": { "x": st.x, "y": st.y },
				"position": { "x": pos_local.x, "y": pos_local.z, "z": -pos_local.y },
				"normal": { "x": norm.x, "y": norm.z, "z": -norm.y },
			})


func _on_left_thumbstick(action_name: String, value: Vector2) -> void:
	if action_name != "primary":
		return
	_camera_ctrl.strafe_left = value.x < -THUMBSTICK_DEADZONE
	_camera_ctrl.strafe_right = value.x > THUMBSTICK_DEADZONE
	_camera_ctrl.move_forward = value.y > THUMBSTICK_DEADZONE
	_camera_ctrl.move_backward = value.y < -THUMBSTICK_DEADZONE
	_camera_ctrl.move_dirty = true


func _on_right_thumbstick(action_name: String, value: Vector2) -> void:
	if action_name != "primary":
		return
	# Right stick X: snap turn — rotates the avatar, camera follows via pose update
	if abs(value.x) > THUMBSTICK_DEADZONE:
		if _snap_turn_ready:
			var turn_dir: float = sign(value.x)
			var snap_rad: float = deg_to_rad(turn_dir * SNAP_TURN_DEGREES)
			# Subtract: positive yaw = CCW in Godot, so -= turns CW (right)
			_camera_ctrl.avatar_yaw -= snap_rad
			_camera_ctrl.yaw -= snap_rad
			_camera_ctrl.move_dirty = true
			_snap_turn_ready = false
	else:
		_snap_turn_ready = true


# ─── Process ──────────────────────────────────────────────


func _process(delta: float) -> void:
	if not _active:
		return
	_update_laser(delta)
