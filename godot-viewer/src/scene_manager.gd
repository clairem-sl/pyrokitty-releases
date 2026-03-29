extends Node3D

## Manages in-world objects and avatars as lightweight RenderingServer RIDs.
## Coordinate conversion: SL (X=East, Y=North, Z=Up) -> Godot (X=Right, Y=Up, Z=-Forward)
##   Position: (sl.x, sl.z, -sl.y)
##   Quaternion: (sl.x, sl.z, -sl.y, sl.w)

const FrameBudget = preload("res://src/frame_budget.gd")
const PrimMeshGeneratorScript = preload("res://src/prim_mesh_generator.gd")
const ObjectManagerScript = preload("res://src/object_manager.gd")
const AnimationManagerScript = preload("res://src/animation_manager.gd")
const AvatarManagerScript = preload("res://src/avatar_manager.gd")
const InterpolationManagerScript = preload("res://src/interpolation_manager.gd")
const LightManagerScript = preload("res://src/light_manager.gd")
const AssetPipelineScript = preload("res://src/asset_pipeline.gd")
const TerrainEnvironmentScript = preload("res://src/terrain_environment.gd")
const ObjectPickerScript = preload("res://src/object_picker.gd")
const SkeletonBuilderScript = preload("res://src/skeleton_builder.gd")
const NameBubbleManagerScript = preload("res://src/name_bubble_manager.gd")
const NameBubble3DManagerScript = preload("res://src/name_bubble_3d_manager.gd")
const FlexiPrimManagerScript = preload("res://src/flexi_prim_manager.gd")

signal self_avatar_moved(pos: Vector3)
signal object_properties_received(uuid: String, name: String, description: String)

## Lightweight RefCounted wrapper around a RenderingServer instance RID.
## Replaces MeshInstance3D nodes to eliminate scene tree overhead.
class RSInstance extends RefCounted:
	var rid: RID
	var pos: Vector3 = Vector3.ZERO
	var rot: Quaternion = Quaternion.IDENTITY
	var scl: Vector3 = Vector3.ONE
	var scl_divisor: Vector3 = Vector3.ONE  # Rigged mesh AABB size correction
	var scl_center: Vector3 = Vector3.ZERO  # Rigged mesh AABB center offset
	var mesh: Mesh = null
	var on_transform_pushed: Callable

	func _init(scenario: RID, vis_far: float = 128.0, vis_fade: float = 32.0) -> void:
		rid = RenderingServer.instance_create()
		RenderingServer.instance_set_scenario(rid, scenario)
		RenderingServer.instance_geometry_set_cast_shadows_setting(rid, RenderingServer.SHADOW_CASTING_SETTING_ON)
		RenderingServer.instance_geometry_set_visibility_range(rid, 0.0, vis_far, 0.0, vis_fade, RenderingServer.VISIBILITY_RANGE_FADE_SELF)

	func set_vis_range(vis_far: float, vis_fade: float) -> void:
		RenderingServer.instance_geometry_set_visibility_range(rid, 0.0, vis_far, 0.0, vis_fade, RenderingServer.VISIBILITY_RANGE_FADE_SELF)

	func set_mesh(m: Mesh) -> void:
		mesh = m
		RenderingServer.instance_set_base(rid, m.get_rid())

	func push_transform() -> void:
		var effective_scl: Vector3 = scl / scl_divisor
		# Center mesh on prim position: subtract scaled AABB center so the mesh
		# midpoint aligns with the prim origin (SL convention for unrigged meshes)
		var adjusted_pos: Vector3 = pos - Basis(rot) * (effective_scl * scl_center)
		var xform := Transform3D(Basis(rot) * Basis.from_scale(effective_scl), adjusted_pos)
		RenderingServer.instance_set_transform(rid, xform)
		if on_transform_pushed.is_valid():
			on_transform_pushed.call(xform)

	func set_material_override(mat: Material) -> void:
		if mat == null:
			RenderingServer.instance_geometry_set_material_override(rid, RID())
		else:
			RenderingServer.instance_geometry_set_material_override(rid, mat.get_rid())

	func set_surface_material(idx: int, mat: Material) -> void:
		RenderingServer.instance_set_surface_override_material(rid, idx, mat.get_rid())

	func destroy() -> void:
		RenderingServer.free_rid(rid)


