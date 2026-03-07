extends Node3D

## Manages in-world objects and avatars as lightweight RenderingServer RIDs.
## Coordinate conversion: SL (X=East, Y=North, Z=Up) -> Godot (X=Right, Y=Up, Z=-Forward)
##   Position: (sl.x, sl.z, -sl.y)
##   Quaternion: (sl.x, sl.z, -sl.y, sl.w)

const FrameBudget = preload("res://src/frame_budget.gd")
const PrimMeshGeneratorScript = preload("res://src/prim_mesh_generator.gd")
const ObjectManagerScript = preload("res://src/object_manager.gd")
const LightManagerScript = preload("res://src/light_manager.gd")
const AssetPipelineScript = preload("res://src/asset_pipeline.gd")
const TerrainEnvironmentScript = preload("res://src/terrain_environment.gd")
const ObjectPickerScript = preload("res://src/object_picker.gd")

signal self_avatar_moved(pos: Vector3)
signal object_properties_received(local_id: int, name: String, description: String)

## Lightweight RefCounted wrapper around a RenderingServer instance RID.
## Replaces MeshInstance3D nodes to eliminate scene tree overhead.
class RSInstance extends RefCounted:
	var rid: RID
	var pos: Vector3 = Vector3.ZERO
	var rot: Quaternion = Quaternion.IDENTITY
	var scl: Vector3 = Vector3.ONE
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
		RenderingServer.instance_set_transform(rid, Transform3D(Basis(rot) * Basis.from_scale(scl), pos))

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

# Linkset tracking (flat hierarchy — no Godot node parenting to avoid scale inheritance)
var pending_children: Dictionary = {}   # parentLocalId -> Array[childLocalId]
var object_parent: Dictionary = {}      # childLocalId -> parentLocalId
var object_children: Dictionary = {}    # parentLocalId -> Array[childLocalId]
var child_offset_pos: Dictionary = {}   # childLocalId -> Vector3
var child_offset_rot: Dictionary = {}   # childLocalId -> Quaternion

# Shared mesh resources
var object_mesh: BoxMesh
var avatar_mesh: BoxMesh
var object_material: StandardMaterial3D
var avatar_material: StandardMaterial3D

# Mesh pipeline
var pending_meshes: Dictionary = {}    # localId (int) -> meshId (String)
var mesh_cache: Dictionary = {}        # meshId (String) -> Mesh resource
var mesh_load_failed: Dictionary = {}  # meshId (String) -> bool

# Texture pipeline
var texture_cache: Dictionary = {}        # textureId (String) -> ImageTexture
var material_cache: Dictionary = {}       # "uuid_colorhex_fb_ds_uv" (String) -> StandardMaterial3D
var object_meta: Dictionary = {}          # localId (int) -> { uuid, name, description }
var object_faces: Dictionary = {}         # localId (int) -> Array[face_info dicts]
var pending_textures: Dictionary = {}     # localId (int) -> Array[{ faceIndex, textureId, color, ... }]
var texture_load_failed: Dictionary = {}  # textureId (String) -> bool

# Reverse indices
var _pending_by_texture: Dictionary = {}  # textureId -> Array[{ localId, faceInfo }]
var _pending_by_mesh: Dictionary = {}     # meshId -> Array[localId]

# Prim geometry generator
var prim_generator: RefCounted

# Cached scenario RID for RSInstance creation
var _scenario: RID
var _target_frame_ms: float = FrameBudget.DESKTOP_FRAME_MS
var _vr_mode: bool = false
var _vis_far: float = FrameBudget.VISIBILITY_FAR
var _vis_fade: float = FrameBudget.VISIBILITY_FADE_MARGIN

# Periodic stats reporting
var _stats_timer: float = 0.0
const STATS_INTERVAL: float = 10.0

# ─── Sub-managers ────────────────────────────────────

var object_mgr: RefCounted      # ObjectManager
var light_mgr: RefCounted       # LightManager
var asset_pipeline: RefCounted  # AssetPipeline
var terrain_env: RefCounted     # TerrainEnvironment
var object_picker: RefCounted   # ObjectPicker


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
	avatar_mesh.size = Vector3(0.5, 1.8, 0.5)  # Roughly avatar shaped

	# Gray material for objects
	object_material = StandardMaterial3D.new()
	object_material.albedo_color = Color(0.6, 0.6, 0.6)

	# Blue material for avatars
	avatar_material = StandardMaterial3D.new()
	avatar_material.albedo_color = Color(0.3, 0.5, 0.9)

	# Prim geometry generator
	prim_generator = PrimMeshGeneratorScript.new()

	# Initialize sub-managers
	object_mgr = ObjectManagerScript.new(self)
	light_mgr = LightManagerScript.new(self)
	asset_pipeline = AssetPipelineScript.new(self)
	terrain_env = TerrainEnvironmentScript.new(self)
	object_picker = ObjectPickerScript.new(self)

	asset_pipeline.start_threads()


