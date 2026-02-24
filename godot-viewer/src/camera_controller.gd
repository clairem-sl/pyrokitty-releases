extends Camera3D

## Third-person camera that follows the self avatar.
## A/D rotate the avatar, W/S walk forward/backward.
## Right-drag to orbit freely; camera springs back behind avatar on release.
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

var is_orbiting: bool = false  # True while right-drag is held

# Movement state
var move_forward: bool = false
var move_backward: bool = false
var turn_left: bool = false
var turn_right: bool = false
var jump: bool = false
var crouch: bool = false
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

	# Camera springs back behind avatar when not manually orbiting
	if not is_orbiting:
		var yaw_diff := angle_difference(yaw, avatar_yaw)
		yaw += yaw_diff * clamp(camera_return_speed * delta, 0.0, 1.0)

	_update_camera()

	# Poll key state
	var fwd := Input.is_key_pressed(KEY_W)
	var back := Input.is_key_pressed(KEY_S)
	var left := Input.is_key_pressed(KEY_A)
	var right := Input.is_key_pressed(KEY_D)
	var jmp := Input.is_key_pressed(KEY_E)
	var crch := Input.is_key_pressed(KEY_C)

	if fwd != move_forward or back != move_backward or left != turn_left or right != turn_right or jmp != jump or crch != crouch:
		move_forward = fwd
		move_backward = back
		turn_left = left
		turn_right = right
		jump = jmp
		crouch = crch
		move_dirty = true

	# Send movement updates
	send_timer -= delta
	if move_dirty and send_timer <= 0.0:
		_send_movement()
		move_dirty = false
		send_timer = 0.05


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			is_orbiting = mb.pressed

		if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance = max(min_distance, distance - zoom_speed * (distance * 0.1))
			_update_camera()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance = min(max_distance, distance + zoom_speed * (distance * 0.1))
			_update_camera()

	if event is InputEventMouseMotion and is_orbiting:
		var mm := event as InputEventMouseMotion
		yaw -= mm.relative.x * orbit_speed
		pitch -= mm.relative.y * orbit_speed
		pitch = clamp(pitch, -PI * 0.49, PI * 0.49)
		_update_camera()


func _update_camera() -> void:
	var offset := Vector3.ZERO
	offset.x = distance * cos(pitch) * sin(yaw)
	offset.y = distance * sin(pitch)
	offset.z = distance * cos(pitch) * cos(yaw)

	global_position = target_point + offset
	look_at(target_point, Vector3.UP)


func _send_movement() -> void:
	main_node.send_message({
		"type": "input_move",
		"forward": move_forward,
		"backward": move_backward,
		"jump": jump,
		"crouch": crouch,
		"yaw": avatar_yaw,
	})
