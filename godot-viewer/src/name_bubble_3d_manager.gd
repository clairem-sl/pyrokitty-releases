extends RefCounted

## Avatar name bubbles — 3D world-space implementation.
## Each bubble is a SubViewport (renders 2D text to texture) displayed on a
## QuadMesh in world space above the avatar's head.
##
## Orientation: manually faces the camera but only updates when the camera
## angle changes past a threshold. TAA smears objects that rotate every frame;
## snapping to discrete angles keeps the quad static most frames.
##
## For VR this is the preferred approach (no CanvasLayer in stereo).
## For desktop with TAA, the 2D CanvasLayer version may look crisper.

var sm  # scene_manager reference

var _avatar_names: Dictionary = {}       # avatarId -> String
var _bubbles: Dictionary = {}            # avatarId -> BubbleData
var _chat_state: Dictionary = {}         # avatarId -> { text: String, time_left: float }
var _typing_state: Dictionary = {}       # avatarId -> bool
var _head_bone_idx: Dictionary = {}      # avatarId -> int

const CHAT_DISPLAY_TIME: float = 12.0
const BUBBLE_OFFSET_Y: float = 0.35     # meters above head bone
const MAX_CHAT_LINES: int = 3
const FONT_SIZE: int = 24               # larger for 3D (renders to texture)
const VIEWPORT_WIDTH: int = 512
const VIEWPORT_HEIGHT: int = 256
const QUAD_BASE_SIZE: float = 1.0       # meters wide at reference scale
const FADE_MARGIN: float = 10.0         # start fading this many meters before cutoff
const BASE_SCALE: float = 0.25          # calibrated for 60° desktop FOV
const DESKTOP_TAN_HALF_FOV: float = 0.57735  # tan(30°) — precomputed for 60° desktop FOV

# Orientation snapping — only update facing when camera angle changes past this
const FACING_UPDATE_THRESHOLD: float = 0.05  # radians (~3 degrees)

var _typing_anim_timer: float = 0.0
const TYPING_ANIM_INTERVAL: float = 0.5
var _typing_dot_count: int = 1

# Shared material (all bubbles use same shader settings, different texture)
var _base_material: StandardMaterial3D


## Per-avatar bubble data
class BubbleData:
	var viewport: SubViewport
	var panel: PanelContainer
	var text_label: Label
	var mesh_instance: MeshInstance3D
	var material: StandardMaterial3D
	var last_facing_yaw: float = 0.0     # last snapped yaw toward camera
	var target_world_pos: Vector3 = Vector3.ZERO


func _init(scene_manager) -> void:
	sm = scene_manager


func on_avatar_created(avatar_id: String, display_name: String) -> void:
	_avatar_names[avatar_id] = _clean_name(display_name)
	_create_bubble(avatar_id)


func on_avatar_killed(avatar_id: String) -> void:
	_avatar_names.erase(avatar_id)
	_chat_state.erase(avatar_id)
	_typing_state.erase(avatar_id)
	_head_bone_idx.erase(avatar_id)
	if _bubbles.has(avatar_id):
		var bd: BubbleData = _bubbles[avatar_id]
		_destroy_bubble(bd)
		_bubbles.erase(avatar_id)


func on_avatar_chat(avatar_id: String, message: String) -> void:
	_typing_state[avatar_id] = false
	var display_msg: String = message
	if message.begins_with("/me ") or message == "/me":
		var name_str: String = _avatar_names.get(avatar_id, "")
		display_msg = name_str + message.substr(3)
	_chat_state[avatar_id] = { "text": display_msg, "time_left": CHAT_DISPLAY_TIME }
	_rebuild_text(avatar_id)


func on_avatar_typing(avatar_id: String, is_typing: bool) -> void:
	_typing_state[avatar_id] = is_typing
	_rebuild_text(avatar_id)


func on_avatar_name_updated(avatar_id: String, display_name: String) -> void:
	_avatar_names[avatar_id] = _clean_name(display_name)
	_rebuild_text(avatar_id)


func set_all_visible(vis: bool) -> void:
	for avatar_id: String in _bubbles:
		var bd: BubbleData = _bubbles[avatar_id]
		if is_instance_valid(bd.mesh_instance):
			bd.mesh_instance.visible = vis if vis else false


