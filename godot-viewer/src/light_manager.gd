extends RefCounted

## Light creation, parameter application, distance culling, shadow ranking,
## and projection texture management.

const FrameBudget = preload("res://src/frame_budget.gd")

var sm  # scene_manager reference

## Lightweight wrapper around a light.
## Spot lights use a SpotLight3D node (for shadow_reverse_cull_face access).
## Omni lights use raw RenderingServer RIDs (no node needed).
class RSLight extends RefCounted:
	var light_rid: RID       # omni only
	var instance_rid: RID    # omni only
	var node: SpotLight3D    # spot only
	var is_spot: bool
	var proj_texture_id: String = ""
	var has_shadow: bool = false      # true if shadow_enabled is currently on
	var has_projector: bool = false    # true if this light uses a projection texture

	func _init(parent: Node3D, scenario: RID, spot: bool) -> void:
		is_spot = spot
		if spot:
			node = SpotLight3D.new()
			node.light_cull_mask = 1
			node.shadow_enabled = false
			parent.add_child(node)
		else:
			light_rid = RenderingServer.omni_light_create()
			instance_rid = RenderingServer.instance_create()
			RenderingServer.instance_set_base(instance_rid, light_rid)
			RenderingServer.instance_set_scenario(instance_rid, scenario)
			RenderingServer.light_set_shadow(light_rid, false)
			# Cube shadow mode — dual paraboloid has severe edge warping
			RenderingServer.light_omni_set_shadow_mode(light_rid, RenderingServer.LIGHT_OMNI_SHADOW_CUBE)
			# Layer 1 only — excludes water (layer 2) to avoid shadow map artifacts
			RenderingServer.light_set_cull_mask(light_rid, 1)

	func destroy() -> void:
		if node:
			node.queue_free()
			node = null
		else:
			RenderingServer.free_rid(instance_rid)
			RenderingServer.free_rid(light_rid)


var object_lights: Dictionary = {}           # localId -> RSLight
var _object_light_data: Dictionary = {}      # localId -> light dict (for re-creation after cull)
var _pending_proj_textures: Dictionary = {}  # textureId -> Array[localId]
var _projector_textures: Dictionary = {}    # textureId -> padded ImageTexture (square inscribed in circle)
var _light_count: int = 0
var _light_cull_timer: float = 0.0
var MAX_ACTIVE_LIGHTS: int = FrameBudget.MAX_ACTIVE_LIGHTS
var LIGHT_CULL_DISTANCE: float = FrameBudget.LIGHT_CULL_DISTANCE
var LIGHT_CULL_INTERVAL: float = FrameBudget.LIGHT_CULL_INTERVAL


func _init(scene_manager) -> void:
	sm = scene_manager


## Get a padded projector texture RID.  SL projects a rectangular frustum
## but Godot's spot-light cone is circular.  Pad the texture so the square
## image is inscribed inside the circle (sqrt(2)x larger canvas with black
## border).  Cached per texture_id so we only pad once.
func _get_projector_texture(texture_id: String) -> ImageTexture:
	if _projector_textures.has(texture_id):
		return _projector_textures[texture_id]

	var orig_tex: ImageTexture = sm.texture_cache.get(texture_id)
	if orig_tex == null:
		return null

	var img := orig_tex.get_image()
	if img == null:
		return orig_tex

	img = img.duplicate()
	if img.is_compressed():
		img.decompress()

	var ow := img.get_width()
	var oh := img.get_height()
	# sqrt(2) ~ 1.4143 — padded size so square inscribes in circle
	var nw := int(ceil(float(ow) * 1.4143))
	var nh := int(ceil(float(oh) * 1.4143))
	if nw % 2 != 0:
		nw += 1
	if nh % 2 != 0:
		nh += 1

	var padded := Image.create(nw, nh, false, img.get_format())
	padded.fill(Color.BLACK)
	padded.blit_rect(img, Rect2i(0, 0, ow, oh), Vector2i((nw - ow) / 2, (nh - oh) / 2))
	padded.generate_mipmaps()

	var padded_tex := ImageTexture.create_from_image(padded)
	_projector_textures[texture_id] = padded_tex
	print("[Light] Created padded projector texture %s: %dx%d -> %dx%d" % [texture_id, ow, oh, nw, nh])
	return padded_tex


