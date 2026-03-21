extends RefCounted

## Avatar name bubbles + chat text above heads.
## Creates Label3D nodes positioned at the mHead bone, billboard-facing the camera.
## Supports: display name, chat messages (fade after timeout), typing indicator "...".

var sm  # scene_manager reference

# Avatar name storage: avatarId -> String
var _avatar_names: Dictionary = {}

# Bubble nodes: avatarId -> Node3D (root of the bubble, child of avatar_node)
var _bubbles: Dictionary = {}

# Chat state: avatarId -> { text: String, time_left: float }
var _chat_state: Dictionary = {}

# Typing state: avatarId -> bool
var _typing_state: Dictionary = {}

# How long chat text stays visible (seconds)
const CHAT_DISPLAY_TIME: float = 12.0
# How far above the head bone the label sits (meters)
const BUBBLE_OFFSET_Y: float = 0.28
# Max chat lines shown
const MAX_CHAT_LINES: int = 3

# Cached bone index per avatar (avoids find_bone every frame)
var _head_bone_idx: Dictionary = {}  # avatarId -> int

# Cached background quad size per avatar (avoids re-creating mesh every frame)
var _bg_quad_size: Dictionary = {}  # avatarId -> Vector2

# Typing animation timer
var _typing_anim_timer: float = 0.0
const TYPING_ANIM_INTERVAL: float = 0.5  # seconds per dot cycle step
var _typing_dot_count: int = 1  # cycles 1 → 2 → 3 → 1


func _init(scene_manager) -> void:
	sm = scene_manager


## Called when an avatar is created. Stores name and creates the bubble.
func on_avatar_created(avatar_id: String, display_name: String) -> void:
	_avatar_names[avatar_id] = _clean_name(display_name)
	_create_bubble(avatar_id)


## Called when an avatar is killed. Cleans up everything.
func on_avatar_killed(avatar_id: String) -> void:
	_avatar_names.erase(avatar_id)
	_chat_state.erase(avatar_id)
	_typing_state.erase(avatar_id)
	_head_bone_idx.erase(avatar_id)
	_bg_quad_size.erase(avatar_id)
	if _bubbles.has(avatar_id):
		var bubble: Node3D = _bubbles[avatar_id]
		if is_instance_valid(bubble):
			bubble.queue_free()
		_bubbles.erase(avatar_id)


## Called when a nearby chat message arrives for this avatar.
func on_avatar_chat(avatar_id: String, message: String) -> void:
	_typing_state[avatar_id] = false
	_chat_state[avatar_id] = { "text": message, "time_left": CHAT_DISPLAY_TIME }
	_update_bubble_text(avatar_id)


## Called when typing indicator changes.
func on_avatar_typing(avatar_id: String, is_typing: bool) -> void:
	_typing_state[avatar_id] = is_typing
	# If they stopped typing and no chat is showing, just clear
	_update_bubble_text(avatar_id)


## Update name (e.g. display name arrived later than avatar_create).
func on_avatar_name_updated(avatar_id: String, display_name: String) -> void:
	_avatar_names[avatar_id] = _clean_name(display_name)
	_update_bubble_text(avatar_id)


