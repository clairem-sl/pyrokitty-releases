extends RefCounted

## Object picker: Phase 1 (physics trimesh) for face/UV detail on static meshes,
## Phase 2 (GPU ID-buffer) for pixel-perfect identification of all meshes including skinned.

var sm  # scene_manager reference

const PICK_LAYER: int = 1 << 20       # Collision layer bit 20 (physics, isolated from game)
const PICK_RENDER_LAYER: int = 1 << 20  # Render layer bit 20 (outside default Camera3D cull_mask 0xFFFFF)
const MAX_PICK_DIST: float = 200.0

# ─── Phase 1: Physics body tracking ─────────────────────
var _body_to_uuid: Dictionary = {}     # body RID get_id() (int) -> UUID (String)
var _uuid_to_body: Dictionary = {}     # UUID (String) -> body RID
var _mesh_shape_cache: Dictionary = {} # cache_key (String) -> ConcavePolygonShape3D
var _mesh_tri_map: Dictionary = {}     # cache_key (String) -> Array of [surface_idx, tri_in_surface]
var _uuid_to_cache_key: Dictionary = {} # UUID (String) -> cache_key (String)

# ─── Phase 2: GPU ID-buffer ─────────────────────────────
var _pick_viewport: SubViewport
var _pick_camera: Camera3D
var _id_shader: Shader
var _next_id: int = 1                  # 0 = background (no hit), reserved
var _id_to_uuid: Dictionary = {}       # numeric_id (int) -> UUID (String)
var _uuid_to_id: Dictionary = {}       # UUID (String) -> numeric_id (int)
var _uuid_to_pick_rid: Dictionary = {} # UUID (String) -> duplicate RS instance RID (static objects)
var _uuid_to_pick_mi: Dictionary = {}  # UUID (String) -> MeshInstance3D (skinned objects under Skeleton3D)
var _pick_materials: Dictionary = {}   # UUID (String) -> ShaderMaterial (prevent GC)
var _debug_layer: CanvasLayer
var _debug_rect: TextureRect

# ─── Hover highlight ───────────────────────────────────
var _highlight_mat: StandardMaterial3D
var _highlight_uuid: String = ""


func _init(scene_manager) -> void:
	sm = scene_manager
	_setup_id_buffer.call_deferred()


## Deferred setup — scene_manager must be in the tree before we add children.
func _setup_id_buffer() -> void:
	# ID shader: 24-bit object ID as RGB. No depth — physics provides distance.
	_id_shader = Shader.new()
	_id_shader.code = "shader_type spatial;\nrender_mode unshaded, cull_back, depth_draw_opaque, fog_disabled;\nuniform vec3 id_color;\nvoid fragment() { ALBEDO = id_color; }\n"

	# SubViewport: shared world, 1/4 resolution, renders every frame.
	# No AA — edge blending would corrupt ID colors.
	# UPDATE_ALWAYS instead of on-demand force_draw — force_draw inside _process
	# breaks OpenXR frame ordering (XR_ERROR_CALL_ORDER_INVALID → device lost).
	_pick_viewport = SubViewport.new()
	_pick_viewport.name = "PickViewport"
	_pick_viewport.world_3d = sm.get_world_3d()
	var main_size: Vector2i = sm.get_viewport().size
	_pick_viewport.size = Vector2i(maxi(main_size.x / 4, 64), maxi(main_size.y / 4, 64))
	_pick_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_pick_viewport.msaa_3d = Viewport.MSAA_DISABLED
	_pick_viewport.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	_pick_viewport.use_taa = false
	_pick_viewport.transparent_bg = false
	sm.add_child(_pick_viewport)

	# Camera3D inside the SubViewport for rendering + unproject_position().
	_pick_camera = Camera3D.new()
	_pick_camera.name = "PickCamera"
	_pick_camera.cull_mask = PICK_RENDER_LAYER
	_pick_camera.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	var pick_env := Environment.new()
	pick_env.background_mode = Environment.BG_COLOR
	pick_env.background_color = Color.BLACK
	pick_env.ambient_light_source = Environment.AMBIENT_SOURCE_DISABLED
	pick_env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	_pick_camera.environment = pick_env
	_pick_viewport.add_child(_pick_camera)

	# Debug overlay — hidden by default, toggle with toggle_pick_debug()
	_debug_layer = CanvasLayer.new()
	_debug_layer.layer = 99
	_debug_layer.visible = false
	_debug_rect = TextureRect.new()
	_debug_rect.texture = _pick_viewport.get_texture()
	_debug_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT
	_debug_rect.custom_minimum_size = Vector2(320, 180)
	_debug_rect.position = Vector2(10, 10)
	_debug_layer.add_child(_debug_rect)
	sm.add_child(_debug_layer)

	# Hover highlight: additive blue glow overlay
	_highlight_mat = StandardMaterial3D.new()
	_highlight_mat.albedo_color = Color(0.15, 0.3, 0.8, 0.35)
	_highlight_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_highlight_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED


