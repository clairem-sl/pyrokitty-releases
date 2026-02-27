extends Camera3D

## Third-person camera that follows the self avatar.
## A/D rotate the avatar, W/S walk forward/backward.
## Left-click avatar ("butt-grab") to rotate yaw + pitch by dragging.
## Scroll to zoom.

@export var orbit_speed: float = 0.005
@export var zoom_speed: float = 2.0
@export var min_distance: float = 2.0
@export var max_distance: float = 500.0
@export var follow_smoothing: float = 8.0
@export var turn_rate: float = 2.5        # Radians per second for A/D
@export var camera_return_speed: float = 4.0  # How fast camera springs back behind avatar

var target_point: Vector3 = Vector3(128, 25, -128)
var avatar_point: Vector3 = Vector3(128, 25, -128)
var has_target: bool = false
var distance: float = 15.0
var yaw: float = 0.0         # Current camera yaw
var avatar_yaw: float = 0.0  # Avatar facing direction (Godot space)
var pitch: float = 0.4

var is_butt_grabbing: bool = false  # True while left-drag on self avatar
var pre_grab_pitch: float = 0.0    # Pitch before butt-grab started

# Movement state
var move_forward: bool = false
var move_backward: bool = false
var turn_left: bool = false
var turn_right: bool = false
var jump: bool = false
var crouch: bool = false
var strafe_left: bool = false
var strafe_right: bool = false
var flying: bool = false
var fly_toggled: bool = false  # True on the frame F is pressed
var always_run: bool = false
var double_tap_running: bool = false  # True after double-tap W, while W held
var last_w_press_time: float = -1.0
var move_dirty: bool = false
var send_timer: float = 0.0

@onready var main_node: Node3D = get_node("/root/Main")
@onready var scene_manager: Node3D = get_node("../SceneManager")


func _ready() -> void:
	if scene_manager:
		scene_manager.self_avatar_moved.connect(_on_self_avatar_moved)
	_update_camera()


func _on_self_avatar_moved(pos: Vector3) -> void:
	avatar_point = pos
	if not has_target:
		target_point = avatar_point
		has_target = true
		_update_camera()


func _process(delta: float) -> void:
	# Smooth position follow
	if has_target:
		target_point = target_point.lerp(avatar_point, clamp(follow_smoothing * delta, 0.0, 1.0))

	# A/D rotate the avatar
	if turn_left:
		avatar_yaw += turn_rate * delta
		move_dirty = true
	if turn_right:
		avatar_yaw -= turn_rate * delta
		move_dirty = true

	# Rotate self avatar box to match local yaw (instant feedback)
	if scene_manager:
		scene_manager.set_self_avatar_yaw(avatar_yaw)

	# Camera springs back behind avatar when not butt-grabbing
	if not is_butt_grabbing:
		var yaw_diff := angle_difference(yaw, avatar_yaw)
		yaw += yaw_diff * clamp(camera_return_speed * delta, 0.0, 1.0)

	_update_camera()

	# Continuously resend while any movement key is held (matches SL viewer behavior)
	if move_forward or move_backward or turn_left or turn_right \
		or strafe_left or strafe_right or jump or crouch:
		move_dirty = true

	# Send movement updates
	send_timer -= delta
	if move_dirty and send_timer <= 0.0:
		_send_movement()
		move_dirty = false
		send_timer = 0.05


# Raw key state tracked from events (never missed, even during slow frames)
var _key_w: bool = false
var _key_s: bool = false
var _key_a: bool = false
var _key_d: bool = false
var _key_shift: bool = false