# ─── Shared State ────────────────────────────────────
# All tracking dictionaries live here. Sub-managers access via their `sm` reference.

var objects: Dictionary = {}   # uuid (String) -> RSInstance
var avatars: Dictionary = {}   # avatarId (String) -> RSInstance
var self_avatar_id: String = ""
var self_avatar_target_rot: Quaternion = Quaternion.IDENTITY  # target yaw, damped in interpolation

# World origin — set at login, updated on teleport. All positions relative to this.
var world_origin_x: float = 0.0
var world_origin_y: float = 0.0

# Per-region offsets from world origin, keyed by cacheID
var region_offsets: Dictionary = {}   # cacheID (String) -> Vector2(offsetX, offsetY)

# Per-object region offset (stored at creation, reused on updates)
var object_region_offset: Dictionary = {}   # uuid (String) -> Vector3(offsetX, 0, offsetY)

# Interpolation targets
var avatar_targets: Dictionary = {}   # avatarId -> { pos, rot, vel, age }
var object_targets: Dictionary = {}   # uuid (String) -> { pos, rot, vel, accel, angVel, age }
# avatar_local_ids removed — animesh_roots/animesh_shared_skeleton now keyed by avatar UUID directly

# Linkset tracking (flat hierarchy — no Godot node parenting to avoid scale inheritance)
var pending_children: Dictionary = {}   # parent uuid (String) -> Array[child uuid (String)]
var object_parent: Dictionary = {}      # child uuid (String) -> parent uuid (String)
var object_children: Dictionary = {}    # parent uuid (String) -> Array[child uuid (String)]
var child_offset_pos: Dictionary = {}   # uuid (String) -> Vector3
var child_offset_rot: Dictionary = {}   # uuid (String) -> Quaternion
var pending_seated_avatars: Dictionary = {}  # seat uuid (String) -> Array[{id, pos, rot}]

# Shared mesh resources
var object_mesh: BoxMesh
var avatar_mesh: BoxMesh
var object_material: StandardMaterial3D
var avatar_material: StandardMaterial3D

# Mesh pipeline
var mesh_cache: Dictionary = {}        # meshId (String) -> Mesh resource
var mesh_load_failed: Dictionary = {}  # meshId (String) -> bool

# Texture pipeline
var texture_cache: Dictionary = {}        # textureId (String) -> ImageTexture
var material_cache: Dictionary = {}       # "uuid_colorhex_fb_ds_uv" (String) -> StandardMaterial3D
var object_meta: Dictionary = {}          # uuid (String) -> { name, description }
var object_faces: Dictionary = {}         # uuid (String) -> Array[face_info dicts]
var texture_load_failed: Dictionary = {}  # textureId (String) -> bool

# Animesh (rigged mesh with skeleton animation)
var animesh_roots: Dictionary = {}         # root uuid (String) -> Node3D (scene tree parent)
var animesh_shared_skeleton: Dictionary = {} # root uuid (String) -> Skeleton3D (ONE per avatar, from XML)
# animesh_mesh_skeletons removed — all meshes now bind to the shared skeleton
var animesh_root_for: Dictionary = {}      # uuid (String) -> root uuid (String) (maps object to its animesh root)
var rigged_mesh_paths: Dictionary = {}     # meshId (String) -> GLB path (for generate_scene)
var mesh_joint_overrides: Dictionary = {} # meshId (String) -> Array[String] (joints with custom positions)
var animesh_pelvis_offset: Dictionary = {} # animesh root uuid -> Vector3 (negated pelvis rest, for root-prim animesh)
var bone_override_owner: Dictionary = {}  # root uuid (String) -> Dictionary { boneName -> meshId } (lowest UUID wins)
var bone_shape_scales: Dictionary = {}   # root uuid (String) -> Dictionary { boneName -> Vector3 (SL space scale) }
var cv_volume_morphs: Dictionary = {}    # root uuid (String) -> Dictionary { cvName -> { scale: Vec3, offset: Vec3 } }
var animesh_anim_data: Dictionary = {}    # animId (String) -> raw Dictionary (with per-joint priorities)
var animesh_pending_anims: Dictionary = {} # root uuid (String) -> Array[animId String] (pending animation IDs)
var animesh_worn_anims: Dictionary = {}   # root uuid (String) -> Array[animId String] (from worn animesh attachments)
var animesh_mesh_instances: Dictionary = {} # uuid (String) -> MeshInstance3D (for texture application)