## Mirror main camera to pick camera. Call from scene_manager._process() each frame.
## Desktop default — ray originates from camera so projection is parallax-free.
## VR overrides this with update_pick_camera_ray() from xr_rig before pick.
var _pick_ray_aligned: bool = false

func update_pick_camera() -> void:
	if _pick_camera == null or _pick_viewport == null:
		return
	var main_cam: Camera3D = sm.get_viewport().get_camera_3d()
	if main_cam == null:
		return
	_pick_camera.global_transform = main_cam.global_transform
	_pick_camera.fov = main_cam.fov
	_pick_camera.near = main_cam.near
	_pick_camera.far = main_cam.far
	_pick_ray_aligned = false
	var main_size: Vector2i = sm.get_viewport().size
	var pick_size := Vector2i(maxi(main_size.x / 4, 64), maxi(main_size.y / 4, 64))
	if _pick_viewport.size != pick_size:
		_pick_viewport.size = pick_size


## Aim pick camera along a ray. Call from xr_rig._update_laser() each frame AFTER
## update_pick_camera() so it overrides the mirror. On pick, center pixel = hit.
## No force_draw — reads previous frame's render (1 frame ≈ 14ms at 72Hz).
func update_pick_camera_ray(ray_origin: Vector3, ray_dir: Vector3) -> void:
	if _pick_camera == null:
		return
	var up := Vector3.FORWARD if absf(ray_dir.dot(Vector3.UP)) > 0.99 else Vector3.UP
	_pick_camera.global_transform = Transform3D(Basis.looking_at(ray_dir, up), ray_origin)
	_pick_camera.near = 0.05
	_pick_camera.far = MAX_PICK_DIST
	_pick_ray_aligned = true


## Create a static physics body with trimesh shape for an object.
func _create_pick_body(obj_uuid: String, mesh: Mesh, mesh_id: String, rsi) -> void:
	if _uuid_to_body.has(obj_uuid):
		_destroy_pick_body(obj_uuid)

	if mesh == null:
		return

	var cache_key: String = mesh_id if not mesh_id.is_empty() else str(mesh.get_rid().get_id())

	# Get or create trimesh shape
	var shape: ConcavePolygonShape3D
	if _mesh_shape_cache.has(cache_key):
		shape = _mesh_shape_cache[cache_key]
	else:
		shape = mesh.create_trimesh_shape()
		if shape == null:
			return
		_mesh_shape_cache[cache_key] = shape
		_mesh_tri_map[cache_key] = _build_tri_map(mesh)

	_uuid_to_cache_key[obj_uuid] = cache_key

	# Create static body
	var body: RID = PhysicsServer3D.body_create()
	PhysicsServer3D.body_set_mode(body, PhysicsServer3D.BODY_MODE_STATIC)
	PhysicsServer3D.body_add_shape(body, shape.get_rid())
	PhysicsServer3D.body_set_collision_layer(body, PICK_LAYER)
	PhysicsServer3D.body_set_collision_mask(body, 0)

	# Set initial transform to match RSInstance
	var effective_scl: Vector3 = rsi.scl / rsi.scl_divisor
	var adjusted_pos: Vector3 = rsi.pos - Basis(rsi.rot) * (effective_scl * rsi.scl_center)
	var xform := Transform3D(Basis(rsi.rot) * Basis.from_scale(effective_scl), adjusted_pos)
	PhysicsServer3D.body_set_state(body, PhysicsServer3D.BODY_STATE_TRANSFORM, xform)

	# Add to physics space
	PhysicsServer3D.body_set_space(body, sm.get_world_3d().space)

	# Track
	_body_to_uuid[body.get_id()] = obj_uuid
	_uuid_to_body[obj_uuid] = body

	# Callback wired separately via _wire_transform_callback


## Destroy the physics body for an object.
func _destroy_pick_body(obj_uuid: String) -> void:
	if not _uuid_to_body.has(obj_uuid):
		return
	var body: RID = _uuid_to_body[obj_uuid]
	_body_to_uuid.erase(body.get_id())
	_uuid_to_body.erase(obj_uuid)
	_uuid_to_cache_key.erase(obj_uuid)
	PhysicsServer3D.free_rid(body)


## Bulk destroy all physics bodies (region change).
func destroy_all_pick_bodies() -> void:
	for obj_uuid: String in _uuid_to_body.keys():
		PhysicsServer3D.free_rid(_uuid_to_body[obj_uuid])
	_body_to_uuid.clear()
	_uuid_to_body.clear()
	_uuid_to_cache_key.clear()
	_mesh_shape_cache.clear()
	_mesh_tri_map.clear()