func _input(event: InputEvent) -> void:
	if event is InputEventKey:
		var ke := event as InputEventKey

		# Track raw key state for movement
		match ke.keycode:
			KEY_W:
				_key_w = ke.pressed
				if ke.pressed and not ke.echo:
					var now := Time.get_ticks_msec() / 1000.0
					if now - last_w_press_time < 0.3:
						double_tap_running = true
					last_w_press_time = now
				if not ke.pressed:
					double_tap_running = false
			KEY_S:
				_key_s = ke.pressed
			KEY_A:
				_key_a = ke.pressed
			KEY_D:
				_key_d = ke.pressed
			KEY_E:
				jump = ke.pressed
			KEY_C:
				crouch = ke.pressed
			KEY_SHIFT:
				_key_shift = ke.pressed

		# Derive turn/strafe from A/D + shift
		var new_turn_left := _key_a and not _key_shift
		var new_turn_right := _key_d and not _key_shift
		var new_strafe_left := _key_a and _key_shift
		var new_strafe_right := _key_d and _key_shift

		if _key_w != move_forward or _key_s != move_backward \
			or new_turn_left != turn_left or new_turn_right != turn_right \
			or new_strafe_left != strafe_left or new_strafe_right != strafe_right:
			move_forward = _key_w
			move_backward = _key_s
			turn_left = new_turn_left
			turn_right = new_turn_right
			strafe_left = new_strafe_left
			strafe_right = new_strafe_right
			move_dirty = true

		# Toggle actions
		if ke.keycode == KEY_F and ke.pressed and not ke.echo:
			flying = not flying
			fly_toggled = true
			move_dirty = true
		if ke.keycode == KEY_R and ke.pressed and not ke.echo and Input.is_key_pressed(KEY_CTRL):
			always_run = not always_run
			move_dirty = true

	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				if _is_click_on_self_avatar(mb.position):
					pre_grab_pitch = pitch
					is_butt_grabbing = true
			else:
				if is_butt_grabbing:
					pitch = pre_grab_pitch
					_update_camera()
				is_butt_grabbing = false

		if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance = max(min_distance, distance - zoom_speed * (distance * 0.1))
			_update_camera()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance = min(max_distance, distance + zoom_speed * (distance * 0.1))
			_update_camera()

	if event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		if is_butt_grabbing:
			# Butt-grab: X rotates avatar yaw, Y adjusts camera pitch
			var yaw_delta := mm.relative.x * orbit_speed
			avatar_yaw -= yaw_delta
			yaw -= yaw_delta  # Camera follows avatar instantly
			pitch -= mm.relative.y * orbit_speed
			pitch = clamp(pitch, -PI * 0.49, PI * 0.49)
			move_dirty = true
			_update_camera()


func _update_camera() -> void:
	var offset := Vector3.ZERO
	offset.x = distance * cos(pitch) * sin(yaw)
	offset.y = distance * sin(pitch)
	offset.z = distance * cos(pitch) * cos(yaw)

	global_position = target_point + offset
	look_at(target_point, Vector3.UP)


## Check if a screen-space click hits the self avatar's mesh AABB
func _is_click_on_self_avatar(screen_pos: Vector2) -> bool:
	if scene_manager == null:
		return false
	var data: Dictionary = scene_manager.get_self_avatar_click_data()
	if data.is_empty():
		return false
	if is_position_behind(data["position"]):
		return false
	# Ray from camera through click position, tested against mesh AABB in local space
	var ray_from := project_ray_origin(screen_pos)
	var ray_dir := project_ray_normal(screen_pos)
	var inv: Transform3D = (data["transform"] as Transform3D).affine_inverse()
	var local_from := inv * ray_from
	var local_dir := (inv.basis * ray_dir).normalized()
	var aabb: AABB = (data["aabb"] as AABB).grow(0.3)  # slightly larger for easier clicking
	return aabb.intersects_ray(local_from, local_dir) != null


func _send_movement() -> void:
	var msg := {
		"type": "input_move",
		"forward": move_forward,
		"backward": move_backward,
		"strafe_left": strafe_left,
		"strafe_right": strafe_right,
		"jump": jump,
		"crouch": crouch,
		"running": always_run or double_tap_running,
		"yaw": avatar_yaw,
	}
	if fly_toggled:
		msg["fly"] = flying
		fly_toggled = false
	main_node.send_message(msg)
