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

# Animesh (rigged mesh with skeleton animation)
var animesh_roots: Dictionary = {}         # root localId (int) -> Node3D (scene tree parent)
var animesh_shared_skeleton: Dictionary = {} # root localId (int) -> Skeleton3D (ONE per avatar, from XML)
# animesh_mesh_skeletons removed — all meshes now bind to the shared skeleton
var animesh_root_for: Dictionary = {}      # localId (int) -> root localId (maps object to its animesh root)
var rigged_mesh_paths: Dictionary = {}     # meshId (String) -> GLB path (for generate_scene)
var mesh_joint_overrides: Dictionary = {} # meshId (String) -> Array[String] (joints with custom positions)
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
var _vis_far: float = FrameBudget.VISIBILITY_FAR
var _vis_fade: float = FrameBudget.VISIBILITY_FADE_MARGIN

# Periodic stats reporting
var _stats_timer: float = 0.0
const STATS_INTERVAL: float = 10.0

# Loading fog reveal
var _loading_fog_density: float = 0.15   # starting fog density
const _LOADING_FOG_START_DENSITY: float = 0.15
const _LOADING_FOG_FADE_SPEED: float = 0.08  # density units/sec after loading ends

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
	light_mgr = LightManagerScript.new(self)
	asset_pipeline = AssetPipelineScript.new(self)
	terrain_env = TerrainEnvironmentScript.new(self)
	object_picker = ObjectPickerScript.new(self)

	asset_pipeline.start_threads()

	# Start with loading fog
	var world_env: WorldEnvironment = get_node_or_null("../WorldEnvironment")
	if world_env and world_env.environment:
		var env := world_env.environment
		env.fog_enabled = true
		env.fog_density = _LOADING_FOG_START_DENSITY
		env.fog_light_color = Color(0.0, 0.0, 0.0)
		env.fog_light_energy = 0.0
		env.fog_aerial_perspective = 0.5


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
		# Avatar pipeline summary
		var n_shared: int = animesh_shared_skeleton.size()
		var n_roots: int = animesh_roots.size()
		var n_eval: int = animesh_eval.size()
		var n_rigged_paths: int = rigged_mesh_paths.size()
		var n_meshes: int = animesh_mesh_instances.size()
		var self_lid: int = avatar_local_ids.get(self_avatar_id, 0)
		if self_lid > 0 and animesh_shared_skeleton.has(self_lid):
			var skel: Skeleton3D = animesh_shared_skeleton[self_lid]
			print("[SelfAvatar] roots=%d | shared_skels=%d | eval=%d | rigged_meshes=%d | bones=%d" % [
				n_roots, n_shared, n_eval, n_meshes, skel.get_bone_count()])

	# Terrain/water/sky processing
	terrain_env.process(delta)

	# Interpolate avatar positions/rotations toward their targets
	object_mgr.interpolate_avatars(delta)

	# Interpolate moving objects (physical objects with velocity)
	object_mgr.interpolate_objects(delta)

	# Evaluate animesh animations (manual per-frame, not AnimationPlayer)
	if animesh_eval_active:
		object_mgr.process_animesh(delta)

	# Periodic light distance culling sweep
	light_mgr._light_cull_timer += delta
	if light_mgr._light_cull_timer >= light_mgr.LIGHT_CULL_INTERVAL:
		light_mgr._light_cull_timer = 0.0
		light_mgr.sweep_light_culling()

	# Submit queued mesh work to WorkerThreadPool + finalize textures/meshes
	asset_pipeline.finalize_frame(delta, _vr_mode, _target_frame_ms)

	# Loading fog reveal: thick fog that expands as textures/meshes finalize
	if asset_pipeline._initial_loading or _loading_fog_density > 0.0:
		_update_loading_fog(delta)


func _update_loading_fog(delta: float) -> void:
	var world_env: WorldEnvironment = get_node_or_null("../WorldEnvironment")
	if world_env == null or world_env.environment == null:
		return
	var env := world_env.environment

	if asset_pipeline._initial_loading:
		# During loading: reduce density as items finalize (progress-based)
		var done: int = asset_pipeline._tex_finalized_count + asset_pipeline._mesh_finalized_count
		# Ramp from full density → half over the first ~200 items
		var progress: float = clampf(float(done) / 200.0, 0.0, 1.0)
		_loading_fog_density = lerpf(_LOADING_FOG_START_DENSITY, _LOADING_FOG_START_DENSITY * 0.4, progress)
	else:
		# Loading done: fade fog out smoothly
		_loading_fog_density = maxf(0.0, _loading_fog_density - _LOADING_FOG_FADE_SPEED * delta)
		if _loading_fog_density <= 0.001:
			_loading_fog_density = 0.0
			env.fog_enabled = false
			return

	env.fog_density = _loading_fog_density


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

# Animesh
func handle_animations_batch(msg: Dictionary) -> void:
	object_mgr.handle_animations_batch(msg)

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

# Stats
func get_pipeline_stats() -> Dictionary:
	return asset_pipeline.get_pipeline_stats()