# ─── Phase 2: GPU ID-buffer instance lifecycle ──────────
# Static objects get lightweight RS instance duplicates.
# Skinned objects get MeshInstance3D under the Skeleton3D (GPU skins both identically).

## Allocate a numeric ID for an object, or return existing one.
func _alloc_id(obj_uuid: String) -> int:
	if _uuid_to_id.has(obj_uuid):
		return _uuid_to_id[obj_uuid]
	var numeric_id: int = _next_id
	_next_id += 1
	_id_to_uuid[numeric_id] = obj_uuid
	_uuid_to_id[obj_uuid] = numeric_id
	return numeric_id


## Create an ID-color ShaderMaterial for a given numeric ID.
func _create_id_material(numeric_id: int) -> ShaderMaterial:
	var mat := ShaderMaterial.new()
	mat.shader = _id_shader
	mat.set_shader_parameter("id_color", Color(
		float((numeric_id >> 16) & 0xFF) / 255.0,
		float((numeric_id >> 8) & 0xFF) / 255.0,
		float(numeric_id & 0xFF) / 255.0,
	))
	return mat


## Create an RS instance duplicate for a static (non-skinned) object.
func _create_pick_instance(obj_uuid: String, mesh: Mesh, rsi) -> void:
	if mesh == null:
		return
	_destroy_pick_instance(obj_uuid)

	var numeric_id: int = _alloc_id(obj_uuid)

	# Duplicate RS instance — same mesh, pick render layer only
	var dup: RID = RenderingServer.instance_create()
	RenderingServer.instance_set_scenario(dup, sm._scenario)
	RenderingServer.instance_set_base(dup, mesh.get_rid())
	RenderingServer.instance_set_layer_mask(dup, PICK_RENDER_LAYER)

	# Set initial transform
	var effective_scl: Vector3 = rsi.scl / rsi.scl_divisor
	var adjusted_pos: Vector3 = rsi.pos - Basis(rsi.rot) * (effective_scl * rsi.scl_center)
	var xform := Transform3D(Basis(rsi.rot) * Basis.from_scale(effective_scl), adjusted_pos)
	RenderingServer.instance_set_transform(dup, xform)

	# ID material
	var mat := _create_id_material(numeric_id)
	RenderingServer.instance_geometry_set_material_override(dup, mat.get_rid())

	# Track
	_uuid_to_pick_rid[obj_uuid] = dup
	_pick_materials[obj_uuid] = mat  # prevent GC


## Create a skinned pick instance as MeshInstance3D under a Skeleton3D.
## The GPU skins this identically to the visible mesh — pixel-perfect deformed picking.
## Replaces any existing static RS pick instance. Physics body is kept for face/UV detail.
func create_pick_instance_skinned(obj_uuid: String, mesh: Mesh, skin: Skin, skeleton: Skeleton3D) -> void:
	if mesh == null or skeleton == null:
		return
	_destroy_pick_body(obj_uuid)
	_destroy_pick_instance(obj_uuid)
	# Clear the stale transform callback — physics body is gone and the skinned
	# MI follows the skeleton automatically.
	var rsi = sm.objects.get(obj_uuid)
	if rsi != null:
		rsi.on_transform_pushed = Callable()

	var numeric_id: int = _alloc_id(obj_uuid)

	var mi := MeshInstance3D.new()
	mi.name = "PickID_%d" % numeric_id
	mi.mesh = mesh
	mi.skin = skin
	mi.layers = PICK_RENDER_LAYER
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	mi.transform = Transform3D.IDENTITY

	var mat := _create_id_material(numeric_id)
	mi.material_override = mat

	skeleton.add_child(mi)
	mi.skeleton = mi.get_path_to(skeleton)

	_uuid_to_pick_mi[obj_uuid] = mi
	_pick_materials[obj_uuid] = mat


## Destroy any pick instance (RS or MeshInstance3D) for an object.
func _destroy_pick_instance(obj_uuid: String) -> void:
	if _uuid_to_pick_rid.has(obj_uuid):
		RenderingServer.free_rid(_uuid_to_pick_rid[obj_uuid])
		_uuid_to_pick_rid.erase(obj_uuid)
	if _uuid_to_pick_mi.has(obj_uuid):
		var mi = _uuid_to_pick_mi[obj_uuid]
		if is_instance_valid(mi):
			mi.queue_free()
		_uuid_to_pick_mi.erase(obj_uuid)
	if _uuid_to_id.has(obj_uuid):
		_id_to_uuid.erase(_uuid_to_id[obj_uuid])
		_uuid_to_id.erase(obj_uuid)
	_pick_materials.erase(obj_uuid)


## Bulk destroy all pick instances (region change).
func destroy_all_pick_instances() -> void:
	for obj_uuid: String in _uuid_to_pick_rid.keys():
		RenderingServer.free_rid(_uuid_to_pick_rid[obj_uuid])
	_uuid_to_pick_rid.clear()
	for obj_uuid: String in _uuid_to_pick_mi.keys():
		var mi = _uuid_to_pick_mi[obj_uuid]
		if is_instance_valid(mi):
			mi.queue_free()
	_uuid_to_pick_mi.clear()
	_id_to_uuid.clear()
	_uuid_to_id.clear()
	_pick_materials.clear()
	_next_id = 1


