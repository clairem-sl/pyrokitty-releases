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
@export var min_distance: float = 0.0
@export var max_distance: float = 500.0
@export var follow_smoothing: float = 8.0
@export var turn_rate: float = 1.5708     # Radians per second for A/D (90 deg/s, matching Firestorm)
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
var _dbg_was_moving: bool = false  # for movement freeze diagnostics
var _pending_cursor_pos: Vector2 = Vector2(-1, -1)  # queued mouse pos for cursor update
var _cursor_timer: float = 0.0

# ALT-orbit camera (SL-style focus orbit)
var is_alt_orbiting: bool = false  # True while ALT + left-drag
var alt_focus_hold: bool = false   # True after alt-orbit release, until movement/ESC
var alt_focus_point: Vector3 = Vector3.ZERO
var alt_yaw: float = 0.0
var alt_pitch: float = 0.4
var alt_distance: float = 10.0

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

# Inspector panel
var _stand_layer: CanvasLayer
var _stand_button: Button

var _tooltip_layer: CanvasLayer
var _tooltip_panel: PanelContainer
var _tooltip_tabs: TabContainer
var _general_label: RichTextLabel
var _name_edit: LineEdit
var _desc_edit: LineEdit
var _faces_label: RichTextLabel
var _tooltip_visible: bool = false
var _inspected_uuid: String = ""
var _dragging_panel: bool = false
var _drag_offset: Vector2 = Vector2.ZERO
var _highlight_material: StandardMaterial3D
var _highlighted_rid: RID = RID()


func _ready() -> void:
	if scene_manager:
		scene_manager.self_avatar_moved.connect(_on_self_avatar_moved)
		scene_manager.object_properties_received.connect(_on_object_properties_received)
	_create_stand_button()
	_create_debug_tooltip()
	_update_camera()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_WINDOW_FOCUS_OUT:
		# Window lost focus — release all keys so nothing stays stuck
		_key_w = false
		_key_s = false
		_key_a = false
		_key_d = false
		_key_e = false
		_key_c = false
		_key_shift = false
		if is_alt_orbiting:
			is_alt_orbiting = false
			alt_focus_hold = true
		var had_movement := move_forward or move_backward or turn_left \
			or turn_right or strafe_left or strafe_right or jump or crouch
		move_forward = false
		move_backward = false
		turn_left = false
		turn_right = false
		strafe_left = false
		strafe_right = false
		jump = false
		crouch = false
		double_tap_running = false
		if had_movement:
			move_dirty = true


## Called by main.gd when OpenXR successfully initialises.
func set_vr_mode(enabled: bool) -> void:
	vr_mode = enabled
	if enabled:
		self.current = false  # XRCamera3D takes over rendering
		# In VR the keyboard movement throttle never fires (no W/A/S/D),
		# so fix shadows at a cheap level for the entire session.
		_set_shadow_quality_vr()
		
		# CanvasLayer renders to the viewport regardless of which Camera3D is
		# active. In stereo XR mode it can interfere with the compositor's
		# depth reprojection. Hide it — there's no mouse cursor in VR anyway.
		if _tooltip_layer:
			_tooltip_layer.visible = false


func _on_self_avatar_moved(pos: Vector3) -> void:
	avatar_point = pos + Vector3(0.0, 0.8, 0.0)  # focus on upper chest, not feet
	if not has_target:
		target_point = avatar_point
		has_target = true
		_update_camera()


func _process(delta: float) -> void:
	# Smooth position follow
	if has_target and not is_alt_orbiting and not alt_focus_hold:
		target_point = target_point.lerp(avatar_point, clamp(follow_smoothing * delta, 0.0, 1.0))

	# A/D rotate the avatar (camera follows so it stays behind)
	if turn_left:
		var step := turn_rate * delta
		avatar_yaw += step
		yaw += step
		move_dirty = true
	if turn_right:
		var step := turn_rate * delta
		avatar_yaw -= step
		yaw -= step
		move_dirty = true

	# Rotate self avatar box to match local yaw (instant feedback)
	if scene_manager:
		scene_manager.set_self_avatar_yaw(avatar_yaw)

	# Camera springs back behind avatar when not butt-grabbing and not holding orbit
	if not is_butt_grabbing and not orbit_hold and not is_alt_orbiting and not alt_focus_hold:
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

	# Throttled cursor shape update (~10 Hz)
	_cursor_timer -= delta
	if _cursor_timer <= 0.0 and _pending_cursor_pos.x >= 0.0:
		_cursor_timer = 0.1
		if not is_butt_grabbing and not _dragging_panel and _is_click_on_self_avatar(_pending_cursor_pos, 0.0):
			Input.set_default_cursor_shape(Input.CURSOR_MOVE)
		else:
			Input.set_default_cursor_shape(Input.CURSOR_ARROW)


