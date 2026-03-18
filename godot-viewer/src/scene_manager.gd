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

signal self_avatar_moved(pos: Vector3)
signal object_properties_received(local_id: int, name: String, description: String)

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
		RenderingServer.instance_set_transform(rid, Transform3D(Basis(rot) * Basis.from_scale(effective_scl), adjusted_pos))

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

var objects: Dictionary = {}   # localId (int) -> RSInstance
var avatars: Dictionary = {}   # avatarId (String) -> RSInstance
var self_avatar_id: String = ""

# Interpolation targets
var avatar_targets: Dictionary = {}   # avatarId -> { pos, rot, vel, age }
var object_targets: Dictionary = {}   # localId -> { pos, rot, vel, accel, angVel, age, blend_offset, blend_time }
var avatar_local_ids: Dictionary = {} # avatarId (String) -> localId (int) for skeleton root routing

# Linkset tracking (flat hierarchy — no Godot node parenting to avoid scale inheritance)
var pending_children: Dictionary = {}   # parentLocalId -> Array[childLocalId]
var object_parent: Dictionary = {}      # childLocalId -> parentLocalId
var object_children: Dictionary = {}    # parentLocalId -> Array[childLocalId]
var child_offset_pos: Dictionary = {}   # childLocalId -> Vector3
var child_offset_rot: Dictionary = {}   # childLocalId -> Quaternion
var pending_seated_avatars: Dictionary = {}  # seatLocalId -> Array[{id, pos, rot}]

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
var object_meta: Dictionary = {}          # localId (int) -> { uuid, name, description }
var object_faces: Dictionary = {}         # localId (int) -> Array[face_info dicts]
var texture_load_failed: Dictionary = {}  # textureId (String) -> bool

# Animesh (rigged mesh with skeleton animation)
var animesh_roots: Dictionary = {}         # root localId (int) -> Node3D (scene tree parent)
var animesh_shared_skeleton: Dictionary = {} # root localId (int) -> Skeleton3D (ONE per avatar, from XML)
# animesh_mesh_skeletons removed — all meshes now bind to the shared skeleton
var animesh_root_for: Dictionary = {}      # localId (int) -> root localId (maps object to its animesh root)
var rigged_mesh_paths: Dictionary = {}     # meshId (String) -> GLB path (for generate_scene)
var mesh_joint_overrides: Dictionary = {} # meshId (String) -> Array[String] (joints with custom positions)
var bone_override_owner: Dictionary = {}  # root localId (int) -> Dictionary { boneName -> meshId } (lowest UUID wins)
var bone_shape_scales: Dictionary = {}   # root localId (int) -> Dictionary { boneName -> Vector3 (SL space scale) }
var cv_volume_morphs: Dictionary = {}    # root localId (int) -> Dictionary { cvName -> { scale: Vec3, offset: Vec3 } }
var animesh_anim_data: Dictionary = {}    # animId (String) -> raw Dictionary (with per-joint priorities)
var animesh_pending_anims: Dictionary = {} # root localId (int) -> Array[animId String] (pending animation IDs)
var animesh_worn_anims: Dictionary = {}   # root localId (int) -> Array[animId String] (from worn animesh attachments)
var animesh_mesh_instances: Dictionary = {} # localId (int) -> MeshInstance3D (for texture application)

# Attachment point bone tracking — non-rigged attachments follow their bone each frame
var attach_bone: Dictionary = {}            # localId (int) -> bone name (String) for objects attached to avatar bones
var attach_point_id: Dictionary = {}        # localId (int) -> attachmentPointId (int)
var bone_global_overrides: Dictionary = {}  # root localId (int) -> {bone_name -> Vector3} (global rest positions from meshes)
var _attach_bone_logged: Dictionary = {}    # localId (int) -> true (debug: one-time log flag)

# Skeleton builder — parses avatar_skeleton.xml once, creates shared skeletons
var skeleton_builder: RefCounted

# Manual animation evaluation (replaces AnimationPlayer for correct SL→Godot rotation order)
# SL: world = local * parent.  Godot: world = parent * local.  Must conjugate per bone.
var animesh_eval: Dictionary = {}          # root localId -> {time, duration, loop, joints: {name -> {rot_keys, pos_keys}}}
var animesh_eval_active: bool = false      # true when any animesh has active animation data
var object_mesh_id: Dictionary = {}        # localId (int) -> meshId (String) — persists after mesh loads
var object_uuid: Dictionary = {}           # localId (int) -> UUID (String) — for log correlation

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