# Attachment point bone tracking — non-rigged attachments follow their bone each frame
# Flexi (flexible) prim tracking — flexi prims bypass RSInstance and use Skeleton3D+SpringBone
var flexi_params: Dictionary = {}             # uuid (String) -> Dictionary (SL flexi params from object_create)

var attach_bone: Dictionary = {}            # uuid (String) -> bone name (String) for objects attached to avatar bones
var attach_bone_idx: Dictionary = {}        # uuid (String) -> bone index (int), cached from find_bone at registration
var attach_point_id: Dictionary = {}        # uuid (String) -> attachmentPointId (int)
var bone_global_overrides: Dictionary = {}  # root uuid (String) -> {bone_name -> Vector3} (global rest positions from meshes)

# Skeleton builder — parses avatar_skeleton.xml once, creates shared skeletons
var skeleton_builder: RefCounted

# Manual animation evaluation (replaces AnimationPlayer for correct SL→Godot rotation order)
# SL: world = local * parent.  Godot: world = parent * local.  Must conjugate per bone.
var animesh_eval: Dictionary = {}          # root uuid (String) -> {time, duration, loop, joints: {name -> {rot_keys, pos_keys}}}
var animesh_eval_active: bool = false      # true when any animesh has active animation data
var object_mesh_id: Dictionary = {}        # uuid (String) -> meshId (String) — persists after mesh loads

# Prim geometry generator
var prim_generator: RefCounted

# Cached scenario RID for RSInstance creation
var _scenario: RID
var _target_frame_ms: float = FrameBudget.DESKTOP_FRAME_MS
var _vr_mode: bool = false
var _vis_far: float = 128.0   # SL draw distance; VR overrides computed at call sites via _vr_mode
var _vis_fade: float = 32.0
var send_fn: Callable  # set by main.gd; routes messages back to TS over WebSocket
var _evict_timer: float = 0.0
const EVICT_INTERVAL: float = 60.0
var _sweep_timer: float = 0.0
var _sweep_last_pos: Vector3 = Vector3.ZERO
const SWEEP_INTERVAL: float = 3.0
const SWEEP_MOVE_DIST_SQ: float = 100.0  # 10m squared


# Loading fade-in overlay (opaque black → transparent)
var _fade_overlay: ColorRect = null
var _fade_alpha: float = 1.0
const _LOADING_FADE_IN_SPEED: float = 0.5  # alpha units/sec after loading ends (~2s fade)

# ─── Sub-managers ────────────────────────────────────

var object_mgr: RefCounted         # ObjectManager
var animation_mgr: RefCounted      # AnimationManager
var avatar_mgr: RefCounted         # AvatarManager
var interp_mgr: RefCounted         # InterpolationManager
var light_mgr: RefCounted          # LightManager
var asset_pipeline: RefCounted     # AssetPipeline
var terrain_env: RefCounted        # TerrainEnvironment
var object_picker: RefCounted      # ObjectPicker
var name_bubble_mgr: RefCounted    # NameBubbleManager (2D screen-space)
var name_bubble_3d_mgr: RefCounted # NameBubble3DManager (3D world-space)
var _bubble_2d_active: bool = true   # desktop default; VR flips these
var _bubble_3d_active: bool = false
var flexi_mgr: RefCounted          # FlexiPrimManager


## Erase all animesh-related dictionary entries for a given root uuid.
## Call after queue_free()ing the root node.
func erase_animesh_state(root_uuid: String) -> void:
	animesh_roots.erase(root_uuid)
	animesh_shared_skeleton.erase(root_uuid)
	animesh_eval.erase(root_uuid)
	animesh_pending_anims.erase(root_uuid)
	animesh_worn_anims.erase(root_uuid)
	bone_global_overrides.erase(root_uuid)
	bone_shape_scales.erase(root_uuid)
	cv_volume_morphs.erase(root_uuid)
	if animesh_eval.is_empty():
		animesh_eval_active = false
	# Notify animation thread to clean up state for this root
	animation_mgr.push_avatar_killed(root_uuid)