# Raw key state tracked from events (never missed, even during slow frames)
var _key_w: bool = false
var _key_s: bool = false
var _key_a: bool = false
var _key_d: bool = false
var _key_e: bool = false
var _key_c: bool = false
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
						move_dirty = true
						print("[CameraCtrl] Double-tap W → running")
					last_w_press_time = now
				if not ke.pressed:
					if double_tap_running:
						print("[CameraCtrl] W released → stopped running")
					double_tap_running = false
					move_dirty = true
			KEY_S:
				_key_s = ke.pressed
			KEY_A:
				_key_a = ke.pressed
			KEY_D:
				_key_d = ke.pressed
			KEY_E:
				_key_e = ke.pressed
			KEY_C:
				_key_c = ke.pressed
			KEY_SHIFT:
				_key_shift = ke.pressed

		# Derive turn/strafe from A/D + shift
		var new_turn_left := _key_a and not _key_shift
		var new_turn_right := _key_d and not _key_shift
		var new_strafe_left := _key_a and _key_shift
		var new_strafe_right := _key_d and _key_shift

		if _key_w != move_forward or _key_s != move_backward \
			or new_turn_left != turn_left or new_turn_right != turn_right \
			or new_strafe_left != strafe_left or new_strafe_right != strafe_right \
			or _key_e != jump or _key_c != crouch:
			move_forward = _key_w
			move_backward = _key_s
			turn_left = new_turn_left
			turn_right = new_turn_right
			strafe_left = new_strafe_left
			strafe_right = new_strafe_right
			jump = _key_e
			crouch = _key_c
			move_dirty = true
			# Any movement key releases the orbit hold and resets pitch
			if (orbit_hold or alt_focus_hold) and (move_forward or move_backward or turn_left \
				or turn_right or strafe_left or strafe_right):
				orbit_hold = false
				alt_focus_hold = false
				pitch = default_pitch
				_update_camera()

		# Escape dismisses tooltip first, then resets camera
		if ke.keycode == KEY_ESCAPE and ke.pressed and not ke.echo:
			if _tooltip_visible:
				_hide_debug_tooltip()
			elif is_alt_orbiting or alt_focus_hold:
				is_alt_orbiting = false
				alt_focus_hold = false
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
				pitch = default_pitch
				_update_camera()
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
			print("[CameraCtrl] Ctrl+R → always_run=%s" % always_run)
		# Ctrl+Alt+S or Alt+Shift+S: toggle ground sit / stand up (matches Firestorm)
		if ke.keycode == KEY_S and ke.pressed and not ke.echo:
			var ctrl := Input.is_key_pressed(KEY_CTRL)
			var alt := Input.is_key_pressed(KEY_ALT)
			var shift := Input.is_key_pressed(KEY_SHIFT)
			if (ctrl and alt) or (alt and shift):
				main_node.send_message({"type": "sit_or_stand"})

	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		# Confine mouse to window on any button press to prevent Godot's
		# broken OLE drag-and-drop from crashing other applications.
		if mb.pressed and mb.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]:
			if Input.mouse_mode == Input.MOUSE_MODE_VISIBLE:
				Input.mouse_mode = Input.MOUSE_MODE_CONFINED
		elif not mb.pressed and mb.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]:
			if not is_butt_grabbing and not is_alt_orbiting:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				if _tooltip_visible and _is_click_on_drag_bar(mb.position):
					_dragging_panel = true
					_drag_offset = mb.position - _tooltip_panel.global_position
				elif _tooltip_visible and not _is_click_on_panel(mb.position):
					_hide_debug_tooltip()
				elif not _tooltip_visible and Input.is_key_pressed(KEY_ALT):
					_start_alt_orbit(mb.position)
				elif not _tooltip_visible and _is_click_on_self_avatar(mb.position):
					orbit_hold = false
					is_butt_grabbing = true
					Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
				elif not _tooltip_visible:
					_handle_touch_pick(mb.position)
			else:
				_dragging_panel = false
				if is_alt_orbiting:
					alt_focus_hold = true
					is_alt_orbiting = false
					Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
				elif is_butt_grabbing:
					orbit_hold = true  # Hold camera angle until movement key pressed
					Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
				is_butt_grabbing = false

		if mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
			if not _is_click_on_panel(mb.position):
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
		if _dragging_panel:
			_tooltip_panel.global_position = mm.position - _drag_offset
		elif is_alt_orbiting:
			var ctrl_held := Input.is_key_pressed(KEY_CTRL)
			var shift_held := Input.is_key_pressed(KEY_SHIFT)
			if ctrl_held and shift_held:
				# Truck and pedestal — pan the focus point
				var cam_right := global_transform.basis.x
				var cam_up := global_transform.basis.y
				alt_focus_point += (-cam_right * mm.relative.x + cam_up * mm.relative.y) * alt_distance * 0.002
			elif ctrl_held:
				# Orbit: yaw from X, pitch from Y (inverted Y matches SL convention)
				alt_yaw -= mm.relative.x * orbit_speed
				alt_pitch += mm.relative.y * orbit_speed
				alt_pitch = clamp(alt_pitch, -PI * 0.49, PI * 0.49)
			else:
				# ALT only: yaw from X, zoom from Y
				alt_yaw -= mm.relative.x * orbit_speed
				alt_distance = clamp(alt_distance + mm.relative.y * alt_distance * 0.005, min_distance, max_distance)
			_update_camera()
		elif is_butt_grabbing:
			# Butt-grab: X rotates avatar yaw, Y adjusts camera pitch
			var yaw_delta := mm.relative.x * orbit_speed
			avatar_yaw -= yaw_delta
			yaw -= yaw_delta  # Camera follows avatar instantly
			pitch += mm.relative.y * orbit_speed
			pitch = clamp(pitch, -PI * 0.49, PI * 0.49)
			move_dirty = true
			_update_camera()
		else:
			# Update cursor shape based on what's under the mouse (throttled)
			_pending_cursor_pos = mm.position


