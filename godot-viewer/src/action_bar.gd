extends RefCounted

## Object action bar — context-aware floating UI for object interactions.
## Shows available actions (Touch, Sit, Edit, etc.) based on object metadata.
##
## Two renderers:
##   - 2D: CanvasLayer overlay, projected from object world position (desktop)
##   - 3D: World-space panel (VR) — TODO, stubbed for now
##
## Selection model:
##   - Single tap on object → select + show action bar
##   - Double tap on same object → execute default action immediately
##   - Tap empty space or ESC → deselect

var sm  # scene_manager reference
var _camera: Camera3D
var _send_fn: Callable  # routes messages back to Electron over WebSocket
var _inspect_fn: Callable  # opens debug tooltip — set by camera_controller

# Selection state
var _selected_uuid: String = ""
var _selected_world_pos: Vector3 = Vector3.ZERO
var _selected_click_action: int = 0
var _selected_owner_id: String = ""
var _selected_prim_flags: int = 0

# Double-tap detection
var _last_tap_uuid: String = ""
var _last_tap_time: float = 0.0
const DOUBLE_TAP_WINDOW: float = 0.35  # seconds

# Highlight overlay
var _highlight_material: StandardMaterial3D
var _highlighted_rid: RID = RID()

# 2D overlay
var _canvas_layer: CanvasLayer
var _container: HBoxContainer
var _bar_panel: PanelContainer
var _buttons: Dictionary = {}  # action_name -> Button
var _visible: bool = false

# Pay dialog
var _pay_panel: PanelContainer
var _pay_vbox: VBoxContainer
var _pay_buttons_hbox: HBoxContainer
var _pay_custom_hbox: HBoxContainer
var _pay_amount_edit: LineEdit
var _pay_uuid: String = ""
var _pay_visible: bool = false
var _pay_status_label: Label

# SL ClickAction constants
const CLICK_ACTION_TOUCH: int = 0
const CLICK_ACTION_SIT: int = 1
const CLICK_ACTION_PAY: int = 2
const CLICK_ACTION_BUY: int = 3
const CLICK_ACTION_OPEN: int = 4

# SL PrimFlags (from PrimFlags enum — bit positions)
const PRIM_FLAG_SCRIPTED: int = 0x40     # Has a script
const PRIM_FLAG_TOUCH: int = 0x80        # Script handles touch events
const PRIM_FLAG_MONEY: int = 0x200       # Script handles money (payment) events
const PRIM_FLAG_YOU_OWNER: int = 0x20    # You own this object

# Action definitions: { name, label, icon_text, priority }
# Lower priority = further left in the bar
const ACTIONS: Array = [
	{ "name": "touch", "label": "Touch", "icon": "T", "priority": 0 },
	{ "name": "sit", "label": "Sit", "icon": "S", "priority": 1 },
	{ "name": "pay", "label": "Pay", "icon": "$", "priority": 2 },
	{ "name": "buy", "label": "Buy", "icon": "B", "priority": 3 },
	{ "name": "edit", "label": "Edit", "icon": "E", "priority": 10 },
	{ "name": "inspect", "label": "Inspect", "icon": "?", "priority": 11 },
]

const BAR_OFFSET_Y: float = -0.5  # meters above object center (negative = up in screen space after project)
const BAR_SCALE_REF_DIST: float = 5.0


func _init(scene_manager, camera: Camera3D, send_fn: Callable) -> void:
	sm = scene_manager
	_camera = camera
	_send_fn = send_fn
	_create_highlight_material()
	_create_2d_bar()
	_create_pay_dialog()


func _create_highlight_material() -> void:
	_highlight_material = StandardMaterial3D.new()
	_highlight_material.albedo_color = Color(0.3, 0.7, 1.0, 0.25)
	_highlight_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_highlight_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_highlight_material.no_depth_test = true


func _create_2d_bar() -> void:
	_canvas_layer = CanvasLayer.new()
	_canvas_layer.layer = 101  # above name bubbles (100), below stats (127)
	sm.add_child.call_deferred(_canvas_layer)

	_bar_panel = PanelContainer.new()
	_bar_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	_bar_panel.visible = false

	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.08, 0.08, 0.08, 0.92)
	panel_style.corner_radius_top_left = 6
	panel_style.corner_radius_top_right = 6
	panel_style.corner_radius_bottom_left = 6
	panel_style.corner_radius_bottom_right = 6
	panel_style.content_margin_left = 4
	panel_style.content_margin_right = 4
	panel_style.content_margin_top = 4
	panel_style.content_margin_bottom = 4
	_bar_panel.add_theme_stylebox_override("panel", panel_style)

	_container = HBoxContainer.new()
	_container.add_theme_constant_override("separation", 2)
	_bar_panel.add_child(_container)

	# Pre-create all buttons (hidden by default, shown per-context)
	for action: Dictionary in ACTIONS:
		var btn := _create_action_button(action["name"], action["label"], action["icon"])
		_buttons[action["name"]] = btn
		_container.add_child(btn)

	_canvas_layer.add_child(_bar_panel)


