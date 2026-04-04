extends RefCounted

## Script dialog / textbox panel — UI for llDialog and llTextBox.
##
## Dialog mode: message + up to 12 buttons in SL grid order (bottom-to-top, left-to-right).
## Textbox mode: message + single-line text input + Submit.
## Auto-dismisses after 60 seconds (matching SL behavior).

signal replied(dialog_id: String, button_index: int, button_text: String)
signal textbox_submitted(dialog_id: String, text: String)
signal dismissed(dialog_id: String)

var dialog_id: String
var is_textbox: bool
var panel: PanelContainer

var _timer: float = 0.0
var _timeout: float = 60.0
var _text_edit: LineEdit

const GRID_COLUMNS: int = 3
const MAX_PANEL_WIDTH: float = 400.0
const MIN_BUTTON_WIDTH: float = 80.0


func _init(p_dialog_id: String, object_name: String, owner_name: String,
		message: String, buttons: Array, p_is_textbox: bool) -> void:
	dialog_id = p_dialog_id
	is_textbox = p_is_textbox
	_build_ui(object_name, owner_name, message, buttons)


func process(delta: float) -> void:
	_timer += delta
	if _timer >= _timeout:
		dismissed.emit(dialog_id)


func _build_ui(object_name: String, owner_name: String,
		message: String, buttons: Array) -> void:
	panel = PanelContainer.new()
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.custom_minimum_size = Vector2(200, 0)

	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0.10, 0.10, 0.12, 0.95)
	bg.corner_radius_top_left = 8
	bg.corner_radius_top_right = 8
	bg.corner_radius_bottom_left = 8
	bg.corner_radius_bottom_right = 8
	bg.content_margin_left = 12
	bg.content_margin_right = 12
	bg.content_margin_top = 10
	bg.content_margin_bottom = 10
	panel.add_theme_stylebox_override("panel", bg)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 6)
	panel.add_child(vbox)

	# Owner name (small, gray)
	var owner_label := Label.new()
	owner_label.text = owner_name
	owner_label.add_theme_color_override("font_color", Color(0.5, 0.5, 0.55))
	owner_label.add_theme_font_size_override("font_size", 11)
	vbox.add_child(owner_label)

	# Object name (bold-ish, white)
	var name_label := Label.new()
	name_label.text = object_name
	name_label.add_theme_color_override("font_color", Color(0.9, 0.9, 0.9))
	name_label.add_theme_font_size_override("font_size", 14)
	vbox.add_child(name_label)

	# Separator
	var sep := HSeparator.new()
	sep.add_theme_constant_override("separation", 4)
	vbox.add_child(sep)

	# Message text (wrapping)
	var msg_label := Label.new()
	msg_label.text = message
	msg_label.add_theme_color_override("font_color", Color(0.85, 0.85, 0.85))
	msg_label.add_theme_font_size_override("font_size", 13)
	msg_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	msg_label.custom_minimum_size = Vector2(180, 0)
	vbox.add_child(msg_label)

	if is_textbox:
		_build_textbox(vbox)
	else:
		_build_button_grid(vbox, buttons)

	# Ignore button at the bottom
	var ignore_btn := Button.new()
	ignore_btn.text = "Ignore"
	ignore_btn.custom_minimum_size = Vector2(0, 28)
	ignore_btn.add_theme_font_size_override("font_size", 12)
	_style_button(ignore_btn, Color(0.25, 0.20, 0.20), Color(0.40, 0.25, 0.25))
	ignore_btn.pressed.connect(func(): dismissed.emit(dialog_id))
	vbox.add_child(ignore_btn)


func _build_textbox(vbox: VBoxContainer) -> void:
	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 4)
	vbox.add_child(hbox)

	_text_edit = LineEdit.new()
	_text_edit.custom_minimum_size = Vector2(180, 30)
	_text_edit.placeholder_text = "Enter text..."
	_text_edit.add_theme_font_size_override("font_size", 13)
	_text_edit.text_submitted.connect(_on_textbox_submit)
	hbox.add_child(_text_edit)

	var submit_btn := Button.new()
	submit_btn.text = "Submit"
	submit_btn.custom_minimum_size = Vector2(60, 30)
	submit_btn.add_theme_font_size_override("font_size", 13)
	_style_button(submit_btn, Color(0.18, 0.30, 0.45), Color(0.25, 0.45, 0.65))
	submit_btn.pressed.connect(func(): _on_textbox_submit(_text_edit.text))
	hbox.add_child(submit_btn)


func _build_button_grid(vbox: VBoxContainer, buttons: Array) -> void:
	if buttons.is_empty():
		return

	# SL button order: buttons[0] is bottom-left, filling left-to-right per row,
	# rows stack bottom-to-top. We build rows normally then add them in reverse.
	var rows: Array[Array] = []
	var current_row: Array = []
	for i: int in buttons.size():
		current_row.append({ "index": i, "text": str(buttons[i]) })
		if current_row.size() >= GRID_COLUMNS:
			rows.append(current_row)
			current_row = []
	if not current_row.is_empty():
		rows.append(current_row)

	# Reverse row order so first row (buttons 0-2) appears at the bottom
	rows.reverse()

	for row: Array in rows:
		var hbox := HBoxContainer.new()
		hbox.add_theme_constant_override("separation", 4)
		hbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		vbox.add_child(hbox)

		for btn_data: Dictionary in row:
			var btn := Button.new()
			btn.text = btn_data["text"]
			btn.custom_minimum_size = Vector2(MIN_BUTTON_WIDTH, 32)
			btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			btn.add_theme_font_size_override("font_size", 13)
			btn.clip_text = false  # never truncate — show full button text
			_style_button(btn, Color(0.18, 0.25, 0.38), Color(0.28, 0.40, 0.60))
			var idx: int = btn_data["index"]
			var txt: String = btn_data["text"]
			btn.pressed.connect(func(): replied.emit(dialog_id, idx, txt))
			hbox.add_child(btn)


func _style_button(btn: Button, normal_color: Color, hover_color: Color) -> void:
	var ns := StyleBoxFlat.new()
	ns.bg_color = normal_color
	ns.set_corner_radius_all(4)
	var hs := ns.duplicate() as StyleBoxFlat
	hs.bg_color = hover_color
	var ps := ns.duplicate() as StyleBoxFlat
	ps.bg_color = normal_color.darkened(0.2)
	btn.add_theme_stylebox_override("normal", ns)
	btn.add_theme_stylebox_override("hover", hs)
	btn.add_theme_stylebox_override("pressed", ps)
	btn.add_theme_color_override("font_color", Color(0.9, 0.9, 0.95))


func _on_textbox_submit(text: String) -> void:
	if text.strip_edges().is_empty():
		return
	textbox_submitted.emit(dialog_id, text)