func _start_alt_orbit(screen_pos: Vector2) -> void:
	var ray_from := project_ray_origin(screen_pos)
	var ray_dir := project_ray_normal(screen_pos)
	# Try object pick first
	var hit: Dictionary = scene_manager.pick_object(ray_from, ray_dir) if scene_manager else {}
	if not hit.is_empty():
		alt_focus_point = ray_from + ray_dir * hit["distance"]
	else:
		alt_focus_point = _ray_ground_intersect(ray_from, ray_dir)
	# Compute orbit params from current camera position relative to focus
	var delta_vec := global_position - alt_focus_point
	alt_distance = max(min_distance, delta_vec.length())
	alt_pitch = asin(clamp(delta_vec.y / alt_distance, -1.0, 1.0))
	alt_yaw = atan2(delta_vec.x, delta_vec.z)
	is_alt_orbiting = true
	alt_focus_hold = false
	orbit_hold = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _ray_ground_intersect(ray_origin: Vector3, ray_dir: Vector3) -> Vector3:
	var ground_y := avatar_point.y
	if abs(ray_dir.y) > 0.001:
		var t := (ground_y - ray_origin.y) / ray_dir.y
		if t > 0.0 and t < 500.0:
			return ray_origin + ray_dir * t
	return ray_origin + ray_dir * 50.0


func _update_camera() -> void:
	var focus: Vector3
	var cam_yaw: float
	var cam_pitch: float
	var cam_dist: float
	if is_alt_orbiting or alt_focus_hold:
		focus = alt_focus_point
		cam_yaw = alt_yaw
		cam_pitch = alt_pitch
		cam_dist = alt_distance
	else:
		focus = target_point
		cam_yaw = yaw
		cam_pitch = pitch
		cam_dist = distance

	var offset := Vector3.ZERO
	offset.x = cam_dist * cos(cam_pitch) * sin(cam_yaw)
	offset.y = cam_dist * sin(cam_pitch)
	offset.z = cam_dist * cos(cam_pitch) * cos(cam_yaw)

	global_position = focus + offset
	look_at(focus, Vector3.UP)

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