## Create or update a RenderingServer light for an object
func create_or_update_light(local_id: int, light_data: Dictionary, rsi) -> void:
	# Cache light data for distance cull re-creation
	_object_light_data[local_id] = light_data

	# Distance check: skip if prim beyond cull distance from camera
	var cam: Camera3D = sm.get_viewport().get_camera_3d()
	if cam:
		var dist: float = rsi.pos.distance_to(cam.global_position)
		if dist > LIGHT_CULL_DISTANCE:
			return

	var is_spot: bool = light_data.get("isSpot", false)

	# If light exists and type changed (spot<->omni), destroy and recreate
	if object_lights.has(local_id):
		var existing: RSLight = object_lights[local_id]
		if existing.is_spot != is_spot:
			destroy_light(local_id)
		else:
			_apply_light_params(local_id, existing, light_data, rsi)
			return

	# Light count cap: skip if at max and this is a new light
	if _light_count >= MAX_ACTIVE_LIGHTS:
		return

	# Create new light
	var rsl := RSLight.new(sm, sm._scenario, is_spot)
	object_lights[local_id] = rsl
	_light_count += 1
	_apply_light_params(local_id, rsl, light_data, rsi)


## Apply parameters to an existing RSLight from light data dict
func _apply_light_params(local_id: int, rsl: RSLight, light_data: Dictionary, rsi) -> void:
	var color: Array = light_data.get("color", [1.0, 1.0, 1.0])
	var intensity: float = float(light_data.get("intensity", 1.0))
	var radius: float = float(light_data.get("radius", 10.0))
	var sl_falloff: float = clampf(float(light_data.get("falloff", 0.75)), 0.1, 2.0)

	if rsl.node:
		# -- SpotLight3D node path (projection spots) --
		var n: SpotLight3D = rsl.node
		n.light_color = Color(color[0], color[1], color[2])
		n.light_energy = intensity
		n.spot_range = radius
		n.light_specular = 0.5
		# SL falloff -> Godot attenuation (sub-linear range)
		n.spot_attenuation = sl_falloff

		var fov_rad: float = float(light_data.get("spotFov", 1.0))
		var half_fov := fov_rad * 0.5
		var diagonal_half := atan(sqrt(2.0) * tan(half_fov))
		n.spot_angle = rad_to_deg(diagonal_half)
		# Near-uniform brightness across the cone (SL has no angular falloff)
		n.spot_angle_attenuation = 0.01

		var proj_tex_id: String = light_data.get("projTexture", "")
		if not proj_tex_id.is_empty():
			rsl.proj_texture_id = proj_tex_id
			rsl.has_projector = true
			# Projectors need shadow_enabled for the texture to render —
			# enable immediately, cull sweep may demote if over budget.
			n.shadow_enabled = true
			rsl.has_shadow = true
			n.shadow_reverse_cull_face = true
			n.shadow_opacity = 1.0
			n.shadow_bias = 0.03
			n.shadow_normal_bias = 1.0
			var proj_tex := _get_projector_texture(proj_tex_id)
			if proj_tex:
				n.light_projector = proj_tex
			else:
				if not _pending_proj_textures.has(proj_tex_id):
					_pending_proj_textures[proj_tex_id] = []
				if local_id not in _pending_proj_textures[proj_tex_id]:
					_pending_proj_textures[proj_tex_id].append(local_id)
		else:
			# Non-projector spot — set shadow params for when the cull
			# sweep enables shadow_enabled on this light.
			n.shadow_reverse_cull_face = true
			n.shadow_bias = 0.05
			n.shadow_normal_bias = 2.0
			n.shadow_blur = 2.0

		# SL spots project along local -Z. Godot spot shines along -Z.
		# Rotate -90 deg around X to map SL -Z -> Godot -Z via the Y-up transform.
		var basis: Basis = Basis(rsi.rot) * Basis(Vector3.RIGHT, -PI / 2.0)
		n.global_transform = Transform3D(basis, rsi.pos)

		# Disable shadow casting on the emitter prim
		if not rsl.proj_texture_id.is_empty():
			RenderingServer.instance_geometry_set_cast_shadows_setting(
				rsi.rid, RenderingServer.SHADOW_CASTING_SETTING_OFF)
	else:
		# -- Raw RenderingServer path (omni lights) --
		var RS := RenderingServer
		RS.light_set_color(rsl.light_rid, Color(color[0], color[1], color[2]))
		RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_ENERGY, intensity)
		RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_RANGE, radius)
		RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_ATTENUATION, sl_falloff)
		# Shadow params pre-configured; shadow is enabled by the cull sweep.
		RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_SHADOW_BIAS, 0.1)
		RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_SHADOW_NORMAL_BIAS, 2.0)
		RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_SHADOW_BLUR, 2.0)
		RS.instance_set_transform(rsl.instance_rid, Transform3D(Basis(rsi.rot), rsi.pos))