## Called every frame from scene_manager._process to update bubble positions and fade chat.
func process(delta: float, camera: Camera3D) -> void:
	if camera == null:
		return

	# Animate typing dots: cycle "." → ".." → "..."
	_typing_anim_timer += delta
	if _typing_anim_timer >= TYPING_ANIM_INTERVAL:
		_typing_anim_timer -= TYPING_ANIM_INTERVAL
		_typing_dot_count = (_typing_dot_count % 3) + 1
		var dots: String = ".".repeat(_typing_dot_count)
		for avatar_id: String in _typing_state:
			if _typing_state[avatar_id]:
				var bubble: Node3D = _bubbles.get(avatar_id)
				if bubble and is_instance_valid(bubble):
					var tl: Label3D = bubble.get_node_or_null("TypingLabel")
					if tl:
						tl.text = dots

	# Fade chat timers
	var to_clear: Array[String] = []
	for avatar_id: String in _chat_state:
		var state: Dictionary = _chat_state[avatar_id]
		state["time_left"] = state["time_left"] - delta
		if state["time_left"] <= 0.0:
			to_clear.append(avatar_id)

	for avatar_id: String in to_clear:
		_chat_state.erase(avatar_id)
		_update_bubble_text(avatar_id)

	# Position bubbles at head bone
	for avatar_id: String in _bubbles:
		var bubble: Node3D = _bubbles[avatar_id]
		if not is_instance_valid(bubble):
			continue

		var skel: Skeleton3D = sm.animesh_shared_skeleton.get(avatar_id)
		if skel == null or not is_instance_valid(skel):
			continue

		# Get or cache head bone index
		if not _head_bone_idx.has(avatar_id):
			var idx: int = skel.find_bone("mHead")
			if idx < 0:
				continue
			_head_bone_idx[avatar_id] = idx

		var head_idx: int = _head_bone_idx[avatar_id]
		var head_global: Transform3D = skel.get_bone_global_pose(head_idx)
		# Position in skeleton-local space (bubble is child of avatar_node)
		# Add Y offset above head + skeleton's own Y offset (body size compensation)
		bubble.position = head_global.origin + skel.position + Vector3(0, BUBBLE_OFFSET_Y, 0)
		# Billboarding handled by each child (Label3D.billboard + shader vertex billboard)

		# Fade: reduce alpha of chat text as it approaches timeout
		var chat_label: Label3D = bubble.get_node_or_null("ChatLabel")
		if chat_label != null and _chat_state.has(avatar_id):
			var time_left: float = _chat_state[avatar_id]["time_left"]
			if time_left < 3.0:
				chat_label.modulate.a = clampf(time_left / 3.0, 0.0, 1.0)
			else:
				chat_label.modulate.a = 1.0

		# Re-fit background each frame (AABB is zero on first frame before text renders)
		_update_bubble_bg(avatar_id)

		# Hide self avatar bubble (optional — can remove if you want to see own name)
		if avatar_id == sm.self_avatar_id:
			bubble.visible = false
		else:
			bubble.visible = true


## Create the Label3D bubble hierarchy for an avatar.
func _create_bubble(avatar_id: String) -> void:
	var avatar_node: Node3D = sm.animesh_roots.get(avatar_id)
	if avatar_node == null or not is_instance_valid(avatar_node):
		return

	# Clean up existing bubble if any
	if _bubbles.has(avatar_id):
		var old: Node3D = _bubbles[avatar_id]
		if is_instance_valid(old):
			old.queue_free()

	var root := Node3D.new()
	root.name = "name_bubble"

	# Name label
	var name_label := Label3D.new()
	name_label.name = "NameLabel"
	name_label.text = _avatar_names.get(avatar_id, "")
	name_label.font_size = 48
	name_label.pixel_size = 0.002
	name_label.outline_size = 12
	name_label.modulate = Color(1.0, 1.0, 1.0, 0.9)
	name_label.outline_modulate = Color(0.0, 0.0, 0.0, 0.7)
	name_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	name_label.no_depth_test = true  # Always visible through geometry
	name_label.fixed_size = false
	name_label.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	name_label.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
	name_label.alpha_cut = Label3D.ALPHA_CUT_DISABLED
	name_label.position = Vector3(0, 0, -0.001)  # Slightly in front of background
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	root.add_child(name_label)

	# Chat label (above name)
	var chat_label := Label3D.new()
	chat_label.name = "ChatLabel"
	chat_label.text = ""
	chat_label.font_size = 40
	chat_label.pixel_size = 0.002
	chat_label.outline_size = 10
	chat_label.modulate = Color(1.0, 1.0, 1.0, 1.0)
	chat_label.outline_modulate = Color(0.0, 0.0, 0.0, 0.6)
	chat_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	chat_label.no_depth_test = true
	chat_label.fixed_size = false
	chat_label.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	chat_label.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
	chat_label.alpha_cut = Label3D.ALPHA_CUT_DISABLED
	chat_label.position = Vector3(0, -0.02, -0.001)  # Below name, small gap
	chat_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	chat_label.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	chat_label.visible = false
	root.add_child(chat_label)

	# Typing indicator — separate label below chat so it doesn't replace unfaded text
	var typing_label := Label3D.new()
	typing_label.name = "TypingLabel"
	typing_label.text = ""
	typing_label.font_size = 40
	typing_label.pixel_size = 0.002
	typing_label.outline_size = 10
	typing_label.modulate = Color(0.8, 0.8, 0.8, 0.7)
	typing_label.outline_modulate = Color(0.0, 0.0, 0.0, 0.5)
	typing_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	typing_label.no_depth_test = true
	typing_label.fixed_size = false
	typing_label.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	typing_label.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
	typing_label.alpha_cut = Label3D.ALPHA_CUT_DISABLED
	typing_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	typing_label.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	typing_label.visible = false
	root.add_child(typing_label)
	# TypingLabel position is set dynamically in _update_bubble_text based on chat visibility

	# Background panel — rounded rectangle via shader
	var bg := MeshInstance3D.new()
	bg.name = "Background"
	var quad := QuadMesh.new()
	quad.size = Vector2(0.5, 0.14)  # Will be resized in _update_bubble_bg
	bg.mesh = quad
	bg.material_override = _create_rounded_rect_material()
	bg.position = Vector3(0, 0.05, 0)  # Centered vertically on name
	root.add_child(bg)

	avatar_node.add_child(root)
	_bubbles[avatar_id] = root
	_update_bubble_bg(avatar_id)