func _create_action_button(action_name: String, label: String, icon_text: String) -> Button:
	var btn := Button.new()
	btn.text = icon_text
	btn.tooltip_text = label
	btn.custom_minimum_size = Vector2(36, 36)
	btn.visible = false

	var normal_style := StyleBoxFlat.new()
	normal_style.bg_color = Color(0.20, 0.20, 0.22, 1.0)
	normal_style.corner_radius_top_left = 4
	normal_style.corner_radius_top_right = 4
	normal_style.corner_radius_bottom_left = 4
	normal_style.corner_radius_bottom_right = 4
	var hover_style := normal_style.duplicate() as StyleBoxFlat
	hover_style.bg_color = Color(0.35, 0.55, 0.80, 1.0)
	var press_style := normal_style.duplicate() as StyleBoxFlat
	press_style.bg_color = Color(0.15, 0.15, 0.17, 1.0)

	btn.add_theme_stylebox_override("normal", normal_style)
	btn.add_theme_stylebox_override("hover", hover_style)
	btn.add_theme_stylebox_override("pressed", press_style)
	btn.add_theme_color_override("font_color", Color(0.9, 0.9, 0.9))
	btn.add_theme_font_size_override("font_size", 14)

	btn.pressed.connect(_on_action_pressed.bind(action_name))
	return btn


func _create_pay_dialog() -> void:
	_pay_panel = PanelContainer.new()
	_pay_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	_pay_panel.visible = false

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.06, 0.06, 0.08, 0.95)
	style.corner_radius_top_left = 8
	style.corner_radius_top_right = 8
	style.corner_radius_bottom_left = 8
	style.corner_radius_bottom_right = 8
	style.content_margin_left = 10
	style.content_margin_right = 10
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	_pay_panel.add_theme_stylebox_override("panel", style)

	_pay_vbox = VBoxContainer.new()
	_pay_vbox.add_theme_constant_override("separation", 6)
	_pay_panel.add_child(_pay_vbox)

	# Title
	var title := Label.new()
	title.text = "Pay"
	title.add_theme_color_override("font_color", Color(0.9, 0.9, 0.9))
	title.add_theme_font_size_override("font_size", 14)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_pay_vbox.add_child(title)

	# Preset buttons row
	_pay_buttons_hbox = HBoxContainer.new()
	_pay_buttons_hbox.add_theme_constant_override("separation", 4)
	_pay_vbox.add_child(_pay_buttons_hbox)

	# Custom amount row
	_pay_custom_hbox = HBoxContainer.new()
	_pay_custom_hbox.add_theme_constant_override("separation", 4)
	_pay_vbox.add_child(_pay_custom_hbox)

	var lbl := Label.new()
	lbl.text = "L$"
	lbl.add_theme_color_override("font_color", Color(0.7, 0.7, 0.7))
	lbl.add_theme_font_size_override("font_size", 13)
	_pay_custom_hbox.add_child(lbl)

	_pay_amount_edit = LineEdit.new()
	_pay_amount_edit.custom_minimum_size = Vector2(80, 28)
	_pay_amount_edit.placeholder_text = "amount"
	_pay_amount_edit.add_theme_font_size_override("font_size", 13)
	_pay_amount_edit.text_submitted.connect(_on_pay_custom_submitted)
	_pay_custom_hbox.add_child(_pay_amount_edit)

	var pay_btn := Button.new()
	pay_btn.text = "Pay"
	pay_btn.custom_minimum_size = Vector2(48, 28)
	pay_btn.add_theme_font_size_override("font_size", 13)
	pay_btn.pressed.connect(_on_pay_custom_button)
	_pay_custom_hbox.add_child(pay_btn)

	# Status label (shows result)
	_pay_status_label = Label.new()
	_pay_status_label.add_theme_color_override("font_color", Color(0.6, 0.8, 0.6))
	_pay_status_label.add_theme_font_size_override("font_size", 12)
	_pay_status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_pay_status_label.visible = false
	_pay_vbox.add_child(_pay_status_label)

	_canvas_layer.add_child(_pay_panel)


