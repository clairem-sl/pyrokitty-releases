extends RefCounted

## Panel manager — coordinates positioned UI panels (script dialogs, textboxes, etc.)
##
## Owns a CanvasLayer and manages lifecycle, screen projection, and stacking
## for all non-action-bar panels. Each panel type is a separate script that
## creates its own Control tree; this manager just tracks them and updates positions.

const ScriptDialogPanelScript = preload("res://src/script_dialog_panel.gd")

var sm  # scene_manager reference
var _camera: Camera3D
var _send_fn: Callable

var _canvas_layer: CanvasLayer

# Active panels: panel_id -> { "control": Control, "world_pos": Vector3,
#   "object_uuid": String, "panel": RefCounted, "centered": bool }
var _panels: Dictionary = {}
var _next_id: int = 0

# Script dialog dedup: "objectId:channel" -> panel_id (new dialog replaces old one)
var _dialog_key_to_id: Dictionary = {}

const PANEL_SCALE_REF_DIST: float = 5.0


func _init(scene_manager, camera: Camera3D, send_fn: Callable) -> void:
	sm = scene_manager
	_camera = camera
	_send_fn = send_fn
	_canvas_layer = CanvasLayer.new()
	_canvas_layer.layer = 102  # above action bar (101)
	sm.add_child.call_deferred(_canvas_layer)


## Register a panel. Returns its ID for later removal.
## If centered is true, the panel is fixed on screen (not projected from world space).
func add_panel(control: Control, world_pos: Vector3, object_uuid: String,
		panel_ref: RefCounted = null, centered: bool = false) -> int:
	var id := _next_id
	_next_id += 1
	_canvas_layer.add_child(control)
	_panels[id] = {
		"control": control,
		"world_pos": world_pos,
		"object_uuid": object_uuid,
		"panel": panel_ref,
		"centered": centered,
	}
	return id


func remove_panel(id: int) -> void:
	if not _panels.has(id):
		return
	var data: Dictionary = _panels[id]
	var ctrl: Control = data["control"]
	if ctrl and is_instance_valid(ctrl):
		ctrl.queue_free()
	_panels.erase(id)


func process(delta: float) -> void:
	if _panels.is_empty():
		return

	var cam: Camera3D = _camera
	if cam == null:
		return

	var viewport_size := cam.get_viewport().get_visible_rect().size

	# Group object-anchored panels by object for stacking
	var by_object: Dictionary = {}  # object_uuid -> Array[int]
	for id: int in _panels:
		var data: Dictionary = _panels[id]
		if data["centered"]:
			_position_centered(data, viewport_size)
			continue

		# Update world pos from live object position (object may have moved)
		var obj_uuid: String = data["object_uuid"]
		if sm.objects.has(obj_uuid):
			data["world_pos"] = sm.objects[obj_uuid].pos

		if not by_object.has(obj_uuid):
			by_object[obj_uuid] = []
		by_object[obj_uuid].append(id)

	# Position each stack
	for obj_uuid: String in by_object:
		var ids: Array = by_object[obj_uuid]
		var first_data: Dictionary = _panels[ids[0]]
		var world_pos: Vector3 = first_data["world_pos"]

		if cam.is_position_behind(world_pos):
			for id: int in ids:
				_panels[id]["control"].visible = false
			continue

		var screen_pos: Vector2 = cam.unproject_position(world_pos)
		var dist: float = cam.global_position.distance_to(world_pos)
		var scale_factor: float = sqrt(PANEL_SCALE_REF_DIST / max(dist, 0.5))
		scale_factor = clamp(scale_factor, 0.5, 1.5)

		# Stack panels vertically above the anchor
		var y_offset: float = 0.0
		for id: int in ids:
			var ctrl: Control = _panels[id]["control"]
			ctrl.visible = true
			ctrl.scale = Vector2(scale_factor, scale_factor)
			var panel_size: Vector2 = ctrl.size * scale_factor
			var x: float = screen_pos.x - panel_size.x * 0.5
			var y: float = screen_pos.y - panel_size.y - 40.0 * scale_factor - y_offset
			ctrl.position = Vector2(x, y)
			y_offset += panel_size.y + 4.0 * scale_factor


