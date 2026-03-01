extends Camera3D

## Third-person camera that follows the self avatar.
## A/D rotate the avatar, W/S walk forward/backward.
## Left-click avatar ("butt-grab") to rotate yaw + pitch by dragging.
## Scroll to zoom.
##
## In VR mode (set by main.gd), emits xr_pose_updated so xr_rig.gd can
## position the XROrigin3D at the avatar's eye level.

signal xr_pose_updated(avatar_pos: Vector3, avatar_yaw: float)

@export var orbit_speed: float = 0.005
@export var zoom_speed: float = 2.0
@export var min_distance: float = 2.0
@export var max_distance: float = 500.0
@export var follow_smoothing: float = 8.0
@export var turn_rate: float = 2.5        # Radians per second for A/D
@export var camera_return_speed: float = 4.0  # How fast camera springs back behind avatar

var default_pitch: float = 0.4     # Default camera elevation angle
var target_point: Vector3 = Vector3(128, 25, -128)
var avatar_point: Vector3 = Vector3(128, 25, -128)
var has_target: bool = false
var distance: float = 15.0
var yaw: float = 0.0         # Current camera yaw
var avatar_yaw: float = 0.0  # Avatar facing direction (Godot space)
var pitch: float = default_pitch

var is_butt_grabbing: bool = false  # True while left-drag on self avatar
var orbit_hold: bool = false       # True after butt-grab released, until movement key resets camera

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

# Shadow quality throttle: reduce cascade count + max distance while moving
var _shadow_moving: bool = false
var _shadow_stop_timer: float = 0.0
const SHADOW_STOP_DELAY: float = 0.4     # seconds after last key before restoring quality
const SHADOW_DIST_MOVING: float = 40.0   # max shadow distance while moving (m)
const SHADOW_DIST_STOPPED: float = 100.0 # max shadow distance at rest (m)

# VR mode flag — set by main.gd after OpenXR init
var vr_mode: bool = false
# Last values sent to XROrigin3D — only update when they change beyond threshold
# so the OpenXR reference space stays stable and ATW reprojection isn't invalidated
# every frame by floating-point noise.
var _last_xr_pos: Vector3 = Vector3(INF, INF, INF)
var _last_xr_yaw: float = INF
const XR_POS_THRESHOLD: float = 0.005   # 5 mm
const XR_YAW_THRESHOLD: float = 0.001  # ~0.06 degrees

@onready var main_node: Node3D = get_node("/root/Main")
@onready var scene_manager: Node3D = get_node("../SceneManager")

# Debug tooltip
var _tooltip_layer: CanvasLayer
var _tooltip_panel: PanelContainer
var _tooltip_label: RichTextLabel
var _tooltip_visible: bool = false
var _highlight_material: StandardMaterial3D
var _highlighted_rid: RID = RID()


func _ready() -> void:
	if scene_manager:
		scene_manager.self_avatar_moved.connect(_on_self_avatar_moved)
	_create_debug_tooltip()
	_update_camera()