func _make_pay_preset_button(amount: int) -> Button:
	var btn := Button.new()
	btn.text = "L$%d" % amount
	btn.custom_minimum_size = Vector2(60, 30)
	btn.add_theme_font_size_override("font_size", 13)

	var ns := StyleBoxFlat.new()
	ns.bg_color = Color(0.18, 0.30, 0.18, 1.0)
	ns.set_corner_radius_all(4)
	var hs := ns.duplicate() as StyleBoxFlat
	hs.bg_color = Color(0.25, 0.50, 0.25, 1.0)
	var ps := ns.duplicate() as StyleBoxFlat
	ps.bg_color = Color(0.12, 0.20, 0.12, 1.0)
	btn.add_theme_stylebox_override("normal", ns)
	btn.add_theme_stylebox_override("hover", hs)
	btn.add_theme_stylebox_override("pressed", ps)
	btn.add_theme_color_override("font_color", Color(0.9, 0.95, 0.9))

	btn.pressed.connect(_on_pay_preset.bind(amount))
	return btn


# ─── Public API ─────────────────────────────────────────


## Called by camera_controller on left-click. Returns true if handled (bar consumed click).
func handle_click(screen_pos: Vector2) -> bool:
	# Check if click is on the action bar itself
	if _visible and _bar_panel.get_global_rect().has_point(screen_pos):
		return true  # bar buttons handle their own pressed signals

	# Check if click is on the pay dialog
	if _pay_visible and _pay_panel.get_global_rect().has_point(screen_pos):
		return true

	# Raycast to find object
	var ray_from := _camera.project_ray_origin(screen_pos)
	var ray_dir := _camera.project_ray_normal(screen_pos)
	var hit: Dictionary = sm.pick_object_detailed(ray_from, ray_dir)

	if hit.is_empty():
		deselect()
		return false

	var obj_uuid: String = hit["uuid"]
	var now: float = Time.get_ticks_msec() / 1000.0

	# Double-tap detection: same object within window → execute default action
	if obj_uuid == _last_tap_uuid and (now - _last_tap_time) < DOUBLE_TAP_WINDOW:
		_last_tap_uuid = ""
		_last_tap_time = 0.0
		_execute_default_action(obj_uuid, hit)
		return true

	# Single tap → select at the click point (not object center)
	_last_tap_uuid = obj_uuid
	_last_tap_time = now
	var hit_dist: float = hit.get("distance", 0.0)
	if hit_dist > 0.0:
		hit["_world_hit_pos"] = ray_from + ray_dir * hit_dist
	_select_object(obj_uuid, hit)
	return true


## Deselect current object and hide action bar.
func deselect() -> void:
	if _selected_uuid.is_empty():
		return
	_clear_highlight()
	_selected_uuid = ""
	_hide_bar()
	_hide_pay_dialog()
	_last_tap_uuid = ""
	_last_tap_time = 0.0


## Called every frame from camera_controller._process().
func process(delta: float) -> void:
	if not _visible or _selected_uuid.is_empty():
		return
	# Check that the selected object still exists (don't overwrite click position)
	if not sm.objects.has(_selected_uuid):
		# Object was deleted
		deselect()
		return
	_update_bar_position()


## Returns true if the action bar is currently visible (for input priority).
func is_active() -> bool:
	return _visible


## Returns the currently selected object UUID (empty if none).
func get_selected_uuid() -> String:
	return _selected_uuid


# ─── Selection Logic ────────────────────────────────────


func _select_object(obj_uuid: String, hit: Dictionary) -> void:
	# Deselect previous
	if not _selected_uuid.is_empty() and _selected_uuid != obj_uuid:
		_clear_highlight()

	_selected_uuid = obj_uuid

	# Read metadata
	var meta: Dictionary = sm.object_meta.get(obj_uuid, {})
	_selected_click_action = int(meta.get("clickAction", 0))
	_selected_owner_id = str(meta.get("ownerID", ""))
	_selected_prim_flags = int(meta.get("primFlags", 0))

	# Position bar at the click point if available, otherwise object center
	if hit.has("_world_hit_pos"):
		_selected_world_pos = hit["_world_hit_pos"]
	elif sm.objects.has(obj_uuid):
		_selected_world_pos = sm.objects[obj_uuid].pos

	# Highlight
	_apply_highlight(obj_uuid)

	# Filter and show actions
	var actions := _get_available_actions(obj_uuid)
	_show_bar(actions)
	_update_bar_position()

	# Request name/description for future use
	_send_fn.call({ "type": "request_object_properties", "uuid": obj_uuid })