## Destroy a light for a given localId
func destroy_light(local_id: int) -> void:
	if not object_lights.has(local_id):
		return
	var rsl: RSLight = object_lights[local_id]
	var rsi = sm.objects.get(local_id)
	var dist_info := ""
	if rsi:
		var cam: Camera3D = sm.get_viewport().get_camera_3d()
		if cam:
			dist_info = " dist=%.1f" % rsi.pos.distance_to(cam.global_position)
	print("[Light] DESTROY localId=%d spot=%s proj=%s%s" % [local_id, str(rsl.is_spot), rsl.proj_texture_id, dist_info])
	# Remove from pending proj textures
	if not rsl.proj_texture_id.is_empty() and _pending_proj_textures.has(rsl.proj_texture_id):
		_pending_proj_textures[rsl.proj_texture_id].erase(local_id)
		if _pending_proj_textures[rsl.proj_texture_id].size() == 0:
			_pending_proj_textures.erase(rsl.proj_texture_id)
	rsl.destroy()
	object_lights.erase(local_id)
	_light_count -= 1


## Update a light's transform to match its RSInstance position/rotation
func update_light_transform(local_id: int, rsi) -> void:
	var rsl: RSLight = object_lights.get(local_id)
	if rsl == null:
		return
	var basis: Basis = Basis(rsi.rot)
	if rsl.is_spot:
		basis = basis * Basis(Vector3.RIGHT, -PI / 2.0)
	if rsl.node:
		rsl.node.global_transform = Transform3D(basis, rsi.pos)
	else:
		RenderingServer.instance_set_transform(rsl.instance_rid, Transform3D(basis, rsi.pos))


## Apply pending projection textures when a texture finishes loading.
## Called from asset_pipeline._apply_texture_to_pending.
func apply_pending_proj_texture(texture_id: String) -> void:
	if not _pending_proj_textures.has(texture_id):
		return
	var waiting_ids: Array = _pending_proj_textures[texture_id]
	_pending_proj_textures.erase(texture_id)
	for lid: int in waiting_ids:
		var rsl: RSLight = object_lights.get(lid)
		if rsl != null and rsl.is_spot and rsl.node:
			print("[Light] Applying proj texture %s to localId=%d" % [texture_id, lid])
			rsl.node.light_projector = _get_projector_texture(texture_id)


## Distance culling sweep: destroy far lights, create close ones (called from _process)
func sweep_light_culling() -> void:
	var cam: Camera3D = sm.get_viewport().get_camera_3d()
	if cam == null:
		return
	var cam_pos: Vector3 = cam.global_position

	# Destroy lights beyond cull distance
	var to_remove: Array[int] = []
	for local_id: int in object_lights:
		var rsi = sm.objects.get(local_id)
		if rsi == null:
			to_remove.append(local_id)
			continue
		if rsi.pos.distance_to(cam_pos) > LIGHT_CULL_DISTANCE:
			to_remove.append(local_id)
	for local_id: int in to_remove:
		destroy_light(local_id)

	# Create lights for prims now within range (if under cap), nearest first
	var candidates: Array = []  # [[dist, local_id], ...]
	for local_id: int in _object_light_data:
		if object_lights.has(local_id):
			continue
		var rsi = sm.objects.get(local_id)
		if rsi == null:
			continue
		var dist: float = rsi.pos.distance_to(cam_pos)
		if dist <= LIGHT_CULL_DISTANCE:
			candidates.append([dist, local_id])
	candidates.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	for c: Array in candidates:
		if _light_count >= MAX_ACTIVE_LIGHTS:
			break
		var local_id: int = int(c[1])
		var rsi = sm.objects.get(local_id)
		if rsi == null:
			continue
		var light_data: Dictionary = _object_light_data[local_id]
		var is_spot: bool = light_data.get("isSpot", false)
		var rsl := RSLight.new(sm, sm._scenario, is_spot)
		object_lights[local_id] = rsl
		_light_count += 1
		_apply_light_params(local_id, rsl, light_data, rsi)

	# -- Shadow ranking --
	# Projectors always keep shadows (required for the texture to render).
	# The shadow budget applies to all other lights (omni + non-projector
	# spots) — enable shadows on the closest MAX_SHADOW_LIGHTS, disable rest.
	var shadow_candidates: Array = []  # [[dist, local_id], ...]
	for local_id: int in object_lights:
		var rsl: RSLight = object_lights[local_id]
		if rsl.has_projector:
			continue  # projectors keep shadows unconditionally
		var rsi = sm.objects.get(local_id)
		if rsi == null:
			continue
		shadow_candidates.append([rsi.pos.distance_to(cam_pos), local_id])
	shadow_candidates.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])

	var shadow_budget: int = FrameBudget.MAX_SHADOW_LIGHTS
	for i: int in shadow_candidates.size():
		var lid: int = int(shadow_candidates[i][1])
		var rsl: RSLight = object_lights[lid]
		var want_shadow: bool = i < shadow_budget
		if want_shadow != rsl.has_shadow:
			rsl.has_shadow = want_shadow
			if rsl.is_spot:
				rsl.node.shadow_enabled = want_shadow
			else:
				RenderingServer.light_set_shadow(rsl.light_rid, want_shadow)