## Called by main.gd when OpenXR successfully initialises.
func set_vr_mode(enabled: bool) -> void:
	vr_mode = enabled
	if enabled:
		self.current = false  # XRCamera3D takes over rendering
		# Apply stopped-quality shadows (4 cascades, 100m) as the baseline.
		# The movement throttle will still switch to cheap shadows while walking.
		# _set_shadow_quality(false)

		# In VR the keyboard movement throttle never fires (no W/A/S/D),
		# so fix shadows at a cheap level for the entire session.
		_set_shadow_quality_vr()
		
		# CanvasLayer renders to the viewport regardless of which Camera3D is
		# active. In stereo XR mode it can interfere with the compositor's
		# depth reprojection. Hide it — there's no mouse cursor in VR anyway.
		if _tooltip_layer:
			_tooltip_layer.visible = false


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

	# Camera springs back behind avatar when not butt-grabbing and not holding orbit
	if not is_butt_grabbing and not orbit_hold:
		var yaw_diff := angle_difference(yaw, avatar_yaw)
		yaw += yaw_diff * clamp(camera_return_speed * delta, 0.0, 1.0)

	_update_camera()

	# Continuously resend while any movement key is held (matches SL viewer behavior)
	if move_forward or move_backward or turn_left or turn_right \
		or strafe_left or strafe_right or jump or crouch:
		move_dirty = true

	# Shadow quality: drop to 2 cascades + shorter range while any key is held,
	# restore 0.4s after all keys release.
	var keys_held := move_forward or move_backward or turn_left or turn_right \
		or strafe_left or strafe_right
	if keys_held:
		_shadow_stop_timer = SHADOW_STOP_DELAY
		if not _shadow_moving:
			_shadow_moving = true
			_set_shadow_quality(true)
	elif _shadow_moving:
		_shadow_stop_timer -= delta
		if _shadow_stop_timer <= 0.0:
			_shadow_moving = false
			_set_shadow_quality(false)

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
			# Any movement key releases the orbit hold and resets pitch
			if orbit_hold and (move_forward or move_backward or turn_left \
				or turn_right or strafe_left or strafe_right):
				orbit_hold = false
				pitch = default_pitch
				_update_camera()

		# Escape dismisses tooltip first, then resets camera
		if ke.keycode == KEY_ESCAPE and ke.pressed and not ke.echo:
			if _tooltip_visible:
				_hide_debug_tooltip()
			elif orbit_hold or is_butt_grabbing:
				orbit_hold = false
				is_butt_grabbing = false
				pitch = default_pitch
				_update_camera()

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
				if _tooltip_visible:
					_hide_debug_tooltip()
				elif _is_click_on_self_avatar(mb.position):
					orbit_hold = false
					is_butt_grabbing = true
			else:
				if is_butt_grabbing:
					orbit_hold = true  # Hold camera angle until movement key pressed
				is_butt_grabbing = false

		if mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
			_handle_debug_pick(mb.position)

		if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			if _tooltip_visible:
				_hide_debug_tooltip()
			distance = max(min_distance, distance - zoom_speed * (distance * 0.1))
			_update_camera()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if _tooltip_visible:
				_hide_debug_tooltip()
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

	# Let the VR rig know where the avatar is so it can position the HMD origin.
	# Only emit when position or yaw actually changed — moving XROrigin3D every
	# frame (even to the same value) invalidates ATW's reprojection reference
	# space and causes black flicker on the Quest compositor.
	if vr_mode:
		var pos_delta := avatar_point.distance_to(_last_xr_pos)
		var yaw_delta := absf(avatar_yaw - _last_xr_yaw)
		if pos_delta > XR_POS_THRESHOLD or yaw_delta > XR_YAW_THRESHOLD:
			_last_xr_pos = avatar_point
			_last_xr_yaw = avatar_yaw
			xr_pose_updated.emit(avatar_point, avatar_yaw)


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


# ─── Debug Tooltip ──────────────────────────────────

func _create_debug_tooltip() -> void:
	# Translucent overlay material for highlighting picked objects
	_highlight_material = StandardMaterial3D.new()
	_highlight_material.albedo_color = Color(0.2, 0.8, 1.0, 0.3)
	_highlight_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_highlight_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_highlight_material.no_depth_test = true

	_tooltip_layer = CanvasLayer.new()
	_tooltip_layer.layer = 100
	add_child(_tooltip_layer)

	_tooltip_panel = PanelContainer.new()
	_tooltip_panel.visible = false
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.1, 0.1, 0.1, 0.85)
	style.corner_radius_top_left = 4
	style.corner_radius_top_right = 4
	style.corner_radius_bottom_left = 4
	style.corner_radius_bottom_right = 4
	style.content_margin_left = 8
	style.content_margin_right = 8
	style.content_margin_top = 6
	style.content_margin_bottom = 6
	_tooltip_panel.add_theme_stylebox_override("panel", style)
	_tooltip_layer.add_child(_tooltip_panel)

	_tooltip_label = RichTextLabel.new()
	_tooltip_label.bbcode_enabled = true
	_tooltip_label.fit_content = true
	_tooltip_label.scroll_active = false
	_tooltip_label.custom_minimum_size = Vector2(320, 0)
	_tooltip_label.add_theme_font_size_override("normal_font_size", 12)
	_tooltip_label.add_theme_font_size_override("bold_font_size", 12)
	_tooltip_panel.add_child(_tooltip_label)