func _get_available_actions(_obj_uuid: String) -> Array:
	var result: Array = []
	var flags: int = _selected_prim_flags
	var has_touch: bool = (flags & PRIM_FLAG_TOUCH) != 0
	var has_money: bool = (flags & PRIM_FLAG_MONEY) != 0
	# Server sets PRIM_FLAG_YOU_OWNER per-viewer, but ownerID comparison is a reliable fallback
	var is_mine: bool = (flags & PRIM_FLAG_YOU_OWNER) != 0 \
		or (_selected_owner_id == sm.self_avatar_id and not _selected_owner_id.is_empty())

	# Touch — only if object has a touch handler in script
	if has_touch:
		result.append("touch")

	# Sit — always available (you can attempt to sit on any object)
	result.append("sit")

	# Pay — only if object accepts money (FLAGS_TAKES_MONEY / script has money() event)
	if has_money:
		result.append("pay")

	# Buy — show if ClickAction is Buy (object is for sale)
	if _selected_click_action == CLICK_ACTION_BUY:
		result.append("buy")

	# Edit — only if we own it
	if is_mine:
		result.append("edit")

	# Inspect — always available (debug info)
	result.append("inspect")

	return result


func _execute_default_action(obj_uuid: String, hit: Dictionary) -> void:
	var meta: Dictionary = sm.object_meta.get(obj_uuid, {})
	var click_action: int = int(meta.get("clickAction", 0))
	var flags: int = int(meta.get("primFlags", 0))

	match click_action:
		CLICK_ACTION_SIT:
			_send_fn.call({ "type": "object_sit", "uuid": obj_uuid })
		CLICK_ACTION_PAY:
			_send_fn.call({ "type": "object_pay", "uuid": obj_uuid })
		CLICK_ACTION_BUY:
			_send_fn.call({ "type": "object_buy", "uuid": obj_uuid })
		_:
			# Default: touch if object handles touch, otherwise just select (no-op)
			if (flags & PRIM_FLAG_TOUCH) != 0:
				_send_touch(obj_uuid, hit)
			# If no touch handler, double-tap just keeps it selected (bar stays visible)


# ─── Action Dispatch ────────────��───────────────────────


func _on_action_pressed(action_name: String) -> void:
	if _selected_uuid.is_empty():
		return

	match action_name:
		"touch":
			sm.touch_mgr.touch_instant({
				"uuid": _selected_uuid, "faceIndex": 0, "st": Vector2(0.5, 0.5),
				"normal": Vector3.FORWARD, "hitPosLocal": Vector3.ZERO,
			})
		"sit":
			_send_fn.call({ "type": "object_sit", "uuid": _selected_uuid })
		"pay":
			_send_fn.call({ "type": "object_pay", "uuid": _selected_uuid })
		"buy":
			_send_fn.call({ "type": "object_buy", "uuid": _selected_uuid })
		"edit":
			_send_fn.call({ "type": "object_edit", "uuid": _selected_uuid })
		"inspect":
			if _inspect_fn.is_valid():
				_inspect_fn.call(_selected_uuid)

	# Deselect after action (except inspect/edit/pay which keep selection)
	if action_name not in ["inspect", "edit", "pay"]:
		deselect()


func _send_touch(obj_uuid: String, hit: Dictionary) -> void:
	hit["uuid"] = obj_uuid
	sm.touch_mgr.touch_instant(hit)


# ─── Highlight ───────────��──────────────────────────────


func _apply_highlight(obj_uuid: String) -> void:
	_clear_highlight()
	var rid: RID = sm.get_object_rid(obj_uuid)
	if rid.is_valid():
		RenderingServer.instance_geometry_set_material_overlay(rid, _highlight_material.get_rid())
		_highlighted_rid = rid


func _clear_highlight() -> void:
	if _highlighted_rid.is_valid():
		RenderingServer.instance_geometry_set_material_overlay(_highlighted_rid, RID())
		_highlighted_rid = RID()


# ─── 2D Bar Rendering ──────────��───────────────────────


func _show_bar(actions: Array) -> void:
	# Show/hide buttons based on available actions
	for action_name: String in _buttons:
		var btn: Button = _buttons[action_name]
		btn.visible = action_name in actions
	_bar_panel.visible = true
	_visible = true


func _hide_bar() -> void:
	_bar_panel.visible = false
	_visible = false