## Check if a screen-space click hits the self avatar's mesh AABB.
## grow_amount: extra padding in meters (0.3 for click forgiveness, 0.0 for cursor hover)
func _is_click_on_self_avatar(screen_pos: Vector2, grow_amount: float = 0.3) -> bool:
	if scene_manager == null:
		return false
	var data: Dictionary = scene_manager.get_self_avatar_click_data()
	if data.is_empty():
		return false
	if is_position_behind(data["position"]):
		return false
	var ray_from := project_ray_origin(screen_pos)
	var ray_dir := project_ray_normal(screen_pos)
	var inv: Transform3D = (data["transform"] as Transform3D).affine_inverse()
	var local_from := inv * ray_from
	var local_dir := (inv.basis * ray_dir).normalized()
	var aabb: AABB = (data["aabb"] as AABB).grow(grow_amount)
	return aabb.intersects_ray(local_from, local_dir) != null


# ─── Debug Tooltip ──────────────────────────────────

func _make_tab_label() -> RichTextLabel:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.selection_enabled = true
	label.context_menu_enabled = true
	label.custom_minimum_size = Vector2(340, 0)
	label.add_theme_font_size_override("normal_font_size", 12)
	label.add_theme_font_size_override("bold_font_size", 12)
	return label


func _create_stand_button() -> void:
	_stand_layer = CanvasLayer.new()
	_stand_layer.layer = 99
	add_child(_stand_layer)

	_stand_button = Button.new()
	_stand_button.text = "Stand Up"
	_stand_button.visible = false
	_stand_button.custom_minimum_size = Vector2(120, 36)
	# Anchor bottom-center, 20px above bottom edge
	_stand_button.anchor_left = 0.5
	_stand_button.anchor_right = 0.5
	_stand_button.anchor_top = 1.0
	_stand_button.anchor_bottom = 1.0
	_stand_button.offset_left = -60
	_stand_button.offset_right = 60
	_stand_button.offset_top = -56
	_stand_button.offset_bottom = -20

	var normal_style := StyleBoxFlat.new()
	normal_style.bg_color = Color(0.15, 0.15, 0.15, 0.90)
	normal_style.corner_radius_top_left = 4
	normal_style.corner_radius_top_right = 4
	normal_style.corner_radius_bottom_left = 4
	normal_style.corner_radius_bottom_right = 4
	var hover_style := normal_style.duplicate() as StyleBoxFlat
	hover_style.bg_color = Color(0.25, 0.25, 0.25, 0.95)
	var press_style := normal_style.duplicate() as StyleBoxFlat
	press_style.bg_color = Color(0.10, 0.10, 0.10, 0.95)
	_stand_button.add_theme_stylebox_override("normal", normal_style)
	_stand_button.add_theme_stylebox_override("hover", hover_style)
	_stand_button.add_theme_stylebox_override("pressed", press_style)
	_stand_button.add_theme_color_override("font_color", Color(1.0, 1.0, 1.0))
	_stand_button.add_theme_font_size_override("font_size", 14)
	_stand_button.pressed.connect(_on_stand_button_pressed)
	_stand_layer.add_child(_stand_button)


func set_sitting(sitting: bool) -> void:
	if _stand_button:
		_stand_button.visible = sitting