## Erase all animesh-related dictionary entries for a given root localId.
## Call after queue_free()ing the root node.
func erase_animesh_state(root_lid: int) -> void:
	animesh_roots.erase(root_lid)
	animesh_shared_skeleton.erase(root_lid)
	animesh_eval.erase(root_lid)
	animesh_pending_anims.erase(root_lid)
	animesh_worn_anims.erase(root_lid)
	bone_global_overrides.erase(root_lid)
	bone_shape_scales.erase(root_lid)
	cv_volume_morphs.erase(root_lid)
	if animesh_eval.is_empty():
		animesh_eval_active = false


func _exit_tree() -> void:
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

	# Skeleton builder — parse avatar_skeleton.xml once
	skeleton_builder = SkeletonBuilderScript.new()
	skeleton_builder.load_from_xml("res://data/avatar_skeleton.xml")

	# Initialize sub-managers
	object_mgr = ObjectManagerScript.new(self)
	animation_mgr = AnimationManagerScript.new(self)
	avatar_mgr = AvatarManagerScript.new(self)
	interp_mgr = InterpolationManagerScript.new(self)
	light_mgr = LightManagerScript.new(self)
	asset_pipeline = AssetPipelineScript.new(self)
	terrain_env = TerrainEnvironmentScript.new(self)
	object_picker = ObjectPickerScript.new(self)

	asset_pipeline.start_threads()

	# Start with opaque black overlay — fade out as assets load
	var fade_layer := CanvasLayer.new()
	fade_layer.layer = 100  # on top of everything
	_fade_overlay = ColorRect.new()
	_fade_overlay.color = Color(0.0, 0.0, 0.0, 1.0)
	_fade_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	fade_layer.add_child(_fade_overlay)
	add_child(fade_layer)


func _process(delta: float) -> void:
	# Terrain/water/sky processing
	terrain_env.process(delta)

	# Interpolate avatar positions/rotations toward their targets
	interp_mgr.interpolate_avatars(delta)

	# Interpolate moving objects (physical objects with velocity)
	interp_mgr.interpolate_objects(delta)

	# Evaluate animesh animations (manual per-frame, not AnimationPlayer)
	if animesh_eval_active:
		animation_mgr.process_animesh(delta)

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

	# Submit queued mesh work to WorkerThreadPool + finalize textures/meshes
	asset_pipeline.finalize_frame(delta, _vr_mode, _target_frame_ms)

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

	# Destroy all object RSInstances
	for local_id: int in objects:
		objects[local_id].destroy()
	objects.clear()

	# Destroy all avatar RSInstances
	for avatar_id: String in avatars:
		avatars[avatar_id].destroy()
	avatars.clear()

	# Destroy all lights
	for local_id: int in light_mgr.object_lights:
		light_mgr.object_lights[local_id].destroy()
	light_mgr.object_lights.clear()
	light_mgr._object_light_data.clear()
	light_mgr._pending_proj_textures.clear()
	light_mgr._light_count = 0

	# Destroy all animesh scene tree nodes (skeletons + mesh instances)
	for local_id: int in animesh_roots:
		var node: Node3D = animesh_roots[local_id]
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
	avatar_local_ids.clear()
	object_targets.clear()
	pending_children.clear()
	object_parent.clear()
	object_children.clear()
	child_offset_pos.clear()
	child_offset_rot.clear()
	pending_seated_avatars.clear()
	object_faces.clear()
	object_meta.clear()
	object_uuid.clear()
	object_mesh_id.clear()
	attach_bone.clear()
	attach_point_id.clear()
	_attach_bone_logged.clear()

	# Clear animesh crossfade blending state
	animation_mgr._prev_sl_local_rot.clear()

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

# Self avatar
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
	terrain_env.handle_terrain_ready(msg)

func handle_environment_data(msg: Dictionary) -> void:
	terrain_env.handle_environment_data(msg)

# Picking / Debug
func pick_object(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	return object_picker.pick_object(ray_origin, ray_dir)

func pick_object_detailed(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	return object_picker.pick_object_detailed(ray_origin, ray_dir)

func get_object_rid(local_id: int) -> RID:
	return object_picker.get_object_rid(local_id)

func get_object_face_info(local_id: int) -> Array:
	return object_picker.get_object_face_info(local_id)

func get_object_debug_info(local_id: int) -> Dictionary:
	return object_picker.get_object_debug_info(local_id)

func set_planar_debug_mode(mode: int) -> void:
	object_picker.set_planar_debug_mode(mode)

func toggle_debug_skeleton() -> void:
	animation_mgr.toggle_debug_skeleton()

# Stats
func get_pipeline_stats() -> Dictionary:
	return asset_pipeline.get_pipeline_stats()