func _update_bar_position() -> void:
	if not _visible or _camera == null:
		return
	# Project object world position to screen
	if _camera.is_position_behind(_selected_world_pos):
		_bar_panel.visible = false
		return
	_bar_panel.visible = true

	var screen_pos: Vector2 = _camera.unproject_position(_selected_world_pos)
	var dist: float = _camera.global_position.distance_to(_selected_world_pos)

	# Scale bar based on distance (same formula as name bubbles)
	var scale_factor: float = sqrt(BAR_SCALE_REF_DIST / max(dist, 0.5))
	scale_factor = clamp(scale_factor, 0.5, 1.5)
	_bar_panel.scale = Vector2(scale_factor, scale_factor)

	# Position above the object
	var bar_size: Vector2 = _bar_panel.size * scale_factor
	var bar_x: float = screen_pos.x - bar_size.x * 0.5
	var bar_y: float = screen_pos.y - bar_size.y - 20.0 * scale_factor  # 20px gap above object center
	_bar_panel.position = Vector2(bar_x, bar_y)

	# Position pay dialog below the action bar if visible
	if _pay_visible:
		var pay_size: Vector2 = _pay_panel.size * scale_factor
		_pay_panel.scale = Vector2(scale_factor, scale_factor)
		_pay_panel.position = Vector2(screen_pos.x - pay_size.x * 0.5, bar_y + bar_size.y + 4.0 * scale_factor)


# ─── Pay Dialog ──────────────────────────────────────────


## Handle pay_options and pay_result messages from Electron.
func handle_pay_message(msg: Dictionary) -> void:
	var msg_type: String = str(msg.get("type", ""))
	match msg_type:
		"pay_options":
			_show_pay_dialog(msg)
		"pay_result":
			_handle_pay_result(msg)


func _show_pay_dialog(msg: Dictionary) -> void:
	_pay_uuid = str(msg.get("uuid", ""))
	var default_price: int = int(msg.get("defaultPrice", -2))
	var buttons: Array = msg.get("buttons", [])

	# Clear previous preset buttons
	for child in _pay_buttons_hbox.get_children():
		child.queue_free()

	# PAY_PRICE_HIDE = -1, PAY_PRICE_DEFAULT = -2
	# Positive values = preset amounts
	var has_presets := false
	for btn_amount in buttons:
		var amt: int = int(btn_amount)
		if amt > 0:
			_pay_buttons_hbox.add_child(_make_pay_preset_button(amt))
			has_presets = true
	_pay_buttons_hbox.visible = has_presets

	# Show custom amount field unless default price is hidden (-1)
	_pay_custom_hbox.visible = default_price != -1
	if default_price > 0:
		_pay_amount_edit.text = str(default_price)
	else:
		_pay_amount_edit.text = ""

	_pay_status_label.visible = false
	_pay_panel.visible = true
	_pay_visible = true


func _hide_pay_dialog() -> void:
	_pay_panel.visible = false
	_pay_visible = false
	_pay_uuid = ""


func _on_pay_preset(amount: int) -> void:
	if _pay_uuid.is_empty():
		return
	_send_fn.call({ "type": "pay_confirm", "uuid": _pay_uuid, "amount": amount })
	_pay_status_label.text = "Paying L$%d..." % amount
	_pay_status_label.add_theme_color_override("font_color", Color(0.7, 0.7, 0.5))
	_pay_status_label.visible = true


func _on_pay_custom_submitted(text: String) -> void:
	_submit_custom_amount(text)


func _on_pay_custom_button() -> void:
	_submit_custom_amount(_pay_amount_edit.text)


func _submit_custom_amount(text: String) -> void:
	if _pay_uuid.is_empty():
		return
	var amount: int = int(text.strip_edges())
	if amount <= 0:
		_pay_status_label.text = "Enter a valid amount"
		_pay_status_label.add_theme_color_override("font_color", Color(0.8, 0.4, 0.4))
		_pay_status_label.visible = true
		return
	_send_fn.call({ "type": "pay_confirm", "uuid": _pay_uuid, "amount": amount })
	_pay_status_label.text = "Paying L$%d..." % amount
	_pay_status_label.add_theme_color_override("font_color", Color(0.7, 0.7, 0.5))
	_pay_status_label.visible = true


func _handle_pay_result(msg: Dictionary) -> void:
	var success: bool = msg.get("success", false)
	var amount: int = int(msg.get("amount", 0))
	if success:
		_pay_status_label.text = "Paid L$%d" % amount
		_pay_status_label.add_theme_color_override("font_color", Color(0.4, 0.8, 0.4))
	else:
		_pay_status_label.text = "Payment failed"
		_pay_status_label.add_theme_color_override("font_color", Color(0.8, 0.4, 0.4))
	_pay_status_label.visible = true
