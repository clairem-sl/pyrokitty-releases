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

	var ray_origin: Vector3 = _right_controller.global_position
	var ray_dir: Vector3 = -_right_controller.global_transform.basis.z
	var sm = _camera_ctrl.scene_manager if _camera_ctrl else null

	# Aim the pick camera along the controller ray every frame so the ID buffer
	# viewport renders from the controller's perspective (no headset parallax).
	if sm:
		sm.object_picker.update_pick_camera_ray(ray_origin, ray_dir)

	# Throttle picks — hover uses cheap pick_object (ID buffer + bone distance),
	# detailed pick only runs on trigger press/drag (pick_object_detailed with CPU skinning).
	_pick_timer += delta
	if _pick_timer >= PICK_INTERVAL:
		_pick_timer = 0.0
		if sm:
			if sm.touch_mgr.is_grabbing():
				# Dragging — need full detail for UV/face updates
				_cached_hit = sm.pick_object_detailed(ray_origin, ray_dir)
				sm.touch_mgr.touch_move(_cached_hit)
			else:
				# Hovering — cheap ID + distance for beam/highlight
				_cached_hit = sm.pick_object(ray_origin, ray_dir)
				sm.object_picker.set_hover_highlight(_cached_hit["uuid"] if not _cached_hit.is_empty() else "")
		else:
			_cached_hit = {}
		_cached_beam_len = _cached_hit["distance"] if not _cached_hit.is_empty() else _laser_length

	_laser_dot.visible = false

	# Shorten laser beam to the hit distance so it doesn't poke through objects
	var beam: float = _cached_beam_len if not _cached_hit.is_empty() else _laser_length
	_laser_mesh.scale = Vector3(1.0, 1.0, beam)
	_laser_mesh.position = Vector3(0.0, 0.0, -beam * 0.5)
	_laser_mesh.visible = true


# ─── Input Handling ────────────────────────────────────────


var _trigger_held: bool = false
var _grip_held: bool = false

func _on_right_button_pressed(button_name: String) -> void:
	if button_name == "trigger_click":
		_trigger_held = true
	elif button_name == "grip_click":
		_grip_held = true
	# Either button activates the laser
	if not _laser_active and (_trigger_held or _grip_held):
		_laser_active = true
	# Both buttons together = touch
	if _trigger_held and _grip_held:
		_fire_touch_start()


func _on_right_button_released(button_name: String) -> void:
	if button_name == "trigger_click":
		_trigger_held = false
	elif button_name == "grip_click":
		_grip_held = false
	# Touch ends when either button is released
	var sm_rel = _camera_ctrl.scene_manager if _camera_ctrl else null
	if sm_rel and sm_rel.touch_mgr.is_grabbing() and not (_trigger_held and _grip_held):
		_fire_touch_end()
	# Laser off when both buttons released
	if not _trigger_held and not _grip_held:
		_laser_active = false


func _fire_touch_start() -> void:
	if not _right_controller:
		return
	var sm = _camera_ctrl.scene_manager if _camera_ctrl else null
	if not sm or sm.touch_mgr.is_grabbing():
		return
	var ray_origin: Vector3 = _right_controller.global_position
	var ray_dir: Vector3 = -_right_controller.global_transform.basis.z
	var hit: Dictionary = sm.pick_object_detailed(ray_origin, ray_dir)
	var uuid: String = sm.touch_mgr.touch_start(hit)
	if not uuid.is_empty():
		vr_object_picked.emit(hit)


func _fire_touch_end() -> void:
	var sm = _camera_ctrl.scene_manager if _camera_ctrl else null
	if not sm:
		return
	if _right_controller:
		var ray_origin: Vector3 = _right_controller.global_position
		var ray_dir: Vector3 = -_right_controller.global_transform.basis.z
		var hit: Dictionary = sm.pick_object_detailed(ray_origin, ray_dir)
		sm.touch_mgr.touch_end(hit)
	else:
		sm.touch_mgr.touch_end()


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