## Update the text content of a bubble's labels.
func _update_bubble_text(avatar_id: String) -> void:
	if not _bubbles.has(avatar_id):
		return
	var bubble: Node3D = _bubbles[avatar_id]
	if not is_instance_valid(bubble):
		return

	var name_label: Label3D = bubble.get_node_or_null("NameLabel")
	var chat_label: Label3D = bubble.get_node_or_null("ChatLabel")
	var typing_label: Label3D = bubble.get_node_or_null("TypingLabel")

	if name_label != null:
		name_label.text = _avatar_names.get(avatar_id, "")

	# Chat text (independent of typing)
	if chat_label != null:
		if _chat_state.has(avatar_id):
			var msg: String = _chat_state[avatar_id]["text"]
			if msg.length() > 200:
				msg = msg.left(200) + "..."
			msg = _word_wrap(msg, 60)
			var lines: PackedStringArray = msg.split("\n")
			if lines.size() > MAX_CHAT_LINES:
				msg = ""
				for i in range(lines.size() - MAX_CHAT_LINES, lines.size()):
					if not msg.is_empty():
						msg += "\n"
					msg += lines[i]
			chat_label.text = msg
			chat_label.visible = true
		else:
			chat_label.text = ""
			chat_label.visible = false

	# Typing indicator — positioned below chat (or below name if no chat)
	if typing_label != null:
		var is_typing: bool = _typing_state.get(avatar_id, false)
		typing_label.visible = is_typing
		if is_typing:
			typing_label.text = ".".repeat(_typing_dot_count)
			# Position below chat if visible, otherwise below name
			if chat_label and chat_label.visible:
				var chat_h: float = _label_world_height(chat_label)
				typing_label.position = Vector3(0, chat_label.position.y - chat_h - 0.01, -0.001)
			else:
				typing_label.position = Vector3(0, -0.02, -0.001)

	_update_bubble_bg(avatar_id)


## Resize and reposition the background quad to fit the current text.
## Uses font metrics (not AABB, which returns a cube for billboard Label3D).
func _update_bubble_bg(avatar_id: String) -> void:
	if not _bubbles.has(avatar_id):
		return
	var bubble: Node3D = _bubbles[avatar_id]
	if not is_instance_valid(bubble):
		return

	var bg: MeshInstance3D = bubble.get_node_or_null("Background")
	if bg == null:
		return

	var name_label: Label3D = bubble.get_node_or_null("NameLabel")
	var chat_label: Label3D = bubble.get_node_or_null("ChatLabel")
	var typing_label: Label3D = bubble.get_node_or_null("TypingLabel")

	# Billboard Label3D returns a cube AABB (useless for sizing).
	# Compute size from font metrics instead: pixels * pixel_size = world units.
	var width: float = _label_world_width(name_label)
	var height: float = _label_world_height(name_label)

	if width == 0.0:
		return  # No text yet

	# Below-name content: chat + typing indicator
	var below: float = 0.0  # total extent below y=0
	if chat_label and chat_label.visible and not chat_label.text.is_empty():
		var cw: float = _label_world_width(chat_label)
		var ch: float = _label_world_height(chat_label)
		below = absf(chat_label.position.y) + ch
		width = maxf(width, cw)
	if typing_label and typing_label.visible:
		var tw: float = _label_world_width(typing_label)
		var th: float = _label_world_height(typing_label)
		below = absf(typing_label.position.y) + th
		width = maxf(width, tw)

	# Total height: name (grows up from 0) + below-name content
	var total_height: float = height + below

	bg.visible = true
	var pad_x: float = 0.06
	var pad_y: float = 0.015
	var new_size := Vector2(width + pad_x * 2, total_height + pad_y * 2)

	# Only recreate the mesh when the size actually changes
	if _bg_quad_size.get(avatar_id, Vector2.ZERO) != new_size:
		var quad := QuadMesh.new()
		quad.size = new_size
		bg.mesh = quad
		_bg_quad_size[avatar_id] = new_size

	# Name extends up from y=0, chat/typing extends down. Center of the combined region:
	var center_y: float = (height - below) * 0.5
	bg.position = Vector3(0, center_y, 0)