# ─── Combined lifecycle ─────────────────────────────────

## Create physics body + static RS pick instance for a non-skinned object,
## then wire the combined transform callback.
func create_pick_resources(obj_uuid: String, mesh: Mesh, mesh_id: String, rsi) -> void:
	_create_pick_body(obj_uuid, mesh, mesh_id, rsi)
	_create_pick_instance(obj_uuid, mesh, rsi)
	_wire_transform_callback(obj_uuid, rsi)


## Destroy all pick resources (physics body + pick instance), clear RSInstance callback.
func destroy_pick_resources(obj_uuid: String) -> void:
	var rsi = sm.objects.get(obj_uuid)
	if rsi != null:
		rsi.on_transform_pushed = Callable()
	_destroy_pick_body(obj_uuid)
	_destroy_pick_instance(obj_uuid)


## Destroy all pick resources (region change).
func destroy_all_pick_resources() -> void:
	destroy_all_pick_bodies()
	destroy_all_pick_instances()


## Wire a single on_transform_pushed callback that syncs both physics body and
## static RS pick instance. Skinned MeshInstance3D pick instances don't need this
## — they follow the skeleton automatically.
func _wire_transform_callback(obj_uuid: String, rsi) -> void:
	var body: RID = _uuid_to_body.get(obj_uuid, RID())
	var dup: RID = _uuid_to_pick_rid.get(obj_uuid, RID())
	rsi.on_transform_pushed = func(xf: Transform3D) -> void:
		if body.is_valid():
			PhysicsServer3D.body_set_state(body, PhysicsServer3D.BODY_STATE_TRANSFORM, xf)
		if dup.is_valid():
			RenderingServer.instance_set_transform(dup, xf)


## Build mapping from flat triangle index to [surface_idx, tri_within_surface].
## Matches Mesh.get_faces() ordering used by create_trimesh_shape().
func _build_tri_map(mesh: Mesh) -> Array:
	var tri_map: Array = []
	for si: int in range(mesh.get_surface_count()):
		if mesh.surface_get_primitive_type(si) != Mesh.PRIMITIVE_TRIANGLES:
			continue
		var arrays: Array = mesh.surface_get_arrays(si)
		if arrays.size() == 0:
			continue
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var indices = arrays[Mesh.ARRAY_INDEX]
		var tri_count: int = 0
		if indices != null and indices.size() >= 3:
			tri_count = indices.size() / 3
		elif verts.size() >= 3:
			tri_count = verts.size() / 3
		for ti: int in range(tri_count):
			tri_map.append([si, ti])
	return tri_map


# ─── Hover highlight ───────────────────────────────────

## Apply a material overlay to the hovered object. Handles both RS instances (static)
## and MeshInstance3D (skinned). Call with "" to clear.
func set_hover_highlight(obj_uuid: String) -> void:
	if obj_uuid == _highlight_uuid:
		return
	# Remove old highlight
	if not _highlight_uuid.is_empty():
		var old_rsi = sm.objects.get(_highlight_uuid)
		if old_rsi != null:
			RenderingServer.instance_geometry_set_material_overlay(old_rsi.rid, RID())
		var old_mi = sm.animesh_mesh_instances.get(_highlight_uuid)
		if old_mi != null and is_instance_valid(old_mi):
			old_mi.material_overlay = null
	_highlight_uuid = obj_uuid
	# Apply new highlight
	if not obj_uuid.is_empty():
		var rsi = sm.objects.get(obj_uuid)
		if rsi != null:
			RenderingServer.instance_geometry_set_material_overlay(rsi.rid, _highlight_mat.get_rid())
		var mi = sm.animesh_mesh_instances.get(obj_uuid)
		if mi != null and is_instance_valid(mi):
			mi.material_overlay = _highlight_mat


# ─── Picking API ────────────────────────────────────────