func _process(delta: float) -> void:
	# Periodic VRAM / scene stats (skipped in VR — no console visible, avoid driver stalls)
	_stats_timer += delta
	if _stats_timer >= STATS_INTERVAL and not _vr_mode:
		_stats_timer = 0.0
		var tex_mem: int = 0
		var buf_mem: int = 0
		var rd := RenderingServer.get_rendering_device()
		if rd:
			tex_mem = rd.get_memory_usage(RenderingDevice.MEMORY_TEXTURES)
			buf_mem = rd.get_memory_usage(RenderingDevice.MEMORY_BUFFERS)
		print("[Stats] VRAM: tex=%.1fMB buf=%.1fMB | Objects: %d | Avatars: %d | Lights: %d/%d | Tex cache: %d | Mat cache: %d | Mesh cache: %d | FPS: %.0f" % [
			tex_mem / 1048576.0, buf_mem / 1048576.0,
			objects.size(), avatars.size(), light_mgr._light_count, light_mgr._object_light_data.size(),
			texture_cache.size(), material_cache.size(), mesh_cache.size(),
			Engine.get_frames_per_second()])

	# Terrain/water/sky processing
	terrain_env.process(delta)

	# Interpolate avatar positions/rotations toward their targets
	object_mgr.interpolate_avatars(delta)

	# Interpolate moving objects (physical objects with velocity)
	object_mgr.interpolate_objects(delta)

	# Periodic light distance culling sweep
	light_mgr._light_cull_timer += delta
	if light_mgr._light_cull_timer >= light_mgr.LIGHT_CULL_INTERVAL:
		light_mgr._light_cull_timer = 0.0
		light_mgr.sweep_light_culling()

	# Submit queued mesh work to WorkerThreadPool + finalize textures/meshes
	asset_pipeline.finalize_frame(delta, _vr_mode, _target_frame_ms)


# ─── Public API (delegates to sub-managers) ──────────

# Coordinate conversion (exposed for external callers)
func sl_to_godot_pos(sl_pos: Array) -> Vector3:
	return object_mgr.sl_to_godot_pos(sl_pos)

func sl_to_godot_quat(sl_rot: Array) -> Quaternion:
	return object_mgr.sl_to_godot_quat(sl_rot)

func sl_to_godot_scale(sl_scale: Array) -> Vector3:
	return object_mgr.sl_to_godot_scale(sl_scale)

# Objects
func handle_object_create(msg: Dictionary) -> void:
	object_mgr.handle_object_create(msg)

func handle_object_update_batch(msg: Dictionary) -> void:
	object_mgr.handle_object_update_batch(msg)

func handle_update_faces(msg: Dictionary) -> void:
	object_mgr.handle_update_faces(msg)

func handle_object_kill(msg: Dictionary) -> void:
	object_mgr.handle_object_kill(msg)

func handle_object_properties(msg: Dictionary) -> void:
	object_picker.handle_object_properties(msg)

# Avatars
func handle_avatar_create(msg: Dictionary) -> void:
	object_mgr.handle_avatar_create(msg)

func handle_avatar_update(msg: Dictionary) -> void:
	object_mgr.handle_avatar_update(msg)

func handle_avatar_update_batch(msg: Dictionary) -> void:
	object_mgr.handle_avatar_update_batch(msg)

func handle_avatar_kill(msg: Dictionary) -> void:
	object_mgr.handle_avatar_kill(msg)

# Self avatar
func set_self_avatar_id(id: String) -> void:
	object_mgr.set_self_avatar_id(id)

func set_self_avatar_yaw(godot_yaw: float) -> void:
	object_mgr.set_self_avatar_yaw(godot_yaw)

func get_self_avatar_click_data() -> Dictionary:
	return object_mgr.get_self_avatar_click_data()

func set_vr_mode(enabled: bool) -> void:
	object_mgr.set_vr_mode(enabled)

func set_first_person_mode(enabled: bool) -> void:
	object_mgr.set_first_person_mode(enabled)

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

func get_object_rid(local_id: int) -> RID:
	return object_picker.get_object_rid(local_id)

func get_object_face_info(local_id: int) -> Array:
	return object_picker.get_object_face_info(local_id)

func get_object_debug_info(local_id: int) -> Dictionary:
	return object_picker.get_object_debug_info(local_id)

func set_planar_debug_mode(mode: int) -> void:
	object_picker.set_planar_debug_mode(mode)

# Stats
func get_pipeline_stats() -> Dictionary:
	return asset_pipeline.get_pipeline_stats()