func _exit_tree() -> void:
	animation_mgr.shutdown()
	asset_pipeline.shutdown()
	# Skip all cleanup — process is about to die anyway.
	# RenderingServer RIDs, threads, and memory are freed by the OS on exit.


func _ready() -> void:
	_scenario = get_world_3d().scenario

	# Create shared meshes
	object_mesh = BoxMesh.new()
	object_mesh.size = Vector3(0.5, 0.5, 0.5)

	avatar_mesh = BoxMesh.new()
	avatar_mesh.size = Vector3(0.3, 1.4, 0.3)  # Small placeholder so rigged attachments are visible

	# Gray material for objects
	object_material = StandardMaterial3D.new()
	object_material.albedo_color = Color(0.6, 0.6, 0.6)

	# Blue material for avatars
	avatar_material = StandardMaterial3D.new()
	avatar_material.albedo_color = Color(0.3, 0.5, 0.9)

	# Prim geometry generator
	prim_generator = PrimMeshGeneratorScript.new()

	# Skeleton builder — parse avatar_skeleton.json once
	skeleton_builder = SkeletonBuilderScript.new()
	skeleton_builder.load_from_json("res://data/avatar_skeleton.json")

	# Initialize sub-managers
	object_mgr = ObjectManagerScript.new(self)
	animation_mgr = AnimationManagerScript.new(self)
	avatar_mgr = AvatarManagerScript.new(self)
	interp_mgr = InterpolationManagerScript.new(self)
	light_mgr = LightManagerScript.new(self)
	asset_pipeline = AssetPipelineScript.new(self)
	terrain_env = TerrainEnvironmentScript.new(self)
	object_picker = ObjectPickerScript.new(self)
	name_bubble_mgr = NameBubbleManagerScript.new(self)
	name_bubble_3d_mgr = NameBubble3DManagerScript.new(self)
	flexi_mgr = FlexiPrimManagerScript.new(self)

	asset_pipeline.start_threads()

	# Start with opaque black overlay — fade out as assets load
	var fade_layer := CanvasLayer.new()
	fade_layer.layer = 100  # on top of everything
	_fade_overlay = ColorRect.new()
	_fade_overlay.color = Color(0.0, 0.0, 0.0, 1.0)
	_fade_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	fade_layer.add_child(_fade_overlay)
	add_child(fade_layer)


## Per-subsystem timing accumulators (milliseconds, averaged over 1s windows).
## Reset each time stats are collected via get_process_timing().
var _timing_samples: int = 0
var _timing_terrain_ms: float = 0.0
var _timing_interp_av_ms: float = 0.0
var _timing_interp_obj_ms: float = 0.0
var _timing_anim_ms: float = 0.0
var _timing_flexi_ms: float = 0.0
var _timing_bubbles_ms: float = 0.0
var _timing_finalize_ms: float = 0.0

func get_process_timing() -> Dictionary:
	var n := maxf(_timing_samples, 1)
	var result := {
		"terrain": _timing_terrain_ms / n,
		"interpAv": _timing_interp_av_ms / n,
		"interpObj": _timing_interp_obj_ms / n,
		"anim": _timing_anim_ms / n,
		"flexi": _timing_flexi_ms / n,
		"bubbles": _timing_bubbles_ms / n,
		"finalize": _timing_finalize_ms / n,
		"animRoots": animation_mgr._slots.size(),
		"interpTargets": object_targets.size(),
	}
	_timing_samples = 0
	_timing_terrain_ms = 0.0
	_timing_interp_av_ms = 0.0
	_timing_interp_obj_ms = 0.0
	_timing_anim_ms = 0.0
	_timing_flexi_ms = 0.0
	_timing_bubbles_ms = 0.0
	_timing_finalize_ms = 0.0
	return result