func _on_stand_button_pressed() -> void:
	main_node.send_message({"type": "stand_up"})


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

	var panel_vbox := VBoxContainer.new()
	panel_vbox.add_theme_constant_override("separation", 0)
	_tooltip_panel.add_child(panel_vbox)

	# Drag handle bar
	var drag_bar := Panel.new()
	drag_bar.custom_minimum_size = Vector2(0, 14)
	var drag_style := StyleBoxFlat.new()
	drag_style.bg_color = Color(0.25, 0.25, 0.25, 1.0)
	drag_style.corner_radius_top_left = 3
	drag_style.corner_radius_top_right = 3
	drag_bar.add_theme_stylebox_override("panel", drag_style)
	# Small centered grip indicator
	var grip := Label.new()
	grip.text = "· · ·"
	grip.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	grip.add_theme_font_size_override("font_size", 10)
	grip.add_theme_color_override("font_color", Color(0.5, 0.5, 0.5))
	drag_bar.add_child(grip)
	grip.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	# Close button
	var close_btn := Button.new()
	close_btn.text = "x"
	close_btn.flat = true
	close_btn.custom_minimum_size = Vector2(16, 14)
	close_btn.add_theme_font_size_override("font_size", 10)
	close_btn.add_theme_color_override("font_color", Color(0.6, 0.6, 0.6))
	close_btn.add_theme_color_override("font_hover_color", Color(1.0, 0.4, 0.4))
	close_btn.pressed.connect(_hide_debug_tooltip)
	drag_bar.add_child(close_btn)
	close_btn.set_anchors_and_offsets_preset(Control.PRESET_CENTER_RIGHT)
	panel_vbox.add_child(drag_bar)

	_tooltip_tabs = TabContainer.new()
	_tooltip_tabs.tab_alignment = TabBar.ALIGNMENT_LEFT
	# Style the tab bar to match the dark panel
	var tab_style := StyleBoxFlat.new()
	tab_style.bg_color = Color(0.18, 0.18, 0.18, 1.0)
	tab_style.content_margin_left = 8
	tab_style.content_margin_right = 8
	tab_style.content_margin_top = 4
	tab_style.content_margin_bottom = 4
	_tooltip_tabs.add_theme_stylebox_override("panel", tab_style)
	panel_vbox.add_child(_tooltip_tabs)

	var general_box := VBoxContainer.new()
	general_box.name = "General"

	# Editable name field
	var name_row := HBoxContainer.new()
	var name_lbl := Label.new()
	name_lbl.text = "Name:"
	name_lbl.custom_minimum_size = Vector2(40, 0)
	name_lbl.add_theme_font_size_override("font_size", 12)
	name_row.add_child(name_lbl)
	_name_edit = LineEdit.new()
	_name_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name_edit.add_theme_font_size_override("font_size", 12)
	_name_edit.text_submitted.connect(_on_name_submitted)
	name_row.add_child(_name_edit)
	general_box.add_child(name_row)

	# Editable description field
	var desc_row := HBoxContainer.new()
	var desc_lbl := Label.new()
	desc_lbl.text = "Desc:"
	desc_lbl.custom_minimum_size = Vector2(40, 0)
	desc_lbl.add_theme_font_size_override("font_size", 12)
	desc_row.add_child(desc_lbl)
	_desc_edit = LineEdit.new()
	_desc_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_desc_edit.add_theme_font_size_override("font_size", 12)
	_desc_edit.text_submitted.connect(_on_desc_submitted)
	desc_row.add_child(_desc_edit)
	general_box.add_child(desc_row)

	_general_label = _make_tab_label()
	general_box.add_child(_general_label)
	_tooltip_tabs.add_child(general_box)

	_faces_label = _make_tab_label()
	_faces_label.name = "Faces"
	_tooltip_tabs.add_child(_faces_label)


func _handle_debug_pick(screen_pos: Vector2) -> void:
	if scene_manager == null:
		return
	var ray_from := project_ray_origin(screen_pos)
	var ray_dir := project_ray_normal(screen_pos)
	var hit: Dictionary = scene_manager.pick_object(ray_from, ray_dir)
	if hit.is_empty():
		_hide_debug_tooltip()
		return
	var obj_uuid: String = hit["uuid"]
	var dist: float = hit["distance"]
	# Highlight the picked object
	_clear_highlight()
	var rid: RID = scene_manager.get_object_rid(obj_uuid)
	if rid.is_valid():
		RenderingServer.instance_geometry_set_material_overlay(rid, _highlight_material.get_rid())
		_highlighted_rid = rid
	var info: Dictionary = scene_manager.get_object_debug_info(obj_uuid)
	var faces: Array = scene_manager.get_object_face_info(obj_uuid)
	_show_debug_tooltip(screen_pos, dist, info, faces)
	# Request name/description from server (arrives async via object_properties_received)
	main_node.send_message({ "type": "request_object_properties", "uuid": obj_uuid })


func _handle_touch_pick(screen_pos: Vector2) -> void:
	if scene_manager == null:
		return
	var ray_from := project_ray_origin(screen_pos)
	var ray_dir := project_ray_normal(screen_pos)
	var hit: Dictionary = scene_manager.pick_object_detailed(ray_from, ray_dir)
	if hit.is_empty():
		return
	# Convert object-local vectors from Godot coords (Y-up) to SL coords (Z-up)
	# Godot (x, y, z) -> SL (x, z, -y)
	var pos_local: Vector3 = hit["hitPosLocal"]
	var norm: Vector3 = hit["normal"]
	var st: Vector2 = hit["st"]
	main_node.send_message({
		"type": "object_touch",
		"uuid": hit["uuid"],
		"faceIndex": hit["faceIndex"],
		"st": { "x": st.x, "y": st.y },
		"position": { "x": pos_local.x, "y": pos_local.z, "z": -pos_local.y },
		"normal": { "x": norm.x, "y": norm.z, "z": -norm.y },
	})