func process(delta: float, camera: Camera3D) -> void:
	if camera == null:
		return

	var cam_pos: Vector3 = camera.global_position

	# Typing dot animation
	_typing_anim_timer += delta
	var typing_changed := false
	if _typing_anim_timer >= TYPING_ANIM_INTERVAL:
		_typing_anim_timer -= TYPING_ANIM_INTERVAL
		_typing_dot_count = (_typing_dot_count % 3) + 1
		typing_changed = true

	# Fade chat timers
	var to_clear: Array[String] = []
	for avatar_id: String in _chat_state:
		var state: Dictionary = _chat_state[avatar_id]
		state["time_left"] -= delta
		if state["time_left"] <= 0.0:
			to_clear.append(avatar_id)

	for avatar_id: String in to_clear:
		_chat_state.erase(avatar_id)
		_rebuild_text(avatar_id)

	if typing_changed:
		for avatar_id: String in _typing_state:
			if _typing_state[avatar_id]:
				_rebuild_text(avatar_id)

	# Adapt scale to camera FOV — wider-FOV headsets get larger tags
	# so they cover the same fraction of the visual field as desktop
	var fov_scale: float = BASE_SCALE * tan(deg_to_rad(camera.fov) * 0.5) / DESKTOP_TAN_HALF_FOV

	# Update bubble positions and orientations
	for avatar_id: String in _bubbles:
		var bd: BubbleData = _bubbles[avatar_id]
		if not is_instance_valid(bd.mesh_instance) or not bd.mesh_instance.is_inside_tree():
			continue

		# Get head world position
		var head_world: Vector3 = _get_head_world_pos(avatar_id)
		if head_world == Vector3.ZERO:
			bd.mesh_instance.visible = false
			continue

		bd.target_world_pos = head_world

		# Distance culling and fade
		var dist: float = cam_pos.distance_to(head_world)
		if dist > sm._vis_far:
			bd.mesh_instance.visible = false
			continue

		# Position the quad
		bd.mesh_instance.global_position = head_world

		# Non-linear scale: sqrt falloff so nearby names stay prominent, distant ones shrink.
		var s: float = clampf(fov_scale * sqrt(maxf(dist, 0.5)), 0.5, 4.0)
		bd.mesh_instance.scale = Vector3(s, s, s)

		# Face camera — only update when angle changes past threshold
		_update_facing(bd, cam_pos)

		# Alpha: distance fade + chat expiry fade
		var alpha: float = 1.0
		var fade_start: float = sm._vis_far - FADE_MARGIN
		if dist > fade_start:
			alpha = clampf(1.0 - (dist - fade_start) / FADE_MARGIN, 0.0, 1.0)
		if _chat_state.has(avatar_id):
			var time_left: float = _chat_state[avatar_id]["time_left"]
			if time_left < 3.0:
				alpha *= clampf(time_left / 3.0, 0.0, 1.0)
		bd.material.albedo_color.a = alpha

		bd.mesh_instance.visible = true


func _get_head_world_pos(avatar_id: String) -> Vector3:
	var skel: Skeleton3D = sm.animesh_shared_skeleton.get(avatar_id)
	if skel == null or not is_instance_valid(skel):
		return Vector3.ZERO

	if not _head_bone_idx.has(avatar_id):
		var idx: int = skel.find_bone("mHead")
		if idx < 0:
			return Vector3.ZERO
		_head_bone_idx[avatar_id] = idx

	var head_idx: int = _head_bone_idx[avatar_id]
	var head_local: Vector3 = skel.get_bone_global_pose(head_idx).origin + skel.position
	var avatar_node: Node3D = sm.animesh_roots.get(avatar_id)
	if avatar_node == null or not is_instance_valid(avatar_node):
		return Vector3.ZERO

	return avatar_node.global_transform * (head_local + Vector3(0, BUBBLE_OFFSET_Y, 0))


func _update_facing(bd: BubbleData, cam_pos: Vector3) -> void:
	var to_cam: Vector3 = cam_pos - bd.mesh_instance.global_position
	to_cam.y = 0.0  # only yaw, no pitch tilt
	if to_cam.length_squared() < 0.01:
		return
	var target_yaw: float = atan2(to_cam.x, to_cam.z)
	var yaw_diff: float = abs(angle_difference(bd.last_facing_yaw, target_yaw))
	if yaw_diff > FACING_UPDATE_THRESHOLD:
		bd.last_facing_yaw = target_yaw
		bd.mesh_instance.rotation.y = target_yaw