func _process(delta: float) -> void:
	_timing_samples += 1
	var _t0: float

	# Terrain/water/sky processing
	_t0 = Time.get_ticks_usec()
	terrain_env.process(delta)
	_timing_terrain_ms += (Time.get_ticks_usec() - _t0) / 1000.0

	# Interpolate avatar positions/rotations toward their targets
	_t0 = Time.get_ticks_usec()
	interp_mgr.interpolate_avatars(delta)
	_timing_interp_av_ms += (Time.get_ticks_usec() - _t0) / 1000.0

	# Interpolate moving objects (physical objects with velocity)
	_t0 = Time.get_ticks_usec()
	interp_mgr.interpolate_objects(delta)
	_timing_interp_obj_ms += (Time.get_ticks_usec() - _t0) / 1000.0

	# Flexi prim Verlet simulation (world-space physics → bone rotations)
	_t0 = Time.get_ticks_usec()
	flexi_mgr.simulate(delta)
	_timing_flexi_ms += (Time.get_ticks_usec() - _t0) / 1000.0

	# Consume animation thread output slots and apply to Skeleton3D
	_t0 = Time.get_ticks_usec()
	animation_mgr.consume_anim_slots(delta)
	_timing_anim_ms += (Time.get_ticks_usec() - _t0) / 1000.0

	# Periodic light distance culling sweep
	light_mgr._light_cull_timer += delta
	if light_mgr._light_cull_timer >= light_mgr.LIGHT_CULL_INTERVAL:
		light_mgr._light_cull_timer = 0.0
		light_mgr.sweep_light_culling()

	# Periodic eviction of unreferenced GPU assets
	_evict_timer += delta
	if _evict_timer >= EVICT_INTERVAL:
		_evict_timer = 0.0
		asset_pipeline.evict_unused_assets()

	# Update name bubbles (position at head bone, fade chat)
	_t0 = Time.get_ticks_usec()
	var _bubble_cam := get_viewport().get_camera_3d()
	if _bubble_2d_active:
		name_bubble_mgr.process(delta, _bubble_cam)
	if _bubble_3d_active:
		name_bubble_3d_mgr.process(delta, _bubble_cam)
	_timing_bubbles_ms += (Time.get_ticks_usec() - _t0) / 1000.0

	# Update camera position for distance-filtered asset apply
	var _cam := get_viewport().get_camera_3d()
	if _cam:
		asset_pipeline._cam_pos = _cam.global_position
		# Sweep far parking lot: when camera moves OR queues are non-empty (initial load)
		_sweep_timer += delta
		if _sweep_timer >= SWEEP_INTERVAL:
			var _has_far: bool = asset_pipeline._deferred_tex_far.size() > 0 or asset_pipeline._deferred_mesh_far.size() > 0
			if _has_far or asset_pipeline._cam_pos.distance_squared_to(_sweep_last_pos) > SWEEP_MOVE_DIST_SQ:
				asset_pipeline.sweep_deferred_far()
				_sweep_last_pos = asset_pipeline._cam_pos
			_sweep_timer = 0.0

	# Submit queued mesh work to WorkerThreadPool + finalize textures/meshes
	_t0 = Time.get_ticks_usec()
	asset_pipeline.finalize_frame(delta, _vr_mode, _target_frame_ms)
	_timing_finalize_ms += (Time.get_ticks_usec() - _t0) / 1000.0

	# Loading fade-in overlay
	if _fade_overlay != null:
		_update_loading_fade(delta)


func _update_loading_fade(delta: float) -> void:
	# Smooth linear fade from black over the full 30s loading period and beyond.
	# Rate: 1/30 ≈ 0.033 alpha/sec during loading, then same rate after.
	_fade_alpha = maxf(0.0, _fade_alpha - delta / 10.0)
	if _fade_alpha <= 0.0:
		_fade_overlay.get_parent().queue_free()
		_fade_overlay = null
		return
	_fade_overlay.color = Color(0.0, 0.0, 0.0, _fade_alpha)


# ─── Public API (delegates to sub-managers) ──────────