## Get the world-space width of a Label3D from font metrics.
func _label_world_width(label: Label3D) -> float:
	if label == null or label.text.is_empty():
		return 0.0
	var font: Font = ThemeDB.fallback_font if label.font == null else label.font
	if font == null:
		return 0.0
	var max_w: float = 0.0
	for line: String in label.text.split("\n"):
		var line_w: float = font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, label.font_size).x
		max_w = maxf(max_w, line_w)
	# Outline extends beyond the glyph bounds on both sides
	return (max_w + label.outline_size * 2.0) * label.pixel_size


## Get the world-space height of a Label3D from font metrics.
func _label_world_height(label: Label3D) -> float:
	if label == null or label.text.is_empty():
		return 0.0
	var font: Font = ThemeDB.fallback_font if label.font == null else label.font
	if font == null:
		return 0.0
	var line_count: int = label.text.count("\n") + 1
	var line_h: float = font.get_height(label.font_size)
	return line_count * line_h * label.pixel_size


## Create a ShaderMaterial that draws a rounded rectangle with soft edges.
## Shared across all bubbles (stateless — size comes from the quad mesh).
var _rounded_rect_material: ShaderMaterial = null

func _create_rounded_rect_material() -> ShaderMaterial:
	if _rounded_rect_material != null:
		return _rounded_rect_material

	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode unshaded, blend_mix, depth_test_disabled, cull_disabled;

uniform vec4 bg_color : source_color = vec4(0.0, 0.0, 0.0, 0.45);
// Corner radius in UV space (0.0 = sharp, 0.5 = pill)
uniform float radius : hint_range(0.0, 0.5) = 0.15;
uniform float smoothness : hint_range(0.001, 0.1) = 0.02;

void vertex() {
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(
		vec4(normalize(INV_VIEW_MATRIX[0].xyz), 0.0),
		vec4(normalize(INV_VIEW_MATRIX[1].xyz), 0.0),
		vec4(normalize(INV_VIEW_MATRIX[2].xyz), 0.0),
		MODEL_MATRIX[3]
	);
}

void fragment() {
	// UV is 0..1 across the quad; remap to -1..1
	vec2 p = abs(UV * 2.0 - 1.0);
	// Signed distance from rounded rect edge
	vec2 q = p - (1.0 - radius);
	float d = length(max(q, 0.0)) - radius;
	float a = 1.0 - smoothstep(-smoothness, smoothness, d);
	ALBEDO = bg_color.rgb;
	ALPHA = bg_color.a * a;
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = shader
	mat.render_priority = -1
	_rounded_rect_material = mat
	return mat


## Simple word wrap — inserts newlines at spaces near the target width.
func _word_wrap(text: String, width: int) -> String:
	if text.length() <= width:
		return text
	var result := ""
	var line := ""
	for word: String in text.split(" "):
		if line.is_empty():
			line = word
		elif (line.length() + 1 + word.length()) > width:
			result += line + "\n"
			line = word
		else:
			line += " " + word
	if not line.is_empty():
		result += line
	return result


## Strip " Resident" last name — SL default surname, never shown in viewers.
func _clean_name(display_name: String) -> String:
	if display_name.ends_with(" Resident"):
		return display_name.left(display_name.length() - 9)
	return display_name