func _handle_debug_pick(screen_pos: Vector2) -> void:
	if scene_manager == null:
		return
	var ray_from := project_ray_origin(screen_pos)
	var ray_dir := project_ray_normal(screen_pos)
	var hit: Dictionary = scene_manager.pick_object(ray_from, ray_dir)
	if hit.is_empty():
		_hide_debug_tooltip()
		return
	var local_id: int = hit["localId"]
	var dist: float = hit["distance"]
	# Highlight the picked object
	_clear_highlight()
	var rid: RID = scene_manager.get_object_rid(local_id)
	if rid.is_valid():
		RenderingServer.instance_geometry_set_material_overlay(rid, _highlight_material.get_rid())
		_highlighted_rid = rid
	var info: Dictionary = scene_manager.get_object_debug_info(local_id)
	var faces: Array = scene_manager.get_object_face_info(local_id)
	_show_debug_tooltip(screen_pos, dist, info, faces)


const _MAPPING_NAMES: Dictionary = { 0: "default", 2: "planar", 4: "spherical", 6: "cylindrical" }
const _ALPHA_NAMES: Dictionary = { -1: "auto", 0: "none", 1: "blend", 2: "mask", 3: "emissive" }

func _show_debug_tooltip(screen_pos: Vector2, dist: float, info: Dictionary, faces: Array) -> void:
	var bb := ""
	# Header
	bb += "[b]Object %d[/b]  (%.1fm)\n" % [info["localId"], dist]
	# Object info
	var p: Vector3 = info["pos"]
	var s: Vector3 = info["scl"]
	bb += "pos: (%.1f, %.1f, %.1f)  scl: (%.2f, %.2f, %.2f)\n" % [p.x, p.y, p.z, s.x, s.y, s.z]
	var mesh_id: String = info["meshId"]
	if not mesh_id.is_empty():
		bb += "mesh: %s\n" % mesh_id.substr(0, 8)
	var parent_id: int = info["parentId"]
	if parent_id > 0:
		bb += "parent: %d\n" % parent_id
	var surf_count: int = info["surfaceCount"]
	bb += "surfaces: %d  faces: %d\n" % [surf_count, faces.size()]

	# Per-face info (only show faces within actual surface count)
	for fi: Dictionary in faces:
		var idx: int = int(fi.get("faceIndex", fi.get("index", -1)))
		if surf_count > 0 and idx >= surf_count:
			continue
		var tid: String = str(fi.get("textureId", ""))
		var mt: int = int(fi.get("mappingType", 0))
		var uv: Dictionary = fi.get("uv", {})
		var color_raw = fi.get("color", [1.0, 1.0, 1.0, 1.0])
		var color_hex: String
		if color_raw is Array and color_raw.size() >= 3:
			var r := clampi(int(float(color_raw[0]) * 255), 0, 255)
			var g := clampi(int(float(color_raw[1]) * 255), 0, 255)
			var b := clampi(int(float(color_raw[2]) * 255), 0, 255)
			color_hex = "%02x%02x%02x" % [r, g, b]
		else:
			color_hex = str(color_raw)
		var am: int = int(fi.get("alphaMode", -1))
		var fb: bool = fi.get("fullBright", false)
		var ds: bool = fi.get("doubleSided", false)
		var is_pbr: bool = fi.get("isPBR", false)

		bb += "\n[b]Face %d[/b]  tex: [color=#aaaaff]%s[/color]\n" % [idx, tid.substr(0, 8) if tid.length() >= 8 else tid]
		bb += "  map: %s" % _MAPPING_NAMES.get(mt, str(mt))
		bb += "  rep: %.2f,%.2f" % [float(uv.get("repeatU", 1.0)), float(uv.get("repeatV", 1.0))]
		bb += "  off: %.2f,%.2f" % [float(uv.get("offsetU", 0.0)), float(uv.get("offsetV", 0.0))]
		var rot_val: float = float(uv.get("rotation", 0.0))
		if absf(rot_val) > 0.001:
			bb += "  rot: %.2f" % rot_val
		bb += "\n"
		bb += "  color: #%s  alpha: %s" % [color_hex, _ALPHA_NAMES.get(am, str(am))]
		if fb:
			bb += "  [color=#ffff88]fullBright[/color]"
		if ds:
			bb += "  [color=#88ffff]doubleSided[/color]"
		bb += "\n"

		# PBR section
		if is_pbr:
			var pbr: Dictionary = fi.get("pbr", {})
			bb += "  [color=#88ff88][b]PBR[/b][/color]"
			var nid: String = pbr.get("normalTextureId", "")
			var oid: String = pbr.get("ormTextureId", "")
			var eid: String = pbr.get("emissiveTextureId", "")
			if not nid.is_empty():
				bb += "  nrm: %s" % nid.substr(0, 8)
			if not oid.is_empty():
				bb += "  orm: %s" % oid.substr(0, 8)
			if not eid.is_empty():
				bb += "  emi: %s" % eid.substr(0, 8)
			var metallic: float = float(pbr.get("metallicFactor", 0.0))
			var roughness: float = float(pbr.get("roughnessFactor", 1.0))
			bb += "  met: %.2f  rgh: %.2f" % [metallic, roughness]
			var ef: Array = pbr.get("emissiveFactor", [])
			if ef.size() >= 3:
				bb += "  emF: (%.1f,%.1f,%.1f)" % [float(ef[0]), float(ef[1]), float(ef[2])]
			bb += "\n"

	_tooltip_label.text = bb
	_tooltip_panel.visible = true
	_tooltip_visible = true

	# Position near cursor, clamped to viewport (wait one frame for size)
	await get_tree().process_frame
	var vp_size := get_viewport().get_visible_rect().size
	var panel_size := _tooltip_panel.size
	var pos := screen_pos + Vector2(16, 16)
	pos.x = minf(pos.x, vp_size.x - panel_size.x - 8)
	pos.y = minf(pos.y, vp_size.y - panel_size.y - 8)
	pos.x = maxf(pos.x, 8)
	pos.y = maxf(pos.y, 8)
	_tooltip_panel.position = pos


func _clear_highlight() -> void:
	if _highlighted_rid.is_valid():
		RenderingServer.instance_geometry_set_material_overlay(_highlighted_rid, RID())
		_highlighted_rid = RID()


func _hide_debug_tooltip() -> void:
	_clear_highlight()
	_tooltip_panel.visible = false
	_tooltip_visible = false


func _set_shadow_quality(moving: bool) -> void:
	if vr_mode:
		return  # VR uses a fixed low setting — see _set_shadow_quality_vr()
	var light: DirectionalLight3D = get_node_or_null("/root/Main/DirectionalLight3D")
	if light == null:
		return
	if moving:
		light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
		light.directional_shadow_max_distance = SHADOW_DIST_MOVING
	else:
		light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
		light.directional_shadow_max_distance = SHADOW_DIST_STOPPED


func _set_shadow_quality_vr() -> void:
	# 2 cascades at 30m fits comfortably inside the 11ms Quest 3 frame budget.
	var light: DirectionalLight3D = get_node_or_null("/root/Main/DirectionalLight3D")
	if light == null:
		return
	light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	light.directional_shadow_max_distance = 30.0


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