const _MAPPING_NAMES: Dictionary = { 0: "default", 2: "planar", 4: "spherical", 6: "cylindrical" }
const _ALPHA_NAMES: Dictionary = { -1: "auto", 0: "none", 1: "blend", 2: "mask", 3: "emissive" }

func _show_debug_tooltip(screen_pos: Vector2, dist: float, info: Dictionary, faces: Array) -> void:
	_inspected_uuid = str(info.get("uuid", ""))

	# ── General tab — editable fields (populated async via object_properties_received) ──
	var cached_name: String = info.get("name", "")
	var cached_desc: String = info.get("description", "")
	_name_edit.text = cached_name
	_name_edit.placeholder_text = "loading..." if cached_name.is_empty() else ""
	_desc_edit.text = cached_desc
	_desc_edit.placeholder_text = "loading..." if cached_desc.is_empty() else ""

	# ── General tab — read-only info ──
	var gb := ""
	var uuid: String = info.get("uuid", "")
	if not uuid.is_empty():
		gb += "uuid: [color=#aaaaff]%s[/color]\n" % uuid
	gb += "(%.1fm away)\n" % dist

	var parent_uuid: String = str(info.get("parentUuid", ""))
	if not parent_uuid.is_empty():
		gb += "parent: [color=#aaaaff]%s[/color]\n" % parent_uuid.substr(0, 8)

	var p: Vector3 = info["pos"]
	var r: Quaternion = info.get("rot", Quaternion.IDENTITY)
	var s: Vector3 = info["scl"]
	gb += "\npos: (%.2f, %.2f, %.2f)\n" % [p.x, p.y, p.z]
	gb += "rot: (%.3f, %.3f, %.3f, %.3f)\n" % [r.x, r.y, r.z, r.w]
	gb += "scl: (%.3f, %.3f, %.3f)\n" % [s.x, s.y, s.z]

	var mesh_id: String = info["meshId"]
	if not mesh_id.is_empty():
		gb += "\nmesh: [color=#aaaaff]%s[/color]\n" % mesh_id

	var surf_count: int = info["surfaceCount"]
	gb += "surfaces: %d  faces: %d\n" % [surf_count, faces.size()]

	_general_label.text = gb

	# ── Faces tab ──
	var fb := ""
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
			var rv := clampi(int(float(color_raw[0]) * 255), 0, 255)
			var gv := clampi(int(float(color_raw[1]) * 255), 0, 255)
			var bv := clampi(int(float(color_raw[2]) * 255), 0, 255)
			color_hex = "%02x%02x%02x" % [rv, gv, bv]
		else:
			color_hex = str(color_raw)
		var am: int = int(fi.get("alphaMode", -1))
		var full_bright: bool = fi.get("fullBright", false)
		var ds: bool = fi.get("doubleSided", false)
		var is_pbr: bool = fi.get("isPBR", false)

		fb += "[b]Face %d[/b]  tex: [color=#aaaaff]%s[/color]\n" % [idx, tid.substr(0, 8) if tid.length() >= 8 else tid]
		fb += "  map: %s" % _MAPPING_NAMES.get(mt, str(mt))
		fb += "  rep: %.2f,%.2f" % [float(uv.get("repeatU", 1.0)), float(uv.get("repeatV", 1.0))]
		fb += "  off: %.2f,%.2f" % [float(uv.get("offsetU", 0.0)), float(uv.get("offsetV", 0.0))]
		var rot_val: float = float(uv.get("rotation", 0.0))
		if absf(rot_val) > 0.001:
			fb += "  rot: %.2f" % rot_val
		fb += "\n"
		fb += "  color: #%s  alpha: %s" % [color_hex, _ALPHA_NAMES.get(am, str(am))]
		if full_bright:
			fb += "  [color=#ffff88]fullBright[/color]"
		if ds:
			fb += "  [color=#88ffff]doubleSided[/color]"
		fb += "\n"

		# PBR section
		if is_pbr:
			var pbr: Dictionary = fi.get("pbr", {})
			fb += "  [color=#88ff88][b]PBR[/b][/color]"
			var nid: String = pbr.get("normalTextureId", "")
			var oid: String = pbr.get("ormTextureId", "")
			var eid: String = pbr.get("emissiveTextureId", "")
			if not nid.is_empty():
				fb += "  nrm: %s" % nid.substr(0, 8)
			if not oid.is_empty():
				fb += "  orm: %s" % oid.substr(0, 8)
			if not eid.is_empty():
				fb += "  emi: %s" % eid.substr(0, 8)
			var metallic: float = float(pbr.get("metallicFactor", 0.0))
			var roughness: float = float(pbr.get("roughnessFactor", 1.0))
			fb += "  met: %.2f  rgh: %.2f" % [metallic, roughness]
			var ef: Array = pbr.get("emissiveFactor", [])
			if ef.size() >= 3:
				fb += "  emF: (%.1f,%.1f,%.1f)" % [float(ef[0]), float(ef[1]), float(ef[2])]
			fb += "\n"
		fb += "\n"

	if fb.is_empty():
		fb = "[i]No face data[/i]\n"
	_faces_label.text = fb

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