func _position_centered(data: Dictionary, viewport_size: Vector2) -> void:
	var ctrl: Control = data["control"]
	ctrl.visible = true
	ctrl.scale = Vector2.ONE
	var panel_size: Vector2 = ctrl.size
	ctrl.position = Vector2(
		(viewport_size.x - panel_size.x) * 0.5,
		(viewport_size.y - panel_size.y) * 0.4,  # slightly above center
	)


## Returns true if a click position hits any managed panel.
func is_click_on_panel(screen_pos: Vector2) -> bool:
	for id: int in _panels:
		var ctrl: Control = _panels[id]["control"]
		if ctrl.visible and ctrl.get_global_rect().has_point(screen_pos):
			return true
	return false


# ─── Script Dialogs ─────────────────────────────────────


## Handle an incoming script_dialog message from Electron.
func handle_script_dialog(msg: Dictionary) -> void:
	var dialog_id: String = str(msg.get("dialogId", ""))
	var object_id: String = str(msg.get("objectId", ""))
	var object_name: String = str(msg.get("objectName", ""))
	var owner_name: String = str(msg.get("ownerName", ""))
	var message: String = str(msg.get("message", ""))
	var buttons: Array = msg.get("buttons", [])
	var channel: int = int(msg.get("channel", 0))
	var is_textbox: bool = msg.get("isTextBox", false)

	# Replace existing dialog from same object + channel
	var dedup_key: String = "%s:%d" % [object_id, channel]
	if _dialog_key_to_id.has(dedup_key):
		var old_id: int = _dialog_key_to_id[dedup_key]
		remove_panel(old_id)
		_dialog_key_to_id.erase(dedup_key)

	# Create the dialog panel
	var dlg := ScriptDialogPanelScript.new(dialog_id, object_name, owner_name,
		message, buttons, is_textbox)

	# Connect signals
	dlg.replied.connect(_on_dialog_replied)
	dlg.textbox_submitted.connect(_on_textbox_submitted)
	dlg.dismissed.connect(_on_dialog_dismissed)

	# Anchor to object if it exists in scene, otherwise center
	var centered: bool = not sm.objects.has(object_id)
	var world_pos := Vector3.ZERO
	if not centered:
		world_pos = sm.objects[object_id].pos

	var panel_id := add_panel(dlg.panel, world_pos, object_id, dlg, centered)
	_dialog_key_to_id[dedup_key] = panel_id


func _on_dialog_replied(p_dialog_id: String, button_index: int, button_text: String) -> void:
	_send_fn.call({
		"type": "script_dialog_reply",
		"dialogId": p_dialog_id,
		"buttonIndex": button_index,
		"buttonText": button_text,
	})
	_remove_dialog_by_dialog_id(p_dialog_id)


func _on_textbox_submitted(p_dialog_id: String, text: String) -> void:
	_send_fn.call({
		"type": "script_textbox_reply",
		"dialogId": p_dialog_id,
		"text": text,
	})
	_remove_dialog_by_dialog_id(p_dialog_id)


func _on_dialog_dismissed(p_dialog_id: String) -> void:
	_remove_dialog_by_dialog_id(p_dialog_id)


func _remove_dialog_by_dialog_id(p_dialog_id: String) -> void:
	# Find panel ID by dialog_id (stored in the ScriptDialogPanel ref)
	var target_id: int = -1
	for id: int in _panels:
		var p = _panels[id].get("panel")
		if p and p is RefCounted and p.get("dialog_id") == p_dialog_id:
			target_id = id
			break
	if target_id < 0:
		return
	# Clean up dedup key
	for key: String in _dialog_key_to_id:
		if _dialog_key_to_id[key] == target_id:
			_dialog_key_to_id.erase(key)
			break
	remove_panel(target_id)