# ─── Bubble Construction ────────────────────────────────


func _create_bubble(avatar_id: String) -> void:
	if _bubbles.has(avatar_id):
		_destroy_bubble(_bubbles[avatar_id])

	var bd := BubbleData.new()

	# SubViewport renders 2D UI to a texture
	bd.viewport = SubViewport.new()
	bd.viewport.size = Vector2i(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
	bd.viewport.transparent_bg = true
	bd.viewport.render_target_update_mode = SubViewport.UPDATE_WHEN_VISIBLE
	bd.viewport.gui_disable_input = true
	# Disable MSAA/TAA on the sub-viewport — we just want clean 2D text
	bd.viewport.msaa_2d = SubViewport.MSAA_DISABLED

	# Panel with label (same styling as 2D version)
	bd.panel = PanelContainer.new()
	bd.panel.set_anchors_preset(Control.PRESET_CENTER)
	bd.panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	bd.panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.0, 0.0, 0.0, 0.55)
	style.set_corner_radius_all(12)
	style.content_margin_left = 16
	style.content_margin_right = 16
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	bd.panel.add_theme_stylebox_override("panel", style)

	bd.text_label = Label.new()
	bd.text_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	bd.text_label.add_theme_color_override("font_color", Color(1.0, 1.0, 1.0, 0.95))
	bd.text_label.add_theme_font_size_override("font_size", FONT_SIZE)
	bd.text_label.text = _avatar_names.get(avatar_id, "")
	bd.panel.add_child(bd.text_label)

	bd.viewport.add_child(bd.panel)

	# MeshInstance3D with QuadMesh displaying the viewport texture
	bd.mesh_instance = MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(QUAD_BASE_SIZE, QUAD_BASE_SIZE * float(VIEWPORT_HEIGHT) / float(VIEWPORT_WIDTH))
	bd.mesh_instance.mesh = quad
	bd.mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

	# Material: unshaded, alpha-blended, using viewport texture
	bd.material = StandardMaterial3D.new()
	bd.material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bd.material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bd.material.billboard_mode = BaseMaterial3D.BILLBOARD_DISABLED  # we manage rotation manually
	bd.material.no_depth_test = true  # always on top
	bd.material.render_priority = 10  # draw after opaque
	bd.material.albedo_texture = bd.viewport.get_texture()
	bd.material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	bd.mesh_instance.material_override = bd.material

	bd.mesh_instance.visible = false

	# Add to scene tree
	sm.add_child.call_deferred(bd.viewport)
	sm.add_child.call_deferred(bd.mesh_instance)

	_bubbles[avatar_id] = bd


func _destroy_bubble(bd: BubbleData) -> void:
	if is_instance_valid(bd.mesh_instance):
		bd.mesh_instance.queue_free()
	if is_instance_valid(bd.viewport):
		bd.viewport.queue_free()


func _rebuild_text(avatar_id: String) -> void:
	if not _bubbles.has(avatar_id):
		return
	var bd: BubbleData = _bubbles[avatar_id]
	if not is_instance_valid(bd.text_label):
		return

	var parts: PackedStringArray = []
	parts.append(_avatar_names.get(avatar_id, ""))

	if _chat_state.has(avatar_id):
		var msg: String = _chat_state[avatar_id]["text"]
		if msg.length() > 200:
			msg = msg.left(200) + "..."
		msg = _word_wrap(msg, 40)  # narrower wrap for 3D (larger font)
		var lines: PackedStringArray = msg.split("\n")
		if lines.size() > MAX_CHAT_LINES:
			for i in range(lines.size() - MAX_CHAT_LINES, lines.size()):
				parts.append(lines[i])
		else:
			parts.append(msg)

	if _typing_state.get(avatar_id, false):
		parts.append(".".repeat(_typing_dot_count))

	bd.text_label.text = "\n".join(parts)


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


func _clean_name(display_name: String) -> String:
	if display_name.ends_with(" Resident"):
		return display_name.left(display_name.length() - 9)
	return display_name