func _on_object_properties_received(uuid: String, obj_name: String, obj_desc: String) -> void:
	if uuid == _inspected_uuid and _tooltip_visible:
		_name_edit.text = obj_name
		_desc_edit.text = obj_desc


func _on_name_submitted(new_name: String) -> void:
	if _inspected_uuid.is_empty():
		return
	main_node.send_message({ "type": "set_object_name", "uuid": _inspected_uuid, "name": new_name })
	if scene_manager and scene_manager.object_meta.has(_inspected_uuid):
		scene_manager.object_meta[_inspected_uuid]["name"] = new_name
	_name_edit.release_focus()


func _on_desc_submitted(new_desc: String) -> void:
	if _inspected_uuid.is_empty():
		return
	main_node.send_message({ "type": "set_object_description", "uuid": _inspected_uuid, "description": new_desc })
	if scene_manager and scene_manager.object_meta.has(_inspected_uuid):
		scene_manager.object_meta[_inspected_uuid]["description"] = new_desc
	_desc_edit.release_focus()


func _is_click_on_panel(screen_pos: Vector2) -> bool:
	if not _tooltip_panel or not _tooltip_panel.visible:
		return false
	var rect := Rect2(_tooltip_panel.global_position, _tooltip_panel.size)
	return rect.has_point(screen_pos)


func _is_click_on_drag_bar(screen_pos: Vector2) -> bool:
	if not _tooltip_panel or not _tooltip_panel.visible:
		return false
	# Drag bar is the top 20px of the panel (14px bar + padding)
	var drag_rect := Rect2(_tooltip_panel.global_position, Vector2(_tooltip_panel.size.x, 20))
	return drag_rect.has_point(screen_pos)


func _clear_highlight() -> void:
	if _highlighted_rid.is_valid():
		RenderingServer.instance_geometry_set_material_overlay(_highlighted_rid, RID())
		_highlighted_rid = RID()


func _hide_debug_tooltip() -> void:
	_clear_highlight()
	_tooltip_panel.visible = false
	_tooltip_visible = false
	_inspected_uuid = ""
	_dragging_panel = false


func _set_shadow_quality_vr() -> void:
	# 2 cascades at 30m fits comfortably inside the 11ms Quest 3 frame budget.
	var light: DirectionalLight3D = get_node_or_null("/root/Main/DirectionalLight3D")
	if light == null:
		return
	light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	light.directional_shadow_max_distance = 30.0


func _send_movement() -> void:
	var is_moving := move_forward or move_backward or strafe_left or strafe_right \
		or turn_left or turn_right or jump or crouch
	if is_moving and not _dbg_was_moving:
		print("[CameraCtrl] Movement started fwd=%s back=%s sl=%s sr=%s tl=%s tr=%s j=%s c=%s" \
			% [move_forward, move_backward, strafe_left, strafe_right, turn_left, turn_right, jump, crouch])
		_dbg_was_moving = true
	elif not is_moving and _dbg_was_moving:
		print("[CameraCtrl] Movement stopped")
		_dbg_was_moving = false

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