# Region change — clear entire scene for cross-region teleport
func handle_region_change() -> void:
	print("[SceneManager] Region change — clearing all objects, avatars, and lights")

	# Destroy all pick bodies before clearing objects
	object_picker.destroy_all_pick_bodies()

	# Destroy all object RSInstances
	for uuid: String in objects:
		objects[uuid].destroy()
	objects.clear()

	# Destroy all avatar RSInstances
	for avatar_id: String in avatars:
		avatars[avatar_id].destroy()
	avatars.clear()

	# Destroy all lights
	for uuid: String in light_mgr.object_lights:
		light_mgr.object_lights[uuid].destroy()
	light_mgr.object_lights.clear()
	light_mgr._object_light_data.clear()
	light_mgr._pending_proj_textures.clear()
	light_mgr._light_count = 0

	# Destroy all animesh scene tree nodes (skeletons + mesh instances)
	for uuid: String in animesh_roots:
		var node: Node3D = animesh_roots[uuid]
		if node and is_instance_valid(node):
			node.queue_free()
	animesh_roots.clear()
	animesh_shared_skeleton.clear()
	animesh_mesh_instances.clear()
	animesh_root_for.clear()
	animesh_eval.clear()
	animesh_eval_active = false
	animesh_pending_anims.clear()
	animesh_worn_anims.clear()
	bone_global_overrides.clear()
	bone_shape_scales.clear()
	cv_volume_morphs.clear()

	# Clear all tracking dictionaries
	avatar_targets.clear()
	object_targets.clear()
	pending_children.clear()
	object_parent.clear()
	object_children.clear()
	child_offset_pos.clear()
	child_offset_rot.clear()
	pending_seated_avatars.clear()
	object_faces.clear()
	object_meta.clear()
	object_mesh_id.clear()
	object_region_offset.clear()
	region_offsets.clear()
	attach_bone.clear()
	attach_point_id.clear()


	# Notify animation thread to clear all state
	animation_mgr.push_region_change()

	# Clear asset pipeline retry queues
	asset_pipeline._pending_complete_by_mesh.clear()
	asset_pipeline._tex_waiting.clear()

	# Evict unreferenced assets now that all objects are cleared
	asset_pipeline.evict_unused_assets()
	_evict_timer = 0.0

	# Clear terrain (new region will send new heightmap + environment)
	terrain_env.clear()

	print("[SceneManager] Scene cleared, ready for new region data")


# Objects
func handle_object_create(msg: Dictionary) -> void:
	object_mgr.handle_object_create(msg)

func handle_object_complete(msg: Dictionary) -> void:
	object_mgr.handle_object_complete(msg)

func handle_object_update_batch(msg: Dictionary) -> void:
	object_mgr.handle_object_update_batch(msg)

func handle_update_faces(msg: Dictionary) -> void:
	object_mgr.handle_update_faces(msg)

func handle_update_faces_batch(msg: Dictionary) -> void:
	object_mgr.handle_update_faces_batch(msg)

func handle_object_kill(msg: Dictionary) -> void:
	object_mgr.handle_object_kill(msg)

func handle_object_properties(msg: Dictionary) -> void:
	object_picker.handle_object_properties(msg)

# Avatars
func handle_avatar_create(msg: Dictionary) -> void:
	avatar_mgr.handle_avatar_create(msg)

func handle_avatar_update(msg: Dictionary) -> void:
	avatar_mgr.handle_avatar_update(msg)

func handle_avatar_update_batch(msg: Dictionary) -> void:
	avatar_mgr.handle_avatar_update_batch(msg)

func handle_avatar_kill(msg: Dictionary) -> void:
	avatar_mgr.handle_avatar_kill(msg)