## Pick an object. ID buffer for identification, physics for exact distance.
## ID buffer depth (8-bit) is a fallback when physics misses (skinned meshes).
func pick_object(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	var id_result := _pick_id_buffer(ray_origin, ray_dir)
	var phys := _pick_physics(ray_origin, ray_dir)
	if not id_result.is_empty():
		if not phys.is_empty() and phys["uuid"] == id_result["uuid"]:
			id_result["distance"] = phys["distance"]
		return id_result
	if not phys.is_empty():
		return phys
	return {}


## Detailed pick: ID buffer for identification, physics for face/UV detail on
## the identified object. Falls back to physics-only if ID buffer misses.
func pick_object_detailed(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	var id_result := _pick_id_buffer(ray_origin, ray_dir)
	if id_result.is_empty():
		return _pick_physics_detailed(ray_origin, ray_dir)
	# ID buffer hit — try physics for face/UV detail on this specific object
	var detail := _pick_physics_detailed(ray_origin, ray_dir)
	if not detail.is_empty() and detail["uuid"] == id_result["uuid"]:
		return detail
	# Physics missed or hit a different object — try CPU skinned ray-mesh test
	var skinned := _pick_skinned_detailed(ray_origin, ray_dir, id_result["uuid"])
	if not skinned.is_empty():
		return skinned
	# No detail available — return ID with defaults
	return {
		"uuid": id_result["uuid"],
		"distance": id_result["distance"],
		"faceIndex": 0,
		"st": Vector2.ZERO,
		"normal": Vector3.UP,
		"hitPosLocal": Vector3.ZERO,
	}


## ID buffer pick: read the continuously-rendered pick viewport texture.
## - VR (ray-aligned): camera aimed along controller ray → read center pixel.
## - Desktop (mirrored): camera mirrors main cam → project ray to find pixel.
## No force_draw — reads previous frame's render. Avoids OpenXR crash.
func _pick_id_buffer(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	if _pick_camera == null or _pick_viewport == null:
		return {}
	var img: Image = _pick_viewport.get_texture().get_image()
	if img == null:
		return {}
	var px: int
	var py: int
	if _pick_ray_aligned:
		# Camera was aimed along the ray — center pixel is the answer
		px = img.get_width() / 2
		py = img.get_height() / 2
	else:
		# Camera mirrors main cam — project ray into screen space
		var world_pt: Vector3 = ray_origin + ray_dir * 10.0
		if _pick_camera.is_position_behind(world_pt):
			return {}
		var screen: Vector2 = _pick_camera.unproject_position(world_pt)
		px = clampi(int(screen.x), 0, img.get_width() - 1)
		py = clampi(int(screen.y), 0, img.get_height() - 1)
	var c: Color = img.get_pixel(px, py)
	var numeric_id: int = (int(c.r8) << 16) | (int(c.g8) << 8) | int(c.b8)
	if numeric_id == 0 or not _id_to_uuid.has(numeric_id):
		return {}
	var obj_uuid: String = _id_to_uuid[numeric_id]
	var dist: float = _estimate_distance(ray_origin, ray_dir, obj_uuid)
	return { "uuid": obj_uuid, "distance": dist }


## Estimate distance to an object along a ray. For skinned meshes, finds the
## nearest skeleton bone to the ray (tracks the actual deformed position).
## For other objects, uses the RSInstance position.
func _estimate_distance(ray_origin: Vector3, ray_dir: Vector3, obj_uuid: String) -> float:
	var root_uuid: String = sm.animesh_root_for.get(obj_uuid, "")
	if not root_uuid.is_empty():
		var skel: Skeleton3D = sm.animesh_shared_skeleton.get(root_uuid)
		if skel != null and is_instance_valid(skel):
			return _nearest_bone_distance(ray_origin, ray_dir, skel)
	var rsi = sm.objects.get(obj_uuid)
	return ray_origin.distance_to(rsi.pos) if rsi != null else MAX_PICK_DIST


## Find the distance from ray_origin to the skeleton bone nearest to the ray.
## Projects each bone's world position onto the ray and returns the distance
## to the closest one. 159 bones = trivial cost.
func _nearest_bone_distance(ray_origin: Vector3, ray_dir: Vector3, skeleton: Skeleton3D) -> float:
	var best_dist: float = MAX_PICK_DIST
	var best_ray_dist: float = MAX_PICK_DIST
	var bone_count: int = skeleton.get_bone_count()
	var skel_xform: Transform3D = skeleton.global_transform
	for bi: int in range(bone_count):
		var bone_world: Vector3 = skel_xform * skeleton.get_bone_global_pose(bi).origin
		# Project bone onto ray: t = dot(bone - origin, dir)
		var t: float = (bone_world - ray_origin).dot(ray_dir)
		if t < 0.0:
			continue  # behind the camera
		# Perpendicular distance from bone to ray
		var closest_on_ray: Vector3 = ray_origin + ray_dir * t
		var perp_dist: float = bone_world.distance_to(closest_on_ray)
		if perp_dist < best_dist:
			best_dist = perp_dist
			best_ray_dist = t
	return best_ray_dist


## CPU skinned ray-mesh test. Skins the mesh vertices using current bone transforms,
## then ray-triangle tests for exact hit position, face, UV, and normal.
## Only called when physics misses a skinned mesh (deformed away from bind pose).
func _pick_skinned_detailed(ray_origin: Vector3, ray_dir: Vector3, obj_uuid: String) -> Dictionary:
	var mi: MeshInstance3D = _uuid_to_pick_mi.get(obj_uuid)
	if mi == null or not is_instance_valid(mi):
		return {}
	var mesh: Mesh = mi.mesh
	var skin: Skin = mi.skin
	if mesh == null or skin == null:
		return {}
	var skel_node: Node3D = mi.get_parent()
	if not skel_node is Skeleton3D:
		return {}
	var skeleton: Skeleton3D = skel_node as Skeleton3D
	var skel_xform: Transform3D = skeleton.global_transform

	# Pre-compute bone world transforms (skeleton global * bone global pose)
	var bone_count: int = skeleton.get_bone_count()
	var bone_xforms: Array[Transform3D] = []
	bone_xforms.resize(bone_count)
	for bi: int in range(bone_count):
		bone_xforms[bi] = skel_xform * skeleton.get_bone_global_pose(bi)

	# Build skin bind-bone-index → skeleton-bone-index map + inverse bind poses
	var bind_count: int = skin.get_bind_count()
	var bind_bone_idx: PackedInt32Array = PackedInt32Array()
	var bind_inv_pose: Array[Transform3D] = []
	bind_bone_idx.resize(bind_count)
	bind_inv_pose.resize(bind_count)
	for i: int in range(bind_count):
		bind_bone_idx[i] = skin.get_bind_bone(i)
		bind_inv_pose[i] = skin.get_bind_pose(i)

	var best_t: float = MAX_PICK_DIST
	var best_surface: int = -1
	var best_bary := Vector3.ZERO
	var best_i0: int = 0
	var best_i1: int = 0
	var best_i2: int = 0
	var best_arrays: Array = []

	for si: int in range(mesh.get_surface_count()):
		if mesh.surface_get_primitive_type(si) != Mesh.PRIMITIVE_TRIANGLES:
			continue
		var arrays: Array = mesh.surface_get_arrays(si)
		if arrays.size() == 0:
			continue
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var indices = arrays[Mesh.ARRAY_INDEX]
		var bones_arr = arrays[Mesh.ARRAY_BONES]
		var weights_arr = arrays[Mesh.ARRAY_WEIGHTS]
		if bones_arr == null or weights_arr == null:
			continue

		# Skin all vertices for this surface
		var vert_count: int = verts.size()
		var skinned: PackedVector3Array = PackedVector3Array()
		skinned.resize(vert_count)
		var weights_per_vert: int = weights_arr.size() / vert_count if vert_count > 0 else 4
		for vi: int in range(vert_count):
			var pos := Vector3.ZERO
			var base: int = vi * weights_per_vert
			for wi: int in range(weights_per_vert):
				var w: float = weights_arr[base + wi]
				if w < 0.001:
					continue
				var bind_idx: int = bones_arr[base + wi]
				if bind_idx < 0 or bind_idx >= bind_count:
					continue
				var skel_bi: int = bind_bone_idx[bind_idx]
				if skel_bi < 0 or skel_bi >= bone_count:
					continue
				pos += (bone_xforms[skel_bi] * bind_inv_pose[bind_idx] * verts[vi]) * w
			skinned[vi] = pos

		# Ray-triangle test against skinned vertices
		var tri_count: int = 0
		if indices != null and indices.size() >= 3:
			tri_count = indices.size() / 3
		elif vert_count >= 3:
			tri_count = vert_count / 3
		for ti: int in range(tri_count):
			var i0: int; var i1: int; var i2: int
			if indices != null and indices.size() >= (ti + 1) * 3:
				i0 = indices[ti * 3]
				i1 = indices[ti * 3 + 1]
				i2 = indices[ti * 3 + 2]
			else:
				i0 = ti * 3
				i1 = ti * 3 + 1
				i2 = ti * 3 + 2
			if i2 >= skinned.size():
				continue
			var v0: Vector3 = skinned[i0]
			var v1: Vector3 = skinned[i1]
			var v2: Vector3 = skinned[i2]
			# Moller-Trumbore ray-triangle intersection
			var edge1 := v1 - v0
			var edge2 := v2 - v0
			var h := ray_dir.cross(edge2)
			var a: float = edge1.dot(h)
			if absf(a) < 1e-8:
				continue
			var f: float = 1.0 / a
			var s := ray_origin - v0
			var u: float = f * s.dot(h)
			if u < 0.0 or u > 1.0:
				continue
			var q := s.cross(edge1)
			var v: float = f * ray_dir.dot(q)
			if v < 0.0 or u + v > 1.0:
				continue
			var t: float = f * edge2.dot(q)
			if t > 0.001 and t < best_t:
				best_t = t
				best_surface = si
				best_bary = Vector3(1.0 - u - v, u, v)
				best_i0 = i0
				best_i1 = i1
				best_i2 = i2
				best_arrays = arrays

	if best_surface < 0:
		return {}

	# Interpolate UV and normal from the hit triangle
	var interp_uv := Vector2.ZERO
	var uvs = best_arrays[Mesh.ARRAY_TEX_UV]
	if uvs != null and uvs.size() > maxi(maxi(best_i0, best_i1), best_i2):
		interp_uv = uvs[best_i0] * best_bary.x + uvs[best_i1] * best_bary.y + uvs[best_i2] * best_bary.z

	var interp_normal := Vector3.UP
	var norms = best_arrays[Mesh.ARRAY_NORMAL]
	if norms != null and norms.size() > maxi(maxi(best_i0, best_i1), best_i2):
		interp_normal = (norms[best_i0] * best_bary.x + norms[best_i1] * best_bary.y + norms[best_i2] * best_bary.z).normalized()

	var hit_world: Vector3 = ray_origin + ray_dir * best_t
	return {
		"uuid": obj_uuid,
		"distance": best_t,
		"faceIndex": best_surface,
		"st": interp_uv,
		"normal": interp_normal,
		"hitPosLocal": hit_world,
	}


## Phase 1 physics raycast (simple). Returns { uuid, distance } or {}.
func _pick_physics(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	var space_state: PhysicsDirectSpaceState3D = sm.get_world_3d().direct_space_state
	if space_state == null:
		return {}
	var ray_end := ray_origin + ray_dir * MAX_PICK_DIST
	var query := PhysicsRayQueryParameters3D.create(ray_origin, ray_end, PICK_LAYER)
	var result: Dictionary = space_state.intersect_ray(query)
	if result.is_empty():
		return {}
	var obj_uuid: String = _body_to_uuid.get(result["rid"].get_id(), "")
	if obj_uuid.is_empty():
		return {}
	return { "uuid": obj_uuid, "distance": ray_origin.distance_to(result["position"]) }


## Phase 1 physics raycast (detailed). Returns face index, UV, normal, hit position.
func _pick_physics_detailed(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	var space_state: PhysicsDirectSpaceState3D = sm.get_world_3d().direct_space_state
	if space_state == null:
		return {}
	var ray_end := ray_origin + ray_dir * MAX_PICK_DIST
	var query := PhysicsRayQueryParameters3D.create(ray_origin, ray_end, PICK_LAYER)
	var result: Dictionary = space_state.intersect_ray(query)
	if result.is_empty():
		return {}

	var obj_uuid: String = _body_to_uuid.get(result["rid"].get_id(), "")
	if obj_uuid.is_empty():
		return {}

	var distance: float = ray_origin.distance_to(result["position"])
	var face_index: int = result.get("face_index", -1)
	var cache_key: String = _uuid_to_cache_key.get(obj_uuid, "")
	var tri_map: Array = _mesh_tri_map.get(cache_key, [])

	# Fallback if no tri map or face_index out of range
	if cache_key.is_empty() or face_index < 0 or face_index >= tri_map.size():
		return { "uuid": obj_uuid, "distance": distance, "faceIndex": 0,
				 "st": Vector2.ZERO, "normal": result.get("normal", Vector3.UP),
				 "hitPosLocal": Vector3.ZERO }

	var surface_idx: int = tri_map[face_index][0]
	var tri_in_surface: int = tri_map[face_index][1]

	var rsi = sm.objects.get(obj_uuid)
	if rsi == null or rsi.mesh == null:
		return { "uuid": obj_uuid, "distance": distance, "faceIndex": surface_idx,
				 "st": Vector2.ZERO, "normal": result.get("normal", Vector3.UP),
				 "hitPosLocal": Vector3.ZERO }

	var arrays: Array = rsi.mesh.surface_get_arrays(surface_idx)
	if arrays.size() == 0:
		return { "uuid": obj_uuid, "distance": distance, "faceIndex": surface_idx,
				 "st": Vector2.ZERO, "normal": result.get("normal", Vector3.UP),
				 "hitPosLocal": Vector3.ZERO }

	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var uvs = arrays[Mesh.ARRAY_TEX_UV]
	var norms = arrays[Mesh.ARRAY_NORMAL]
	var indices = arrays[Mesh.ARRAY_INDEX]

	# Get triangle vertex indices
	var i0: int; var i1: int; var i2: int
	if indices != null and indices.size() >= (tri_in_surface + 1) * 3:
		i0 = indices[tri_in_surface * 3]
		i1 = indices[tri_in_surface * 3 + 1]
		i2 = indices[tri_in_surface * 3 + 2]
	else:
		i0 = tri_in_surface * 3
		i1 = tri_in_surface * 3 + 1
		i2 = tri_in_surface * 3 + 2

	if i2 >= verts.size():
		return { "uuid": obj_uuid, "distance": distance, "faceIndex": surface_idx,
				 "st": Vector2.ZERO, "normal": result.get("normal", Vector3.UP),
				 "hitPosLocal": Vector3.ZERO }

	# Transform world hit to local space
	var effective_scl: Vector3 = rsi.scl / rsi.scl_divisor
	var adjusted_pos: Vector3 = rsi.pos - Basis(rsi.rot) * (effective_scl * rsi.scl_center)
	var xform := Transform3D(Basis(rsi.rot) * Basis.from_scale(effective_scl), adjusted_pos)
	var local_hit: Vector3 = xform.affine_inverse() * result["position"]

	# Barycentric interpolation on the winning triangle
	var v0: Vector3 = verts[i0]
	var v1: Vector3 = verts[i1]
	var v2: Vector3 = verts[i2]
	var bary := _barycentric(local_hit, v0, v1, v2)

	var interp_uv := Vector2.ZERO
	if uvs != null and uvs.size() > maxi(maxi(i0, i1), i2):
		interp_uv = uvs[i0] * bary.x + uvs[i1] * bary.y + uvs[i2] * bary.z

	var interp_normal: Vector3 = result.get("normal", Vector3.UP)
	if norms != null and norms.size() > maxi(maxi(i0, i1), i2):
		interp_normal = (norms[i0] * bary.x + norms[i1] * bary.y + norms[i2] * bary.z).normalized()

	return {
		"uuid": obj_uuid,
		"distance": distance,
		"faceIndex": surface_idx,
		"st": interp_uv,
		"normal": interp_normal,
		"hitPosLocal": local_hit,
	}


## Barycentric coordinates of p in triangle (a, b, c). Returns Vector3(w, u, v).
func _barycentric(p: Vector3, a: Vector3, b: Vector3, c: Vector3) -> Vector3:
	var ab := b - a
	var ac := c - a
	var ap := p - a
	var d00 := ab.dot(ab)
	var d01 := ab.dot(ac)
	var d11 := ac.dot(ac)
	var d20 := ap.dot(ab)
	var d21 := ap.dot(ac)
	var denom := d00 * d11 - d01 * d01
	if absf(denom) < 1e-12:
		return Vector3(1.0, 0.0, 0.0)
	var inv := 1.0 / denom
	var u := (d11 * d20 - d01 * d21) * inv
	var v := (d00 * d21 - d01 * d20) * inv
	return Vector3(1.0 - u - v, u, v)


## Toggle the ID buffer debug overlay — shows what the pick camera sees.
func toggle_pick_debug() -> void:
	if _debug_layer:
		_debug_layer.visible = not _debug_layer.visible
		print("[ObjectPicker] Debug overlay %s — %d static + %d skinned pick instances, %d IDs allocated" % [
			"ON" if _debug_layer.visible else "OFF",
			_uuid_to_pick_rid.size(), _uuid_to_pick_mi.size(), _next_id - 1])


## Return the RenderingServer instance RID for an object (used for highlight overlay).
func get_object_rid(obj_uuid: String) -> RID:
	var rsi = sm.objects.get(obj_uuid)
	if rsi == null:
		return RID()
	return rsi.rid


## Return per-face info array for an object.
func get_object_face_info(obj_uuid: String) -> Array:
	return sm.object_faces.get(obj_uuid, [])


## Set planar shader debug mode on all cached planar materials.
## mode: 0=off, 1=SL normal, 2=UV, 3=binormal
func set_planar_debug_mode(mode: int) -> void:
	var count := 0
	for key: String in sm.material_cache:
		var mat: Material = sm.material_cache[key]
		if mat is ShaderMaterial:
			var smat := mat as ShaderMaterial
			if smat.shader != null and "debug_mode" in smat.shader.code:
				smat.set_shader_parameter("debug_mode", mode)
				count += 1


## Return debug summary for an object.
func get_object_debug_info(obj_uuid: String) -> Dictionary:
	var rsi = sm.objects.get(obj_uuid)
	if rsi == null:
		return {}
	var surface_count: int = rsi.mesh.get_surface_count() if rsi.mesh else 0
	var meta: Dictionary = sm.object_meta.get(obj_uuid, {})
	return {
		"uuid": obj_uuid,
		"name": meta.get("name", ""),
		"description": meta.get("description", ""),
		"pos": rsi.pos,
		"rot": rsi.rot,
		"scl": rsi.scl,
		"meshId": sm.object_mesh_id.get(obj_uuid, ""),
		"parentUuid": sm.object_parent.get(obj_uuid, ""),
		"surfaceCount": surface_count,
	}


func handle_object_properties(msg: Dictionary) -> void:
	var obj_uuid: String = str(msg.get("uuid", ""))
	if obj_uuid.is_empty():
		return
	var obj_name: String = str(msg.get("name", ""))
	var obj_desc: String = str(msg.get("description", ""))
	if sm.object_meta.has(obj_uuid):
		sm.object_meta[obj_uuid]["name"] = obj_name
		sm.object_meta[obj_uuid]["description"] = obj_desc
	sm.object_properties_received.emit(obj_uuid, obj_name, obj_desc)