func handle_avatar_chat(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("avatarId", "")
	var message: String = msg.get("message", "")
	if not avatar_id.is_empty() and not message.is_empty():
		name_bubble_mgr.on_avatar_chat(avatar_id, message)
		name_bubble_3d_mgr.on_avatar_chat(avatar_id, message)

func handle_avatar_typing(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("avatarId", "")
	name_bubble_mgr.on_avatar_typing(avatar_id, msg.get("typing", false))
	name_bubble_3d_mgr.on_avatar_typing(avatar_id, msg.get("typing", false))

# Self avatar
func set_world_origin(origin_x: float, origin_y: float) -> void:
	world_origin_x = origin_x
	world_origin_y = origin_y
	region_offsets.clear()
	print("[SceneManager] World origin set to (%.0f, %.0f)" % [origin_x, origin_y])

## Store region offset from a terrain_ready or region_info message.
func register_region_offset(cache_id: String, offset_x: float, offset_y: float) -> void:
	region_offsets[cache_id] = Vector2(offset_x, offset_y)

## Get the scene-space offset for a region. Returns Vector2.ZERO for the main region.
func get_region_offset(cache_id: String) -> Vector2:
	return region_offsets.get(cache_id, Vector2.ZERO)

func set_self_avatar_id(id: String) -> void:
	avatar_mgr.set_self_avatar_id(id)

func set_self_avatar_yaw(godot_yaw: float) -> void:
	avatar_mgr.set_self_avatar_yaw(godot_yaw)

func get_self_avatar_click_data() -> Dictionary:
	return avatar_mgr.get_self_avatar_click_data()

func handle_settings(msg: Dictionary) -> void:
	var draw_dist: float = msg.get("draw_distance", 128.0)
	if draw_dist > 0.0:
		_vis_far = draw_dist
		_vis_fade = draw_dist * 0.25
		for rsi in objects.values():
			rsi.set_vis_range(_vis_far, _vis_fade)
		for rsi in avatars.values():
			rsi.set_vis_range(_vis_far, _vis_fade)
		print("[SceneManager] Draw distance set to %.0f m (fade %.0f m)" % [_vis_far, _vis_fade])

func set_vr_mode(enabled: bool) -> void:
	avatar_mgr.set_vr_mode(enabled)
	set_bubble_vr_mode(enabled)

func set_first_person_mode(enabled: bool) -> void:
	avatar_mgr.set_first_person_mode(enabled)

# Animesh
func handle_animations_batch(msg: Dictionary) -> void:
	animation_mgr.handle_animations_batch(msg)

func handle_avatar_shape(msg: Dictionary) -> void:
	avatar_mgr.handle_avatar_shape(msg)

# Assets
func handle_mesh_ready(msg: Dictionary) -> void:
	asset_pipeline.handle_mesh_ready(msg)

func handle_texture_ready(msg: Dictionary) -> void:
	asset_pipeline.handle_texture_ready(msg)

# Terrain / Environment
func handle_terrain_ready(msg: Dictionary) -> void:
	# Register region offset from the terrain message
	var cache_id: String = str(msg.get("cacheID", ""))
	var offset_x: float = float(msg.get("offsetX", 0.0))
	var offset_y: float = float(msg.get("offsetY", 0.0))
	if not cache_id.is_empty():
		register_region_offset(cache_id, offset_x, offset_y)
	terrain_env.handle_terrain_ready(msg)

func handle_environment_data(msg: Dictionary) -> void:
	terrain_env.handle_environment_data(msg)

# Picking / Debug
func pick_object(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	return object_picker.pick_object(ray_origin, ray_dir)

func pick_object_detailed(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	return object_picker.pick_object_detailed(ray_origin, ray_dir)

func get_object_rid(uuid: String) -> RID:
	return object_picker.get_object_rid(uuid)

func get_object_face_info(uuid: String) -> Array:
	return object_picker.get_object_face_info(uuid)

func get_object_debug_info(uuid: String) -> Dictionary:
	return object_picker.get_object_debug_info(uuid)

func set_planar_debug_mode(mode: int) -> void:
	object_picker.set_planar_debug_mode(mode)

func toggle_debug_skeleton() -> void:
	animation_mgr.toggle_debug_skeleton()

## Switch name bubbles to VR mode (3D world-space) or desktop mode (2D overlay).
## Called by set_vr_mode() during init.
func set_bubble_vr_mode(vr: bool) -> void:
	_bubble_2d_active = not vr
	_bubble_3d_active = vr
	if name_bubble_mgr and name_bubble_mgr._canvas_layer:
		name_bubble_mgr._canvas_layer.visible = _bubble_2d_active
	if name_bubble_3d_mgr:
		name_bubble_3d_mgr.set_all_visible(_bubble_3d_active)
	print("[SceneManager] Name bubbles: %s" % ("3D world-space" if vr else "2D screen-space"))

# Stats
func get_pipeline_stats() -> Dictionary:
	return asset_pipeline.get_pipeline_stats()
