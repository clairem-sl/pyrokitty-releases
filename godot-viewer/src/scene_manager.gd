extends Node3D

const PrimMeshGeneratorScript = preload("res://src/prim_mesh_generator.gd")
const PlanarMapShader = preload("res://src/planar_map.gdshader")
const PlanarMapAlphaShader = preload("res://src/planar_map_alpha.gdshader")
const StandardUVShader = preload("res://src/standard_uv.gdshader")
const StandardUVAlphaShader = preload("res://src/standard_uv_alpha.gdshader")

## Manages in-world objects and avatars as lightweight RenderingServer RIDs.
## Coordinate conversion: SL (X=East, Y=North, Z=Up) -> Godot (X=Right, Y=Up, Z=-Forward)
##   Position: (sl.x, sl.z, -sl.y)
##   Quaternion: (sl.x, sl.z, -sl.y, sl.w)

## Desktop visibility range. Objects fade from
## (VISIBILITY_FAR - VISIBILITY_FADE_MARGIN) to VISIBILITY_FAR, then are culled.
## VR uses VRFrameBudget.VR_CAMERA_FAR / VR_VISIBILITY_FADE_MARGIN instead.
const VISIBILITY_FAR: float = 128.0
const VISIBILITY_FADE_MARGIN: float = 32.0

signal self_avatar_moved(pos: Vector3)

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

class AsyncResult extends RefCounted:
	var data       # Worker writes Image (texture) here
	var gltf_state: GLTFState    # Worker writes parsed GLTF state here (mesh pipeline)
	var error: bool = false

var objects: Dictionary = {}   # localId (int) -> RSInstance
var avatars: Dictionary = {}   # avatarId (String) -> RSInstance
var self_avatar_id: String = ""

# Avatar interpolation state
var avatar_targets: Dictionary = {}   # avatarId -> { pos: Vector3, rot: Quaternion, vel: Vector3 }
const AVATAR_LERP_SPEED: float = 15.0       # position lerp rate (per second)
const AVATAR_SLERP_SPEED: float = 15.0      # rotation slerp rate (per second)
const AVATAR_MAX_INTERP_DIST: float = 10.0  # snap if further than this (meters)
const AVATAR_MAX_EXTRAP_TIME: float = 0.25  # max seconds to extrapolate with velocity

# Linkset tracking (flat hierarchy — no Godot node parenting to avoid scale inheritance)
var pending_children: Dictionary = {}   # parentLocalId -> Array[childLocalId] (children arrived before parent)
var object_parent: Dictionary = {}      # childLocalId -> parentLocalId
var object_children: Dictionary = {}    # parentLocalId -> Array[childLocalId]
var child_offset_pos: Dictionary = {}   # childLocalId -> Vector3 (relative position in Godot coords)
var child_offset_rot: Dictionary = {}   # childLocalId -> Quaternion (relative rotation in Godot coords)

# Shared mesh resources
var object_mesh: BoxMesh
var avatar_mesh: BoxMesh

# Shared materials
var object_material: StandardMaterial3D
var avatar_material: StandardMaterial3D

# Mesh pipeline
var pending_meshes: Dictionary = {}    # localId (int) -> meshId (String)
var mesh_cache: Dictionary = {}        # meshId (String) -> Mesh resource
var mesh_load_failed: Dictionary = {}  # meshId (String) -> bool

# Texture pipeline
var texture_cache: Dictionary = {}        # textureId (String) -> ImageTexture
var material_cache: Dictionary = {}       # "uuid_colorhex_fb_ds_uv" (String) -> StandardMaterial3D
var _double_sided_shader_cache: Dictionary = {}  # Shader -> Shader (cull_back -> cull_disabled variant)
var object_faces: Dictionary = {}         # localId (int) -> Array[face_info dicts] (persists for mesh swaps)
var pending_textures: Dictionary = {}     # localId (int) -> Array[{ faceIndex, textureId, color, ... }]
var texture_load_failed: Dictionary = {}  # textureId (String) -> bool

# Async texture loading (own Thread pool — bypasses WorkerThreadPool low-priority cap)
const TEXTURE_THREAD_COUNT: int = 16          # dedicated OS threads for texture loading
var _texture_threads: Array[Thread] = []      # running Thread objects
var _texture_queue: Array = []                # shared queue: { textureId, path } (main thread pushes, workers pop)
var _texture_queue_lock: Mutex = Mutex.new()
var _texture_results: Array = []              # completed: { textureId, image } (workers push, main thread pops)
var _texture_results_lock: Mutex = Mutex.new()
var _texture_in_flight: Dictionary = {}       # textureId (String) -> true (dedup)
# Per-step timing accumulators (all threads write, stats reads + resets)
var _timing_lock: Mutex = Mutex.new()
var _timing_load_ms: float = 0.0
var _timing_mipmap_ms: float = 0.0
var _timing_compress_ms: float = 0.0
var _timing_count: int = 0
var _shutting_down: bool = false
var _tex_finalized_count: int = 0   # total textures uploaded to GPU
var _mesh_finalized_count: int = 0  # total meshes assigned to objects
# Budget tracking (accumulated between stats reports, then reset)
var _budget_samples: int = 0
var _budget_total_ms: float = 0.0
var _budget_used_ms: float = 0.0
var _budget_elapsed_ms: float = 0.0
# Per-operation main-thread timing (accumulated between stats reports)
var _fin_tex_create_ms: float = 0.0    # ImageTexture.create_from_image
var _fin_tex_apply_ms: float = 0.0     # _apply_texture_to_pending
var _fin_tex_count: int = 0
var _fin_mesh_extract_ms: float = 0.0  # ImporterMesh.get_mesh
var _fin_mesh_apply_ms: float = 0.0    # _apply_mesh_to_pending
var _fin_mesh_count: int = 0
const VRFrameBudget = preload("res://src/vr_frame_budget.gd")
var _target_frame_ms: float = VRFrameBudget.DESKTOP_FRAME_MS
var _vr_mode: bool = false
var _vis_far: float = VISIBILITY_FAR
var _vis_fade: float = VISIBILITY_FADE_MARGIN
const MIN_FINALIZE_MS: float = 2.0            # minimum finalize budget when on-target (desktop)
const OVERBUDGET_FINALIZE_MS: float = 8.0     # more aggressive when already over budget (desktop only)

# Async mesh loading (WorkerThreadPool)
var _mesh_tasks: Dictionary = {}         # task_id (int) -> { meshId: String, result: AsyncResult, path: String }
var _mesh_in_flight: Dictionary = {}     # meshId (String) -> true (dedup)
var _mesh_queue: Array = []              # queued { meshId, path } waiting to be submitted
const MESH_MAX_IN_FLIGHT: int = 16             # max concurrent worker tasks

# Periodic stats reporting
var _stats_timer: float = 0.0
const STATS_INTERVAL: float = 10.0

# Reverse texture index: textureId -> Array[{ localId, faceInfo }]
var _pending_by_texture: Dictionary = {}

# Prim geometry generator (procedural shapes from SL prim parameters)
var prim_generator: RefCounted  # PrimMeshGenerator instance

# Reverse mesh index: meshId -> Array[localId] (O(1) lookup in _apply_mesh_to_pending)
var _pending_by_mesh: Dictionary = {}

# Texture alpha tracking: textureId -> true if fully opaque (DXT1/BC1, no alpha channel)
var _texture_opaque: Dictionary = {}
var _material_lookups: int = 0   # total calls to _get_or_create_material (lifetime)

# Placeholder material cache: "colorhex_fb_ds" -> StandardMaterial3D
var _placeholder_cache: Dictionary = {}

# Cached scenario RID for RSInstance creation
var _scenario: RID

# ─── Light Management ────────────────────────────────

## Lightweight wrapper around a RenderingServer light + instance pair.
class RSLight extends RefCounted:
	var light_rid: RID
	var instance_rid: RID
	var is_spot: bool
	var proj_texture_id: String = ""

	func _init(scenario: RID, spot: bool) -> void:
		is_spot = spot
		if spot:
			light_rid = RenderingServer.spot_light_create()
		else:
			light_rid = RenderingServer.omni_light_create()
		instance_rid = RenderingServer.instance_create()
		RenderingServer.instance_set_base(instance_rid, light_rid)
		RenderingServer.instance_set_scenario(instance_rid, scenario)
		RenderingServer.light_set_shadow(light_rid, false)

	func destroy() -> void:
		RenderingServer.free_rid(instance_rid)
		RenderingServer.free_rid(light_rid)

var object_lights: Dictionary = {}           # localId -> RSLight
var _object_light_data: Dictionary = {}      # localId -> light dict (for re-creation after cull)
var _pending_proj_textures: Dictionary = {}  # textureId -> Array[localId]
var _projector_textures: Dictionary = {}    # textureId -> padded ImageTexture (square inscribed in circle)
var _light_count: int = 0
var _light_cull_timer: float = 0.0
const MAX_ACTIVE_LIGHTS: int = 64
const LIGHT_CULL_DISTANCE: float = 64.0
const LIGHT_CULL_INTERVAL: float = 2.0

## Get a padded projector texture RID.  SL projects a rectangular frustum
## but Godot's spot-light cone is circular.  Pad the texture so the square
## image is inscribed inside the circle (sqrt(2)x larger canvas with black
## border).  Cached per texture_id so we only pad once.
func _get_projector_texture_rid(texture_id: String) -> RID:
	if _projector_textures.has(texture_id):
		return _projector_textures[texture_id].get_rid()

	var orig_tex: ImageTexture = texture_cache.get(texture_id)
	if orig_tex == null:
		return RID()

	var img := orig_tex.get_image()
	if img == null:
		return orig_tex.get_rid()

	img = img.duplicate()
	if img.is_compressed():
		img.decompress()

	var ow := img.get_width()
	var oh := img.get_height()
	# sqrt(2) ≈ 1.4143 — padded size so square inscribes in circle
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
	print("[Light] Created padded projector texture %s: %dx%d → %dx%d" % [texture_id, ow, oh, nw, nh])
	return padded_tex.get_rid()

func _exit_tree() -> void:
	_shutting_down = true
	# Skip all cleanup — process is about to die anyway.
	# RenderingServer RIDs, threads, and memory are freed by the OS on exit.
	# Waiting for threads to finish just delays the close for no benefit.

func _ready() -> void:
	_scenario = get_world_3d().scenario
	_start_texture_threads()

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


## Convert SL position array [x, y, z] to Godot Vector3
func sl_to_godot_pos(sl_pos: Array) -> Vector3:
	return Vector3(sl_pos[0], sl_pos[2], -sl_pos[1])


## Convert SL quaternion array [x, y, z, w] to Godot Quaternion
func sl_to_godot_quat(sl_rot: Array) -> Quaternion:
	return Quaternion(sl_rot[0], sl_rot[2], -sl_rot[1], sl_rot[3])


## Convert SL scale array [x, y, z] to Godot Vector3
func sl_to_godot_scale(sl_scale: Array) -> Vector3:
	return Vector3(sl_scale[0], sl_scale[2], sl_scale[1])


# ─── Object Handlers ──────────────────────────────────

func handle_object_create(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	if local_id == 0:
		return

	var parent_id: int = int(msg.get("parentId", 0))

	# Remove existing if duplicate
	if objects.has(local_id):
		_cleanup_object(local_id)

	var mesh_id: String = msg.get("meshId", "")
	var shape: Dictionary = msg.get("shape", {})
	var rsi := RSInstance.new(_scenario, _vis_far, _vis_fade)

	if not mesh_id.is_empty() and mesh_cache.has(mesh_id):
		# Real mesh already loaded — use it
		rsi.set_mesh(mesh_cache[mesh_id])
	elif not mesh_id.is_empty():
		# Mesh placeholder while waiting for mesh data
		rsi.set_mesh(object_mesh)
		if not mesh_load_failed.has(mesh_id):
			pending_meshes[local_id] = mesh_id
			if not _pending_by_mesh.has(mesh_id):
				_pending_by_mesh[mesh_id] = []
			_pending_by_mesh[mesh_id].append(local_id)
	elif not shape.is_empty():
		# Procedural prim geometry from shape parameters
		rsi.set_mesh(prim_generator.get_or_generate(shape))
	else:
		# Ultimate fallback — box placeholder
		rsi.set_mesh(object_mesh)

	# Apply per-face texture materials
	var faces: Array = msg.get("faces", [])
	if faces.size() > 0:
		object_faces[local_id] = faces
		_apply_face_materials(rsi, local_id, faces)
	else:
		# No texture info — use default gray
		rsi.set_material_override(object_material)

	# Apply transform
	var pos: Array = msg.get("position", [0, 0, 0])
	var rot: Array = msg.get("rotation", [0, 0, 0, 1])
	var scl: Array = msg.get("scale", [0.5, 0.5, 0.5])

	var godot_pos := sl_to_godot_pos(pos)
	var godot_rot := sl_to_godot_quat(rot)
	var godot_scale := sl_to_godot_scale(scl)

	rsi.scl = godot_scale  # SL prims have independent scale — no compensation

	if parent_id > 0:
		# Child prim — store relative offset for linkset movement
		object_parent[local_id] = parent_id
		child_offset_pos[local_id] = godot_pos
		child_offset_rot[local_id] = godot_rot

		if not object_children.has(parent_id):
			object_children[parent_id] = []
		object_children[parent_id].append(local_id)

		if objects.has(parent_id):
			# Parent exists — compute world position from parent + offset
			var parent_rsi: RSInstance = objects[parent_id]
			rsi.pos = parent_rsi.pos + parent_rsi.rot * godot_pos
			rsi.rot = parent_rsi.rot * godot_rot
		else:
			# Parent hasn't arrived — use offset as-is (will be corrected when parent arrives)
			rsi.pos = godot_pos
			rsi.rot = godot_rot
			if not pending_children.has(parent_id):
				pending_children[parent_id] = []
			pending_children[parent_id].append(local_id)
	else:
		# Root prim — position is world absolute
		rsi.pos = godot_pos
		rsi.rot = godot_rot

	rsi.push_transform()
	objects[local_id] = rsi

	# Create light if this object is a light source
	if msg.has("light") and msg["light"] is Dictionary:
		print("[Light] Creating light for localId=%d: %s pos=%s" % [local_id, str(msg["light"]), str(rsi.pos)])
		_create_or_update_light(local_id, msg["light"], rsi)

	# If this is a root and we have pending children, fix their world positions
	if parent_id == 0 and pending_children.has(local_id):
		for child_id: int in pending_children[local_id]:
			if objects.has(child_id) and child_offset_pos.has(child_id):
				var child_rsi: RSInstance = objects[child_id]
				child_rsi.pos = rsi.pos + rsi.rot * child_offset_pos[child_id]
				child_rsi.rot = rsi.rot * child_offset_rot[child_id]
				child_rsi.push_transform()
		pending_children.erase(local_id)


func handle_object_update_batch(msg: Dictionary) -> void:
	var obj_list: Array = msg.get("objects", [])
	for obj: Dictionary in obj_list:
		var local_id: int = int(obj.get("localId", 0))
		if local_id == 0:
			continue

		var rsi: RSInstance = objects.get(local_id)
		if rsi == null:
			continue

		if object_parent.has(local_id):
			# Child prim — positions are relative to parent
			if obj.has("position"):
				var new_offset := sl_to_godot_pos(obj["position"])
				child_offset_pos[local_id] = new_offset
				var parent_rsi: RSInstance = objects.get(object_parent[local_id])
				if parent_rsi:
					rsi.pos = parent_rsi.pos + parent_rsi.rot * new_offset
			if obj.has("rotation"):
				var new_rot := sl_to_godot_quat(obj["rotation"])
				child_offset_rot[local_id] = new_rot
				var parent_rsi: RSInstance = objects.get(object_parent[local_id])
				if parent_rsi:
					rsi.rot = parent_rsi.rot * new_rot
			if obj.has("scale"):
				rsi.scl = sl_to_godot_scale(obj["scale"])
			rsi.push_transform()
		else:
			# Root prim — positions are world absolute
			if obj.has("position"):
				rsi.pos = sl_to_godot_pos(obj["position"])
			if obj.has("rotation"):
				rsi.rot = sl_to_godot_quat(obj["rotation"])
			if obj.has("scale"):
				rsi.scl = sl_to_godot_scale(obj["scale"])
			rsi.push_transform()

			# Propagate root movement to all children
			if object_children.has(local_id):
				_update_children_transforms(local_id)

		# Update light (may be added, changed, or removed)
		if obj.has("light"):
			if obj["light"] is Dictionary:
				_create_or_update_light(local_id, obj["light"], rsi)
			else:
				# light: null means light was removed
				_destroy_light(local_id)
				_object_light_data.erase(local_id)
		elif object_lights.has(local_id):
			# Transform changed — update light position
			_update_light_transform(local_id, rsi)


## Recompute world positions of all children from parent's current transform
func _update_children_transforms(parent_id: int) -> void:
	var parent_rsi: RSInstance = objects.get(parent_id)
	if parent_rsi == null:
		return
	for child_id: int in object_children[parent_id]:
		if objects.has(child_id) and child_offset_pos.has(child_id):
			var child_rsi: RSInstance = objects[child_id]
			child_rsi.pos = parent_rsi.pos + parent_rsi.rot * child_offset_pos[child_id]
			child_rsi.rot = parent_rsi.rot * child_offset_rot[child_id]
			child_rsi.push_transform()
			# Move child's light with it
			if object_lights.has(child_id):
				_update_light_transform(child_id, child_rsi)


## Update a light's transform to match its RSInstance position/rotation
func _update_light_transform(local_id: int, rsi: RSInstance) -> void:
	var rsl: RSLight = object_lights.get(local_id)
	if rsl == null:
		return
	var basis := Basis(rsi.rot)
	if rsl.is_spot:
		basis = basis * Basis(Vector3.RIGHT, -PI / 2.0)
	RenderingServer.instance_set_transform(rsl.instance_rid, Transform3D(basis, rsi.pos))


## Handle face updates from material asset fetch (PBR materials resolved after initial object_create)
func handle_update_faces(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	var rsi: RSInstance = objects.get(local_id)
	if rsi == null or rsi.mesh == null:
		return
	var faces: Array = msg.get("faces", [])
	if faces.size() == 0:
		return

	# Purge stale _pending_by_texture entries for faces being replaced.
	# Without this, the old legacy texture arriving later would overwrite PBR.
	var replaced_indices: Dictionary = {}  # face index → true
	for new_face: Dictionary in faces:
		replaced_indices[int(new_face.get("index", -1))] = true
	var tex_keys_to_check: Array = _pending_by_texture.keys()
	for tid: String in tex_keys_to_check:
		var entries: Array = _pending_by_texture[tid]
		var filtered: Array = []
		for entry: Dictionary in entries:
			if entry["localId"] == local_id and replaced_indices.has(entry["faceInfo"]["faceIndex"]):
				continue  # drop stale entry
			filtered.append(entry)
		if filtered.size() == 0:
			_pending_by_texture.erase(tid)
		else:
			_pending_by_texture[tid] = filtered

	# Also remove from per-object pending list
	if pending_textures.has(local_id):
		var pt: Array = pending_textures[local_id]
		pt = pt.filter(func(fi: Dictionary) -> bool: return not replaced_indices.has(fi["faceIndex"]))
		if pt.size() == 0:
			pending_textures.erase(local_id)
		else:
			pending_textures[local_id] = pt

	# Merge into existing face data so texture_ready callbacks still work
	if not object_faces.has(local_id):
		object_faces[local_id] = faces
	else:
		# Update/add faces by index
		var existing: Array = object_faces[local_id]
		for new_face: Dictionary in faces:
			var idx: int = int(new_face.get("index", -1))
			var found := false
			for i: int in range(existing.size()):
				if int(existing[i].get("index", -1)) == idx:
					existing[i] = new_face
					found = true
					break
			if not found:
				existing.append(new_face)
	_apply_face_materials(rsi, local_id, object_faces[local_id])


func handle_object_kill(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	_cleanup_object(local_id)


## Clean up an object and all its children from all tracking dictionaries
func _cleanup_object(local_id: int) -> void:
	# Recursively clean up children first
	if object_children.has(local_id):
		for child_id: int in object_children[local_id].duplicate():
			_cleanup_object(child_id)
		object_children.erase(local_id)

	# Remove from parent's children list
	if object_parent.has(local_id):
		var pid: int = object_parent[local_id]
		if object_children.has(pid):
			object_children[pid].erase(local_id)
		object_parent.erase(local_id)

	# Free the RenderingServer instance
	if objects.has(local_id):
		objects[local_id].destroy()
		objects.erase(local_id)

	# Destroy associated light
	_destroy_light(local_id)
	_object_light_data.erase(local_id)

	# Clean up all tracking dicts
	if pending_meshes.has(local_id):
		var mid: String = pending_meshes[local_id]
		pending_meshes.erase(local_id)
		if _pending_by_mesh.has(mid):
			_pending_by_mesh[mid].erase(local_id)
			if _pending_by_mesh[mid].size() == 0:
				_pending_by_mesh.erase(mid)
	# Remove from reverse texture index when cleaning up pending_textures
	if pending_textures.has(local_id):
		for fi: Dictionary in pending_textures[local_id]:
			var tid: String = fi["textureId"]
			if _pending_by_texture.has(tid):
				_pending_by_texture[tid] = _pending_by_texture[tid].filter(
					func(e: Dictionary) -> bool: return e["localId"] != local_id)
				if _pending_by_texture[tid].size() == 0:
					_pending_by_texture.erase(tid)
		pending_textures.erase(local_id)
	object_faces.erase(local_id)
	child_offset_pos.erase(local_id)
	child_offset_rot.erase(local_id)
	pending_children.erase(local_id)


# ─── Light Pipeline ──────────────────────────────────

## Create or update a RenderingServer light for an object
func _create_or_update_light(local_id: int, light_data: Dictionary, rsi: RSInstance) -> void:
	# Cache light data for distance cull re-creation
	_object_light_data[local_id] = light_data

	# Distance check: skip if prim beyond cull distance from camera
	var cam := get_viewport().get_camera_3d()
	if cam:
		var dist := rsi.pos.distance_to(cam.global_position)
		if dist > LIGHT_CULL_DISTANCE:
			return

	var is_spot: bool = light_data.get("isSpot", false)

	# If light exists and type changed (spot↔omni), destroy and recreate
	if object_lights.has(local_id):
		var existing: RSLight = object_lights[local_id]
		if existing.is_spot != is_spot:
			_destroy_light(local_id)
		else:
			_apply_light_params(local_id, existing, light_data, rsi)
			return

	# Light count cap: skip if at max and this is a new light
	if _light_count >= MAX_ACTIVE_LIGHTS:
		return

	# Create new light
	var rsl := RSLight.new(_scenario, is_spot)
	object_lights[local_id] = rsl
	_light_count += 1
	_apply_light_params(local_id, rsl, light_data, rsi)


## Apply parameters to an existing RSLight from light data dict
func _apply_light_params(local_id: int, rsl: RSLight, light_data: Dictionary, rsi: RSInstance) -> void:
	var RS := RenderingServer
	var color: Array = light_data.get("color", [1.0, 1.0, 1.0])
	RS.light_set_color(rsl.light_rid, Color(color[0], color[1], color[2]))
	RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_ENERGY, float(light_data.get("intensity", 1.0)))
	RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_RANGE, float(light_data.get("radius", 10.0)))
	# SL falloff 0-2: higher = faster dropoff. Godot attenuation exponent:
	# <1 = sub-linear (stays bright longer), 1 = linear, >1 = steep.
	# SL lights appear brighter at distance than linear, so map to sub-linear range.
	var sl_falloff: float = float(light_data.get("falloff", 0.75))
	RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_ATTENUATION, clampf(sl_falloff, 0.1, 2.0))

	if rsl.is_spot:
		var fov_rad: float = float(light_data.get("spotFov", 1.0))
		# fov_rad is the full FOV angle from SL. Godot's spot_angle is a half-angle.
		# Widen cone to the diagonal so full square texture is visible:
		var half_fov := fov_rad * 0.5
		var diagonal_half := atan(sqrt(2.0) * tan(half_fov))
		var spot_angle: float = rad_to_deg(diagonal_half)
		RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_SPOT_ANGLE, spot_angle)
		# Godot formula: pow(1.0 - rim, atten). Low atten → uniform brightness.
		# 0.01 gives ~99% brightness at the cone edge (SL projectors have no angular falloff).
		RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_SPOT_ATTENUATION, 0.01)
		print("[Light] Spot localId=%d fov=%.4frad half=%.4frad diag=%.4frad angle=%.1fdeg" % [local_id, fov_rad, half_fov, diagonal_half, spot_angle])

		# Projection texture — requires shadow_enabled to render in Godot 4
		var proj_tex_id: String = light_data.get("projTexture", "")
		if not proj_tex_id.is_empty():
			rsl.proj_texture_id = proj_tex_id
			RS.light_set_shadow(rsl.light_rid, true)
			# Shadow must be enabled for projector textures in Godot 4, but we
			# don't want visible shadow acne.  Near-zero opacity keeps the
			# projector working while making shadow artifacts invisible.
			RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_SHADOW_OPACITY, 0.01)
			RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_SHADOW_BIAS, 0.1)
			RS.light_set_param(rsl.light_rid, RS.LIGHT_PARAM_SHADOW_NORMAL_BIAS, 1.0)
			if texture_cache.has(proj_tex_id):
				print("[Light] Proj texture %s already cached, applying" % proj_tex_id)
				RS.light_set_projector(rsl.light_rid, _get_projector_texture_rid(proj_tex_id))
			else:
				print("[Light] Proj texture %s NOT cached, deferring" % proj_tex_id)
				if not _pending_proj_textures.has(proj_tex_id):
					_pending_proj_textures[proj_tex_id] = []
				if local_id not in _pending_proj_textures[proj_tex_id]:
					_pending_proj_textures[proj_tex_id].append(local_id)

	# SL spots project along local -Z → Godot -Y. Godot spot shines along -Z.
	# Rotate -90° around X to map -Z → -Y (downward).
	var basis := Basis(rsi.rot)
	if rsl.is_spot:
		basis = basis * Basis(Vector3.RIGHT, -PI / 2.0)
	RS.instance_set_transform(rsl.instance_rid, Transform3D(basis, rsi.pos))

	# Disable shadow casting on the light-emitting prim so it doesn't
	# cast a shadow into its own projection
	if rsl.is_spot and not rsl.proj_texture_id.is_empty():
		RS.instance_geometry_set_cast_shadows_setting(
			rsi.instance_rid, RS.SHADOW_CASTING_SETTING_OFF)


## Destroy a light for a given localId
func _destroy_light(local_id: int) -> void:
	if not object_lights.has(local_id):
		return
	var rsl: RSLight = object_lights[local_id]
	var reason := ""
	# Walk the stack to find what called us
	var rsi: RSInstance = objects.get(local_id)
	var dist_info := ""
	if rsi:
		var cam := get_viewport().get_camera_3d()
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


## Distance culling sweep: destroy far lights, create close ones (called from _process)
func _sweep_light_culling() -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var cam_pos := cam.global_position

	# Destroy lights beyond cull distance
	var to_remove: Array[int] = []
	for local_id: int in object_lights:
		var rsi: RSInstance = objects.get(local_id)
		if rsi == null:
			to_remove.append(local_id)
			continue
		if rsi.pos.distance_to(cam_pos) > LIGHT_CULL_DISTANCE:
			to_remove.append(local_id)
	for local_id: int in to_remove:
		_destroy_light(local_id)

	# Create lights for prims now within range (if under cap), nearest first
	var candidates: Array = []  # [[dist, local_id], ...]
	for local_id: int in _object_light_data:
		if object_lights.has(local_id):
			continue
		var rsi: RSInstance = objects.get(local_id)
		if rsi == null:
			continue
		var dist := rsi.pos.distance_to(cam_pos)
		if dist <= LIGHT_CULL_DISTANCE:
			candidates.append([dist, local_id])
	candidates.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	if candidates.size() > 0:
		print("[Light] Sweep: %d candidates within %.0fm (cam=%s), active=%d/%d" % [candidates.size(), LIGHT_CULL_DISTANCE, str(cam_pos), _light_count, MAX_ACTIVE_LIGHTS])
	for c: Array in candidates:
		if _light_count >= MAX_ACTIVE_LIGHTS:
			break
		var local_id: int = int(c[1])
		var rsi: RSInstance = objects.get(local_id)
		if rsi == null:
			continue
		var light_data: Dictionary = _object_light_data[local_id]
		var is_spot: bool = light_data.get("isSpot", false)
		var rsl := RSLight.new(_scenario, is_spot)
		object_lights[local_id] = rsl
		_light_count += 1
		_apply_light_params(local_id, rsl, light_data, rsi)



# ─── Mesh Pipeline ───────────────────────────────────

func handle_mesh_ready(msg: Dictionary) -> void:
	var mesh_id: String = msg.get("meshId", "")
	var glb_path: String = msg.get("path", "")
	if mesh_id.is_empty() or glb_path.is_empty():
		return

	# Skip if already cached, in-flight, or previously failed
	if _shutting_down or mesh_cache.has(mesh_id) or _mesh_in_flight.has(mesh_id) or mesh_load_failed.has(mesh_id):
		return

	_mesh_in_flight[mesh_id] = true
	_mesh_queue.append({ "meshId": mesh_id, "path": glb_path })


## Apply a loaded mesh to all pending objects waiting for it
func _apply_mesh_to_pending(mesh_id: String) -> void:
	if not _pending_by_mesh.has(mesh_id):
		return
	var loaded_mesh: Mesh = mesh_cache[mesh_id]
	var local_ids: Array = _pending_by_mesh[mesh_id]
	_pending_by_mesh.erase(mesh_id)
	for local_id: int in local_ids:
		pending_meshes.erase(local_id)
		var rsi: RSInstance = objects.get(local_id)
		if rsi != null:
			rsi.set_mesh(loaded_mesh)
			# Reapply per-face materials now that we have real mesh with proper surfaces
			if object_faces.has(local_id):
				rsi.set_material_override(null)
				_apply_face_materials(rsi, local_id, object_faces[local_id])
			else:
				rsi.set_material_override(null)


## Submit queued meshes to WorkerThreadPool (throttled)
func _submit_mesh_tasks() -> void:
	while _mesh_queue.size() > 0 and _mesh_tasks.size() < MESH_MAX_IN_FLIGHT:
		var entry: Dictionary = _mesh_queue.pop_front()
		var mesh_id: String = entry["meshId"]
		var glb_path: String = entry["path"]

		var result := AsyncResult.new()
		var task_id: int = WorkerThreadPool.add_task(func() -> void:
			if _shutting_down:
				result.error = true
				return
			var doc := GLTFDocument.new()
			var state := GLTFState.new()
			var err := doc.append_from_file(glb_path, state)
			if err != OK or _shutting_down:
				result.error = true
				return
			# Store parsed state; mesh extraction runs on main thread (creates RS resources)
			result.gltf_state = state
		)
		_mesh_tasks[task_id] = { "meshId": mesh_id, "result": result, "path": glb_path }



# ─── Texture Pipeline ────────────────────────────────

func handle_texture_ready(msg: Dictionary) -> void:
	var texture_id: String = msg.get("textureId", "")
	var tex_path: String = msg.get("path", "")
	if texture_id.is_empty() or tex_path.is_empty():
		return

	# Skip if shutting down, already cached, in-flight, or previously failed
	if _shutting_down or texture_cache.has(texture_id) or _texture_in_flight.has(texture_id) or texture_load_failed.has(texture_id):
		return

	_texture_in_flight[texture_id] = true
	_texture_queue_lock.lock()
	_texture_queue.append({ "textureId": texture_id, "path": tex_path })
	_texture_queue_lock.unlock()


## Start dedicated texture worker threads (called once from _ready)
func _start_texture_threads() -> void:
	for i in range(TEXTURE_THREAD_COUNT):
		var t := Thread.new()
		t.start(_texture_worker_loop)
		_texture_threads.append(t)
	print("[SceneManager] Ready: %d CPU threads, %d texture threads" % [OS.get_processor_count(), TEXTURE_THREAD_COUNT])


## Worker loop: runs on each dedicated texture thread
func _texture_worker_loop() -> void:
	while not _shutting_down:
		# Backpressure: if results queue is deep, let main thread catch up
		_texture_results_lock.lock()
		var results_depth := _texture_results.size()
		_texture_results_lock.unlock()
		if results_depth > 24:
			OS.delay_msec(50)
			continue

		# Pop next job from queue
		_texture_queue_lock.lock()
		var job: Dictionary = {}
		if _texture_queue.size() > 0:
			job = _texture_queue.pop_front()
		_texture_queue_lock.unlock()

		if job.is_empty():
			# No work — sleep briefly and retry
			OS.delay_msec(5)
			continue

		var texture_id: String = job["textureId"]
		var tex_path: String = job["path"]

		# Pre-compressed .bctex — load directly, skip generate_mipmaps + compress
		if tex_path.ends_with(".bctex"):
			var t0 := Time.get_ticks_usec()
			var img := _load_bctex(tex_path)
			var t1 := Time.get_ticks_usec()

			_timing_lock.lock()
			_timing_load_ms += (t1 - t0) / 1000.0
			# No mipmap or compress time — already done on GPU
			_timing_count += 1
			_timing_lock.unlock()

			_texture_results_lock.lock()
			_texture_results.append({ "textureId": texture_id, "image": img })
			_texture_results_lock.unlock()
			continue

		var t0 := Time.get_ticks_usec()
		var img := Image.new()
		var err := img.load(tex_path)
		var t1 := Time.get_ticks_usec()
		if err != OK or _shutting_down:
			_texture_results_lock.lock()
			_texture_results.append({ "textureId": texture_id, "image": null })
			_texture_results_lock.unlock()
			continue

		img.generate_mipmaps()
		var t2 := Time.get_ticks_usec()
		if _shutting_down:
			_texture_results_lock.lock()
			_texture_results.append({ "textureId": texture_id, "image": null })
			_texture_results_lock.unlock()
			continue

		img.compress(Image.COMPRESS_S3TC)
		var t3 := Time.get_ticks_usec()

		_timing_lock.lock()
		_timing_load_ms += (t1 - t0) / 1000.0
		_timing_mipmap_ms += (t2 - t1) / 1000.0
		_timing_compress_ms += (t3 - t2) / 1000.0
		_timing_count += 1
		_timing_lock.unlock()

		_texture_results_lock.lock()
		_texture_results.append({ "textureId": texture_id, "image": img })
		_texture_results_lock.unlock()


## Load a pre-compressed .bctex file (BC1/BC3 with mipmaps).
## Header: 32 bytes (magic, version, width, height, format, mipCount, flags, dataSize)
## Body: concatenated mip levels, largest first
func _load_bctex(bctex_path: String) -> Image:
	var f := FileAccess.open(bctex_path, FileAccess.READ)
	if f == null:
		push_warning("[SceneManager] _load_bctex: can't open %s" % bctex_path)
		return null

	# Read 32-byte header
	var magic := f.get_32()
	var version := f.get_32()
	if magic != 0x42435458 or version != 1:
		push_warning("[SceneManager] _load_bctex: invalid header in %s" % bctex_path)
		f.close()
		return null

	var width := int(f.get_32())
	var height := int(f.get_32())
	var fmt := int(f.get_32())     # 0=BC1, 1=BC3
	var mip_count := int(f.get_32())
	var _flags := f.get_32()        # bit 0 = has_alpha (informational)
	var data_size := int(f.get_32())

	# Read compressed data blob
	var data := f.get_buffer(data_size)
	f.close()

	if data.size() != data_size:
		push_warning("[SceneManager] _load_bctex: short read %d/%d in %s" % [data.size(), data_size, bctex_path])
		return null

	# Map format: BC1 → FORMAT_DXT1, BC3 → FORMAT_DXT5
	var godot_format: Image.Format
	if fmt == 0:
		godot_format = Image.FORMAT_DXT1
	else:
		godot_format = Image.FORMAT_DXT5

	var has_mipmaps := mip_count > 1
	return Image.create_from_data(width, height, has_mipmaps, godot_format, data)


## Apply a cached texture to all pending objects waiting for it (O(1) via reverse index).
## For PBR faces, this may be called multiple times as albedo/normal/ORM/emissive arrive.
## Each call creates a material with all currently-cached textures (progressive refinement).
func _apply_texture_to_pending(texture_id: String) -> void:
	# Apply projection texture to any lights waiting for it (check BEFORE early return)
	if _pending_proj_textures.has(texture_id):
		var waiting_ids: Array = _pending_proj_textures[texture_id]
		_pending_proj_textures.erase(texture_id)
		for lid: int in waiting_ids:
			var rsl: RSLight = object_lights.get(lid)
			if rsl != null and rsl.is_spot:
				print("[Light] Applying proj texture %s to localId=%d" % [texture_id, lid])
				RenderingServer.light_set_projector(rsl.light_rid, _get_projector_texture_rid(texture_id))

	if not _pending_by_texture.has(texture_id):
		return

	var entries: Array = _pending_by_texture[texture_id]
	_pending_by_texture.erase(texture_id)

	for entry: Dictionary in entries:
		var local_id: int = entry["localId"]
		var face_info: Dictionary = entry["faceInfo"]
		var rsi: RSInstance = objects.get(local_id)
		if rsi != null:
			var albedo_id: String = face_info["textureId"]
			# Only apply material once albedo is cached (minimum requirement)
			if texture_cache.has(albedo_id):
				var face_idx: int = face_info["faceIndex"]
				var uv: Dictionary = face_info.get("uv", {})
				var am: int = int(face_info.get("alphaMode", -1))
				var ac: float = float(face_info.get("alphaCutoff", 0.5))
				var pbr: Dictionary = face_info.get("pbr", {})
				var mt: int = int(face_info.get("mappingType", 0))
				rsi.set_surface_material(face_idx, _get_or_create_material(
					albedo_id, face_info["color"], face_info["fullBright"],
					face_info["doubleSided"], uv, am, ac, pbr, mt))

		# Check if this face still has uncached textures
		var still_pending := false
		var pbr_info: Dictionary = face_info.get("pbr", {})
		for tid: String in _get_face_texture_ids(face_info["textureId"], pbr_info):
			if not texture_cache.has(tid) and not texture_load_failed.has(tid):
				still_pending = true
				# Re-register under remaining uncached texture IDs
				if not _pending_by_texture.has(tid):
					_pending_by_texture[tid] = []
				# Avoid duplicate entries
				var already := false
				for existing: Dictionary in _pending_by_texture[tid]:
					if existing["localId"] == local_id and existing["faceInfo"]["faceIndex"] == face_info["faceIndex"]:
						already = true
						break
				if not already:
					_pending_by_texture[tid].append(entry)

		# Remove from per-object pending list only when ALL textures are resolved
		if not still_pending and pending_textures.has(local_id):
			var face_list: Array = pending_textures[local_id]
			var face_idx_to_remove: int = face_info["faceIndex"]
			face_list = face_list.filter(func(fi: Dictionary) -> bool: return fi["faceIndex"] != face_idx_to_remove)
			if face_list.size() == 0:
				pending_textures.erase(local_id)
			else:
				pending_textures[local_id] = face_list



## Get all texture IDs a face needs (albedo + PBR textures)
func _get_face_texture_ids(albedo_id: String, pbr: Dictionary) -> Array:
	var ids: Array = [albedo_id]
	var nid: String = pbr.get("normalTextureId", "")
	var oid: String = pbr.get("ormTextureId", "")
	var eid: String = pbr.get("emissiveTextureId", "")
	if not nid.is_empty():
		ids.append(nid)
	if not oid.is_empty():
		ids.append(oid)
	if not eid.is_empty():
		ids.append(eid)
	return ids


func _process(_delta: float) -> void:
	# Periodic VRAM / scene stats (skipped in VR — no console visible, avoid driver stalls)
	_stats_timer += _delta
	if _stats_timer >= STATS_INTERVAL and not _vr_mode:
		_stats_timer = 0.0
		var tex_mem: int = 0
		var buf_mem: int = 0
		var rd := RenderingServer.get_rendering_device()
		if rd:
			tex_mem = rd.get_memory_usage(RenderingDevice.MEMORY_TEXTURES)
			buf_mem = rd.get_memory_usage(RenderingDevice.MEMORY_BUFFERS)
			# Note: MEMORY_TOTAL is intentionally omitted — it flushes the GPU
			# pipeline on many drivers and causes multi-ms main-thread stalls.
		print("[Stats] VRAM: tex=%.1fMB buf=%.1fMB | Objects: %d | Avatars: %d | Lights: %d/%d | Tex cache: %d | Mat cache: %d | Mesh cache: %d | FPS: %.0f" % [
			tex_mem / 1048576.0, buf_mem / 1048576.0,
			objects.size(), avatars.size(), _light_count, _object_light_data.size(),
			texture_cache.size(), material_cache.size(), mesh_cache.size(),
			Engine.get_frames_per_second()])

	# Step FFT ocean simulation (Ocean3D is a Resource, not a Node, so we
	# drive it here rather than relying on its own _process).
	# initialize_simulation() schedules work on the render thread asynchronously,
	# so guard on .initialized before calling simulate().
	if _ocean != null:
		if _ocean.initialized:
			if not _ocean_logged_ready:
				_ocean_logged_ready = true
				print("[Water] Ocean3D render-thread init complete — simulation active")
			_ocean.simulate(_delta)
		# else: still waiting for render thread to finish _initialize_simulation

	# Interpolate avatar positions/rotations toward their targets
	_interpolate_avatars(_delta)

	# Periodic light distance culling sweep
	_light_cull_timer += _delta
	if _light_cull_timer >= LIGHT_CULL_INTERVAL:
		_light_cull_timer = 0.0
		_sweep_light_culling()

	# Submit queued mesh work to WorkerThreadPool
	if _mesh_queue.size() > 0:
		_submit_mesh_tasks()

	# Grab completed texture results from worker threads
	var tex_batch: Array = []
	_texture_results_lock.lock()
	if _texture_results.size() > 0:
		tex_batch = _texture_results.duplicate()
		_texture_results.clear()
	_texture_results_lock.unlock()

	var has_textures := tex_batch.size() > 0
	var has_meshes := not _mesh_tasks.is_empty()
	if not has_textures and not has_meshes:
		return

	# Adaptive budget: use whatever time remains before the frame deadline.
	var frame_start_ms := (Time.get_ticks_usec() / 1000.0) - (_delta * 1000.0)
	var now_ms := Time.get_ticks_usec() / 1000.0
	var elapsed_ms := now_ms - frame_start_ms
	var remaining_ms := _target_frame_ms - elapsed_ms
	var budget_ms: float
	if _vr_mode:
		# In VR, never do finalization on an already-late frame — the deadline
		# is missed, adding more CPU work only makes the next frame late too.
		budget_ms = clampf(remaining_ms, 0.0, MIN_FINALIZE_MS)
	else:
		# Desktop: when over budget be aggressive — frame is slow anyway.
		budget_ms = maxf(remaining_ms, OVERBUDGET_FINALIZE_MS if remaining_ms < MIN_FINALIZE_MS else MIN_FINALIZE_MS)
	# Split: 60% textures, 40% meshes (textures are cheaper per-item)
	var tex_budget_ms := budget_ms * 0.6 if has_meshes else budget_ms
	var mesh_budget_ms := budget_ms * 0.4 if has_textures else budget_ms

	var start_ms := now_ms

	# Finalize completed textures (time-budgeted)
	if has_textures:
		var processed := 0
		for entry: Dictionary in tex_batch:
			if (Time.get_ticks_usec() / 1000.0) - start_ms >= tex_budget_ms:
				# Put unprocessed results back for next frame
				_texture_results_lock.lock()
				for j in range(processed, tex_batch.size()):
					_texture_results.append(tex_batch[j])
				_texture_results_lock.unlock()
				break
			var texture_id: String = entry["textureId"]
			var img: Image = entry["image"]
			_texture_in_flight.erase(texture_id)
			if img == null:
				texture_load_failed[texture_id] = true
			else:
				# DXT1 = opaque (no alpha), DXT5 = has alpha channel
				_texture_opaque[texture_id] = (img.get_format() == Image.FORMAT_DXT1)
				var _t0 := Time.get_ticks_usec()
				texture_cache[texture_id] = ImageTexture.create_from_image(img)
				var _t1 := Time.get_ticks_usec()
				_apply_texture_to_pending(texture_id)
				var _t2 := Time.get_ticks_usec()
				_fin_tex_create_ms += (_t1 - _t0) / 1000.0
				_fin_tex_apply_ms += (_t2 - _t1) / 1000.0
				_fin_tex_count += 1
				_tex_finalized_count += 1
			processed += 1

	# Finalize completed mesh tasks (time-budgeted, uses remaining budget)
	if has_meshes:
		var mesh_start_ms := Time.get_ticks_usec() / 1000.0
		var done_ids: Array = []
		for task_id: int in _mesh_tasks:
			if (Time.get_ticks_usec() / 1000.0) - mesh_start_ms >= mesh_budget_ms:
				break
			if not WorkerThreadPool.is_task_completed(task_id):
				continue
			WorkerThreadPool.wait_for_task_completion(task_id)
			done_ids.append(task_id)
			var info: Dictionary = _mesh_tasks[task_id]
			var mesh_id: String = info["meshId"]
			var result: AsyncResult = info["result"]
			_mesh_in_flight.erase(mesh_id)
			if result.error or result.gltf_state == null:
				mesh_load_failed[mesh_id] = true
			else:
				# Extract mesh via ImporterMesh — no Node tree, no queue_free
				var gltf_meshes: Array = result.gltf_state.get_meshes()
				if gltf_meshes.is_empty():
					mesh_load_failed[mesh_id] = true
				else:
					var importer_mesh: ImporterMesh = gltf_meshes[0].mesh
					if importer_mesh == null:
						mesh_load_failed[mesh_id] = true
					else:
						var _t0 := Time.get_ticks_usec()
						var m: Mesh = importer_mesh.get_mesh()
						var _t1 := Time.get_ticks_usec()
						if m == null:
							mesh_load_failed[mesh_id] = true
						else:
							mesh_cache[mesh_id] = m
							_apply_mesh_to_pending(mesh_id)
							var _t2 := Time.get_ticks_usec()
							_fin_mesh_extract_ms += (_t1 - _t0) / 1000.0
							_fin_mesh_apply_ms += (_t2 - _t1) / 1000.0
							_fin_mesh_count += 1
							_mesh_finalized_count += 1
		for task_id: int in done_ids:
			_mesh_tasks.erase(task_id)

	# Track budget stats
	_budget_samples += 1
	_budget_elapsed_ms += elapsed_ms
	_budget_total_ms += budget_ms
	_budget_used_ms += (Time.get_ticks_usec() / 1000.0) - start_ms


## Apply per-face materials to an RSInstance.
## Faces with cached textures are applied immediately; others go to pending_textures.
func _apply_face_materials(rsi: RSInstance, local_id: int, faces: Array) -> void:
	rsi.set_material_override(null)
	var surface_count: int = rsi.mesh.get_surface_count() if rsi.mesh else 0
	var pending: Array = []

	for fi: Dictionary in faces:
		var face_idx: int = int(fi.get("index", 0))
		var texture_id: String = str(fi.get("textureId", ""))
		var color: Array = fi.get("color", [1, 1, 1, 1])
		var full_bright: bool = fi.get("fullBright", false)
		var double_sided: bool = fi.get("doubleSided", false)
		var alpha_mode: int = int(fi.get("alphaMode", -1))
		var alpha_cutoff: float = float(fi.get("alphaCutoff", 0.5))
		var mapping_type: int = int(fi.get("mappingType", 0))
		var uv_info: Dictionary = {
			"repeatU": fi.get("repeatU", 1.0),
			"repeatV": fi.get("repeatV", 1.0),
			"offsetU": fi.get("offsetU", 0.0),
			"offsetV": fi.get("offsetV", 0.0),
			"texRotation": fi.get("rotation", 0.0)
		}

		# PBR fields (optional — only present for faces with glTF material overrides)
		var pbr: Dictionary = {}
		if fi.get("isPBR", false):
			pbr["isPBR"] = true
			if fi.has("normalTextureId"):
				pbr["normalTextureId"] = str(fi["normalTextureId"])
			if fi.has("ormTextureId"):
				pbr["ormTextureId"] = str(fi["ormTextureId"])
			if fi.has("emissiveTextureId"):
				pbr["emissiveTextureId"] = str(fi["emissiveTextureId"])
			if fi.has("metallicFactor"):
				pbr["metallicFactor"] = float(fi["metallicFactor"])
			if fi.has("roughnessFactor"):
				pbr["roughnessFactor"] = float(fi["roughnessFactor"])
			if fi.has("emissiveFactor"):
				pbr["emissiveFactor"] = fi["emissiveFactor"]
			if fi.has("pbrBaseColor"):
				pbr["pbrBaseColor"] = fi["pbrBaseColor"]

		if texture_id.is_empty():
			continue

		# Skip faces beyond the mesh's actual surface count
		if face_idx >= surface_count:
			continue

		# Collect all texture IDs this face needs (albedo + PBR textures)
		var all_tex_ids: Array = [texture_id]
		var normal_id: String = pbr.get("normalTextureId", "")
		var orm_id: String = pbr.get("ormTextureId", "")
		var emissive_id: String = pbr.get("emissiveTextureId", "")
		if not normal_id.is_empty():
			all_tex_ids.append(normal_id)
		if not orm_id.is_empty():
			all_tex_ids.append(orm_id)
		if not emissive_id.is_empty():
			all_tex_ids.append(emissive_id)

		# Check if albedo is cached (minimum requirement to apply any material)
		var albedo_cached := texture_cache.has(texture_id)

		if albedo_cached:
			rsi.set_surface_material(face_idx, _get_or_create_material(
				texture_id, color, full_bright, double_sided, uv_info, alpha_mode, alpha_cutoff, pbr, mapping_type))
		else:
			rsi.set_surface_material(face_idx, _make_placeholder_material(color, full_bright, double_sided))

		# Register under any not-yet-cached texture IDs for progressive refinement
		var has_pending := false
		var pending_info := {
			"faceIndex": face_idx,
			"textureId": texture_id,
			"color": color,
			"fullBright": full_bright,
			"doubleSided": double_sided,
			"alphaMode": alpha_mode,
			"alphaCutoff": alpha_cutoff,
			"uv": uv_info,
			"pbr": pbr,
			"mappingType": mapping_type
		}
		for tid: String in all_tex_ids:
			if not texture_cache.has(tid) and not texture_load_failed.has(tid):
				has_pending = true
				if not _pending_by_texture.has(tid):
					_pending_by_texture[tid] = []
				_pending_by_texture[tid].append({ "localId": local_id, "faceInfo": pending_info })

		if has_pending:
			pending.append(pending_info)

	if pending.size() > 0:
		pending_textures[local_id] = pending


func _get_double_sided_shader(shader: Shader) -> Shader:
	if _double_sided_shader_cache.has(shader):
		return _double_sided_shader_cache[shader]
	var ds := Shader.new()
	ds.code = shader.code.replace("cull_back", "cull_disabled")
	_double_sided_shader_cache[shader] = ds
	return ds


func _get_or_create_material(texture_id: String, color: Array, full_bright: bool, double_sided: bool, uv_info: Dictionary = {}, alpha_mode: int = -1, alpha_cutoff: float = 0.5, pbr: Dictionary = {}, mapping_type: int = 0) -> Material:
	_material_lookups += 1

	# Resolve effective alpha: promote known-opaque textures to mode 0 (fully opaque)
	# so they skip the transparency pipeline entirely
	var resolved_mode := alpha_mode
	if alpha_mode == -1 and color[3] >= 1.0 and _texture_opaque.get(texture_id, false):
		resolved_mode = 0

	# PBR params
	var is_pbr: bool = pbr.get("isPBR", false)
	var normal_id: String = pbr.get("normalTextureId", "")
	var orm_id: String = pbr.get("ormTextureId", "")
	var emissive_id: String = pbr.get("emissiveTextureId", "")
	var metallic_factor: float = 0.0
	var roughness_factor: float = 1.0
	if is_pbr:
		metallic_factor = float(pbr.get("metallicFactor", 1.0))
		roughness_factor = float(pbr.get("roughnessFactor", 1.0))
	var emissive_factor: Array = pbr.get("emissiveFactor", [0, 0, 0])
	# Only include PBR tex IDs in key if they're actually cached (so key changes on arrival)
	var norm_key: String = ""
	if not normal_id.is_empty() and texture_cache.has(normal_id):
		norm_key = normal_id
	var orm_key: String = ""
	if not orm_id.is_empty() and texture_cache.has(orm_id):
		orm_key = orm_id
	var emis_key: String = ""
	if not emissive_id.is_empty() and texture_cache.has(emissive_id):
		emis_key = emissive_id

	# Build cache key from texture + color + fullbright + doubleSided + UV + alpha + PBR params
	var color_hex := Color(color[0], color[1], color[2], color[3]).to_html()
	var fb_str := "1" if full_bright else "0"
	var ds_str := "1" if double_sided else "0"
	var ru_val = uv_info.get("repeatU", 1.0)
	var ru: float = ru_val if ru_val != null else 1.0
	var rv_val = uv_info.get("repeatV", 1.0)
	var rv: float = rv_val if rv_val != null else 1.0
	var ou_val = uv_info.get("offsetU", 0.0)
	var ou: float = ou_val if ou_val != null else 0.0
	var ov_val = uv_info.get("offsetV", 0.0)
	var ov: float = ov_val if ov_val != null else 0.0
	var tr_val = uv_info.get("texRotation", 0.0)
	var tr: float = tr_val if tr_val != null else 0.0
	# Round UV params to 2 decimal places — collapses near-duplicates from floating-point
	# protocol noise (e.g. 1.0001 vs 1.0) into shared materials, cutting material count.
	var uv_key := "%.2f_%.2f_%.2f_%.2f_%.2f" % [ru, rv, ou, ov, tr]
	var alpha_key := "%d_%.2f" % [resolved_mode, alpha_cutoff]
	var pbr_key := ""
	if is_pbr:
		pbr_key = "_%s_%s_%s_%.2f_%.2f_%.2f_%.2f_%.2f" % [
			norm_key, orm_key, emis_key,
			metallic_factor, roughness_factor,
			emissive_factor[0], emissive_factor[1], emissive_factor[2]]
	var map_key := "m%d" % mapping_type if mapping_type != 0 else ""
	var key := "%s_%s_%s_%s_%s_%s%s%s" % [texture_id, color_hex, fb_str, ds_str, uv_key, alpha_key, pbr_key, map_key]

	if material_cache.has(key):
		return material_cache[key]

	# Planar mapping uses a custom ShaderMaterial that implements SL's planarProjection()
	if mapping_type == 2:
		var mat := ShaderMaterial.new()
		# Pick opaque vs alpha-blend shader variant
		var use_alpha: bool = resolved_mode == 1 or (resolved_mode == -1 and color[3] < 1.0)
		var shader: Shader = PlanarMapAlphaShader if use_alpha else PlanarMapShader
		if double_sided:
			shader = _get_double_sided_shader(shader)
		mat.shader = shader
		mat.set_shader_parameter("albedo_tex", texture_cache[texture_id])
		mat.set_shader_parameter("albedo_color", Color(color[0], color[1], color[2], color[3]))
		mat.set_shader_parameter("repeat_u", ru)
		mat.set_shader_parameter("repeat_v", rv)
		mat.set_shader_parameter("offset_u", ou)
		mat.set_shader_parameter("offset_v", ov)
		mat.set_shader_parameter("tex_rotation", tr)
		mat.set_shader_parameter("full_bright", full_bright)
		# Alpha scissor (opaque variant only — alpha variant uses smooth blending)
		if not use_alpha:
			if resolved_mode == 2:
				mat.set_shader_parameter("alpha_scissor_threshold", alpha_cutoff)
			elif resolved_mode == -1 and color[3] >= 1.0:
				mat.set_shader_parameter("alpha_scissor_threshold", 0.5)
		material_cache[key] = mat
		return mat

	# Texture rotation requires a custom shader (StandardMaterial3D has no rotation property)
	if abs(tr) > 0.001:
		var smat := ShaderMaterial.new()
		# Pick opaque vs alpha-blend shader variant
		var use_alpha: bool = resolved_mode == 1 or (resolved_mode == -1 and color[3] < 1.0)
		var shader: Shader = StandardUVAlphaShader if use_alpha else StandardUVShader
		if double_sided:
			shader = _get_double_sided_shader(shader)
		smat.shader = shader
		smat.set_shader_parameter("albedo_tex", texture_cache[texture_id])
		smat.set_shader_parameter("albedo_color", Color(color[0], color[1], color[2], color[3]))
		smat.set_shader_parameter("repeat_u", ru)
		smat.set_shader_parameter("repeat_v", rv)
		smat.set_shader_parameter("offset_u", ou)
		smat.set_shader_parameter("offset_v", ov)
		smat.set_shader_parameter("tex_rotation", tr)
		smat.set_shader_parameter("full_bright", full_bright)
		# Alpha scissor (opaque variant only — alpha variant uses smooth blending)
		if not use_alpha:
			if resolved_mode == 2:
				smat.set_shader_parameter("alpha_scissor_threshold", alpha_cutoff)
			elif resolved_mode == -1 and color[3] >= 1.0:
				smat.set_shader_parameter("alpha_scissor_threshold", 0.5)
		material_cache[key] = smat
		return smat

	var mat := StandardMaterial3D.new()
	mat.albedo_texture = texture_cache[texture_id]
	mat.albedo_color = Color(color[0], color[1], color[2], color[3])

	# UV repeat and offset — SL's xform() centers at 0.5 before scaling:
	#   sl: uv = (uv - 0.5) * repeat + offset + 0.5
	# Mesh UVs have V flipped (Godot convention), so V offset sign is negated.
	mat.uv1_scale = Vector3(ru, rv, 1.0)
	mat.uv1_offset = Vector3(ou + 0.5 * (1.0 - ru), -ov + 0.5 * (1.0 - rv), 0.0)

	# Cull mode: double-sided disables backface culling
	if double_sided:
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED

	# Alpha handling (uses resolved_mode — opaque textures promoted to mode 0)
	if resolved_mode == 0:
		# Fully opaque — no transparency pipeline overhead
		pass
	elif resolved_mode == 1:
		# GLTF BLEND — smooth alpha blending
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	elif resolved_mode == 2:
		# GLTF MASK — alpha scissor with explicit cutoff
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		mat.alpha_scissor_threshold = alpha_cutoff
	else:
		# Standard SL (alpha_mode == -1), texture has alpha or color is semi-transparent
		if color[3] < 1.0:
			mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		else:
			# Texture has actual alpha channel — scissor for trees, fences, etc.
			mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
			mat.alpha_scissor_threshold = 0.5

	# Fullbright = unshaded
	if full_bright:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	# --- PBR properties ---
	if is_pbr:
		mat.metallic = metallic_factor
		mat.roughness = roughness_factor

		# ORM texture (R=ambient occlusion, G=roughness, B=metallic) — glTF standard
		if not orm_key.is_empty():
			var orm_tex: Texture2D = texture_cache[orm_id]
			mat.metallic_texture = orm_tex
			mat.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_BLUE
			mat.roughness_texture = orm_tex
			mat.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
			mat.ao_enabled = true
			mat.ao_texture = orm_tex
			mat.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED

		# Normal map
		if not norm_key.is_empty():
			mat.normal_enabled = true
			mat.normal_texture = texture_cache[normal_id]

		# Emissive
		var ef: Array = emissive_factor
		var has_emission_factor: bool = float(ef[0]) > 0 or float(ef[1]) > 0 or float(ef[2]) > 0
		if has_emission_factor:
			mat.emission_enabled = true
			mat.emission = Color(ef[0], ef[1], ef[2])
			mat.emission_energy_multiplier = 1.0
		if not emis_key.is_empty():
			mat.emission_enabled = true
			mat.emission_texture = texture_cache[emissive_id]

	material_cache[key] = mat
	return mat


func _make_placeholder_material(color: Array, full_bright: bool, double_sided: bool) -> StandardMaterial3D:
	# Cached solid-color placeholder shown while texture downloads
	var color_hex := Color(color[0], color[1], color[2], color[3]).to_html()
	var fb_str := "1" if full_bright else "0"
	var ds_str := "1" if double_sided else "0"
	var key := "%s_%s_%s" % [color_hex, fb_str, ds_str]

	if _placeholder_cache.has(key):
		return _placeholder_cache[key]

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(color[0], color[1], color[2], color[3])

	if double_sided:
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED

	if color[3] < 1.0:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		mat.alpha_scissor_threshold = 0.5

	if full_bright:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	_placeholder_cache[key] = mat
	return mat


# ─── Self Avatar ─────────────────────────────────────

var _first_person_mode: bool = false


func set_vr_mode(enabled: bool) -> void:
	_vr_mode = enabled
	_target_frame_ms = VRFrameBudget.VR_FINALIZE_STOP_MS if enabled else VRFrameBudget.DESKTOP_FRAME_MS
	_vis_far = VRFrameBudget.VR_CAMERA_FAR if enabled else VISIBILITY_FAR
	_vis_fade = VRFrameBudget.VR_VISIBILITY_FADE_MARGIN if enabled else VISIBILITY_FADE_MARGIN
	for rsi in objects.values():
		rsi.set_vis_range(_vis_far, _vis_fade)
	for rsi in avatars.values():
		rsi.set_vis_range(_vis_far, _vis_fade)


func set_first_person_mode(enabled: bool) -> void:
	_first_person_mode = enabled
	_apply_self_avatar_visibility()


func _apply_self_avatar_visibility() -> void:
	if self_avatar_id.is_empty():
		return
	var rsi: RSInstance = avatars.get(self_avatar_id)
	if rsi != null:
		RenderingServer.instance_set_visible(rsi.rid, not _first_person_mode)


func set_self_avatar_id(id: String) -> void:
	self_avatar_id = id
	# If we already have this avatar, emit its position and apply visibility
	if avatars.has(id):
		self_avatar_moved.emit(avatars[id].pos)
	_apply_self_avatar_visibility()


## Set the self avatar's yaw directly (for instant A/D feedback)
func set_self_avatar_yaw(godot_yaw: float) -> void:
	if self_avatar_id.is_empty():
		return
	var rsi: RSInstance = avatars.get(self_avatar_id)
	if rsi == null:
		return
	# Godot yaw around Y axis
	rsi.rot = Quaternion(Vector3.UP, godot_yaw)
	rsi.push_transform()


## Return click-detection data for the self avatar, or empty dict if unavailable
func get_self_avatar_click_data() -> Dictionary:
	if self_avatar_id.is_empty():
		return {}
	var rsi: RSInstance = avatars.get(self_avatar_id)
	if rsi == null or rsi.mesh == null:
		return {}
	var xform := Transform3D(Basis(rsi.rot) * Basis.from_scale(rsi.scl), rsi.pos)
	return { "position": rsi.pos, "transform": xform, "aabb": rsi.mesh.get_aabb() }


# ─── Avatar Handlers ──────────────────────────────────

func handle_avatar_create(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	if avatar_id.is_empty():
		return

	# Remove existing if duplicate
	if avatars.has(avatar_id):
		avatars[avatar_id].destroy()
		avatar_targets.erase(avatar_id)

	var rsi := RSInstance.new(_scenario, _vis_far, _vis_fade)
	rsi.set_mesh(avatar_mesh)
	rsi.set_material_override(avatar_material)

	var pos: Array = msg.get("position", [128, 128, 25])
	var godot_pos := sl_to_godot_pos(pos)
	godot_pos.y += 0.9
	rsi.pos = godot_pos

	var godot_rot := Quaternion.IDENTITY
	if msg.has("rotation"):
		godot_rot = sl_to_godot_quat(msg["rotation"])
		rsi.rot = godot_rot

	rsi.push_transform()
	avatars[avatar_id] = rsi

	# Initialize interpolation target at current position (no lerp on first frame)
	avatar_targets[avatar_id] = { "pos": godot_pos, "rot": godot_rot, "vel": Vector3.ZERO }

	if avatar_id == self_avatar_id:
		self_avatar_moved.emit(rsi.pos)
		_apply_self_avatar_visibility()


func handle_avatar_update(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	if not avatars.has(avatar_id):
		return
	_apply_avatar_target(avatar_id, msg)


func handle_avatar_update_batch(msg: Dictionary) -> void:
	var avatar_list: Array = msg.get("avatars", [])
	for entry: Dictionary in avatar_list:
		var avatar_id: String = entry.get("id", "")
		if avatar_id.is_empty() or not avatars.has(avatar_id):
			continue
		_apply_avatar_target(avatar_id, entry)


## Set interpolation target for an avatar from an update message
func _apply_avatar_target(avatar_id: String, data: Dictionary) -> void:
	var target: Dictionary = avatar_targets.get(avatar_id, {})

	if data.has("position"):
		var godot_pos := sl_to_godot_pos(data["position"])
		godot_pos.y += 0.9
		target["pos"] = godot_pos

	if data.has("rotation"):
		target["rot"] = sl_to_godot_quat(data["rotation"])

	if data.has("velocity"):
		# Convert SL velocity to Godot coords (same transform as position axes)
		var sl_vel: Array = data["velocity"]
		target["vel"] = Vector3(sl_vel[0], sl_vel[2], -sl_vel[1])
	else:
		target["vel"] = Vector3.ZERO

	avatar_targets[avatar_id] = target


func handle_avatar_kill(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	if avatars.has(avatar_id):
		avatars[avatar_id].destroy()
		avatars.erase(avatar_id)
		avatar_targets.erase(avatar_id)


# ─── Avatar Interpolation ────────────────────────────

## Smoothly move all avatars toward their targets each frame
func _interpolate_avatars(delta: float) -> void:
	for avatar_id: String in avatar_targets:
		var rsi: RSInstance = avatars.get(avatar_id)
		if rsi == null:
			continue

		var target: Dictionary = avatar_targets[avatar_id]
		var target_pos: Vector3 = target.get("pos", rsi.pos)
		var target_rot: Quaternion = target.get("rot", rsi.rot)
		var vel: Vector3 = target.get("vel", Vector3.ZERO)

		# Predict slightly ahead using velocity (clamped to avoid runaway)
		var predicted_pos := target_pos
		if vel.length_squared() > 0.001:
			# Extrapolate up to AVATAR_MAX_EXTRAP_TIME seconds ahead
			var extrap := vel * minf(delta, AVATAR_MAX_EXTRAP_TIME)
			predicted_pos = target_pos + extrap

		var dist := rsi.pos.distance_to(predicted_pos)

		if dist > AVATAR_MAX_INTERP_DIST:
			# Too far — snap immediately (don't lag off into the sunset)
			rsi.pos = target_pos
			rsi.rot = target_rot
		elif dist > 0.001:
			# Smooth lerp toward predicted position
			var t := clampf(AVATAR_LERP_SPEED * delta, 0.0, 1.0)
			rsi.pos = rsi.pos.lerp(predicted_pos, t)
			rsi.rot = rsi.rot.slerp(target_rot, clampf(AVATAR_SLERP_SPEED * delta, 0.0, 1.0))
		else:
			# Close enough — just slerp rotation
			rsi.rot = rsi.rot.slerp(target_rot, clampf(AVATAR_SLERP_SPEED * delta, 0.0, 1.0))

		rsi.push_transform()

		# Emit camera follow signal for self avatar
		if avatar_id == self_avatar_id:
			self_avatar_moved.emit(rsi.pos)


# ─── Terrain + Water + Sky ───────────────────────────

var terrain_node: MeshInstance3D
var water_node: MeshInstance3D  # fallback flat plane (used if oceanfft addon absent)
var _ocean: Resource = null     # Ocean3D resource (FFT wave simulation)
var _ocean_quad_tree: Node3D = null  # QuadTree3D LOD mesh renderer
var _ocean_logged_ready: bool = false  # one-shot log when render-thread init completes

func handle_terrain_ready(msg: Dictionary) -> void:
	var bin_path: String = msg.get("path", "")
	if bin_path.is_empty():
		push_warning("[SceneManager] terrain_ready: no path")
		return

	# Read raw Float32LE binary (256*256*4 = 262144 bytes)
	var f := FileAccess.open(bin_path, FileAccess.READ)
	if f == null:
		push_warning("[SceneManager] terrain_ready: can't open %s" % bin_path)
		return

	var heights := PackedFloat32Array()
	heights.resize(65536)
	for i in range(65536):
		heights[i] = f.get_float()
	f.close()

	# Build and add terrain mesh
	var mesh := _build_terrain_mesh(heights)
	if terrain_node:
		terrain_node.queue_free()
	terrain_node = MeshInstance3D.new()
	terrain_node.mesh = mesh

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.36, 0.50, 0.25)  # Green-brown ground
	mat.roughness = 0.9
	terrain_node.material_override = mat

	add_child(terrain_node)

	# Build water plane
	var water_height: float = float(msg.get("waterHeight", 20.0))
	_build_water_plane(water_height)


func _build_terrain_mesh(heights: PackedFloat32Array) -> ArrayMesh:
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var indices := PackedInt32Array()

	verts.resize(256 * 256)
	normals.resize(256 * 256)

	# Place vertices: Godot coords = (x, height, -y) matching SL->Godot convention
	for y in range(256):
		for x in range(256):
			var idx := y * 256 + x
			var h: float = heights[idx]
			verts[idx] = Vector3(float(x), h, -float(y))

	# Compute normals from height differences
	for y in range(256):
		for x in range(256):
			var idx := y * 256 + x
			# Sample adjacent heights (clamp at edges)
			var hL: float = heights[y * 256 + maxi(x - 1, 0)]
			var hR: float = heights[y * 256 + mini(x + 1, 255)]
			var hD: float = heights[mini(y + 1, 255) * 256 + x]
			var hU: float = heights[maxi(y - 1, 0) * 256 + x]
			# Normal from cross product of tangent vectors
			# dX tangent: (2, hR-hL, 0), dY tangent: (0, hU-hD, -2) [note -y in Godot]
			var n := Vector3(hL - hR, 2.0, hD - hU).normalized()
			normals[idx] = n

	# Build triangle indices: 255x255 cells, 2 triangles each
	indices.resize(255 * 255 * 6)
	var ii := 0
	for y in range(255):
		for x in range(255):
			var tl := y * 256 + x
			var tr := tl + 1
			var bl := (y + 1) * 256 + x
			var br := bl + 1
			# Triangle 1: tl, bl, tr
			indices[ii] = tl; ii += 1
			indices[ii] = bl; ii += 1
			indices[ii] = tr; ii += 1
			# Triangle 2: tr, bl, br
			indices[ii] = tr; ii += 1
			indices[ii] = bl; ii += 1
			indices[ii] = br; ii += 1

	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = normals
	arr[Mesh.ARRAY_INDEX] = indices

	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return mesh


func _build_water_plane(water_height: float) -> void:
	print("[Water] _build_water_plane called, water_height=", water_height)

	# Tear down any existing water
	if water_node:
		water_node.queue_free()
		water_node = null
	if _ocean_quad_tree:
		_ocean_quad_tree.queue_free()
		_ocean_quad_tree = null
	_ocean = null
	_ocean_logged_ready = false

	var Ocean3DScript = load("res://addons/tessarakkt.oceanfft/components/Ocean3D.gd")
	var QuadTreeScene = load("res://addons/tessarakkt.oceanfft/components/QuadTree3D.tscn")

	print("[Water] Ocean3DScript=", Ocean3DScript, " QuadTreeScene=", QuadTreeScene)

	if Ocean3DScript == null or QuadTreeScene == null:
		push_warning("[Water] oceanfft addon not found — using flat water fallback (Ocean3DScript=%s QuadTreeScene=%s)" % [Ocean3DScript, QuadTreeScene])
		_build_flat_water(water_height)
		return

	print("[Water] oceanfft addon loaded OK — building FFT ocean")

	# ── Ocean3D resource (FFT simulation, no scene-tree node needed) ──────
	_ocean = Ocean3DScript.new()
	# 128×128 FFT: good wave detail, moderate GPU cost. Use 256 for more
	# detail at the cost of ~4× compute, or 64 for low-end / VR perf saves.
	_ocean.fft_resolution = 128          # FFTResolution.FFT_128x128
	_ocean.horizontal_dimension = 256    # patch size in metres (tiles seamlessly)
	_ocean.wind_speed = 12.0             # m/s — controls swell size
	_ocean.wind_direction_degrees = 45.0
	_ocean.choppiness = 0.6
	_ocean.time_scale = 1.0
	_ocean.simulation_frameskip = 1      # simulate every other frame (VR budget)
	_ocean.domain_warp_strength = 0.0   # disable domain warp (no noise texture)

	# Translucency: shallow water see-through, deep water murkier
	_ocean.material.set_shader_parameter("water_opacity", 1.0)
	_ocean.material.set_shader_parameter("opacity_depth", 5.0)
	_ocean.material.set_shader_parameter("refraction_background_brightness", 0.5)
	_ocean.material.set_shader_parameter("deep_color", Color(0.01, 0.04, 0.1, 1.0))

	print("[Water] Ocean3D resource created, fft_resolution=", _ocean.fft_resolution,
		" horizontal_dimension=", _ocean.horizontal_dimension,
		" material=", _ocean.material)

	# initialize_simulation() compiles GLSL compute shaders and allocates GPU
	# textures. Must be called before simulate() and before QuadTree3D._ready().
	# NOTE: This dispatches to the render thread — _ocean.initialized will be
	# false until the render thread callback completes (next frame or later).
	_ocean.initialize_simulation()
	print("[Water] initialize_simulation() queued on render thread (initialized=", _ocean.initialized, " — will become true once render thread completes)")

	# ── QuadTree3D node (LOD mesh renderer) ───────────────────────────────
	_ocean_quad_tree = QuadTreeScene.instantiate()
	_ocean_quad_tree.name = "OceanQuadTree"
	# Y = water_height positions the mesh base at the SL water surface; FFT
	# displacement is added on top by the vertex shader.
	_ocean_quad_tree.position = Vector3(127.5, water_height, -127.5)
	# Share the Ocean3D material so the vertex shader sees the FFT textures.
	_ocean_quad_tree.material = _ocean.material
	# LOD config: 5 levels, root quad 4096 m, finest ~128 m. Six range values
	# tell the tree at what camera distance each LOD level activates.
	_ocean_quad_tree.lod_level = 5
	_ocean_quad_tree.quad_size = 4096.0
	_ocean_quad_tree.mesh_vertex_resolution = 64
	_ocean_quad_tree.morph_range = 0.3
	var ocean_ranges: Array[float] = [48.0, 96.0, 192.0, 384.0, 768.0, 1536.0]
	_ocean_quad_tree.set("ranges", ocean_ranges)

	print("[Water] QuadTree3D configured: position=", _ocean_quad_tree.position,
		" lod_level=", _ocean_quad_tree.lod_level,
		" material=", _ocean_quad_tree.material)

	add_child(_ocean_quad_tree)
	print("[Water] OceanQuadTree added to scene tree")


func _build_flat_water(water_height: float) -> void:
	water_node = MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(256.0, 256.0)
	water_node.mesh = plane
	water_node.position = Vector3(127.5, water_height, -127.5)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.1, 0.3, 0.5, 0.5)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.roughness = 0.1
	mat.metallic = 0.3
	water_node.material_override = mat
	add_child(water_node)


func handle_environment_data(msg: Dictionary) -> void:
	var sun_dir_arr: Array = msg.get("sunDirection", [0.5, 0.7, -0.5])
	var sun_color_arr: Array = msg.get("sunColor", [1.0, 0.95, 0.8])
	var ambient_arr: Array = msg.get("ambientColor", [0.3, 0.35, 0.4])

	# Convert SL sun direction to Godot coords: (sl.x, sl.z, -sl.y)
	var sl_dir := Vector3(float(sun_dir_arr[0]), float(sun_dir_arr[1]), float(sun_dir_arr[2]))
	var godot_sun_dir := Vector3(sl_dir.x, sl_dir.z, -sl_dir.y).normalized()

	# Update DirectionalLight3D — light shines along -Z of its local space
	var light: DirectionalLight3D = get_node_or_null("../DirectionalLight3D")
	if light:
		if godot_sun_dir.length() > 0.001:
			# DirectionalLight3D shines along its -Z axis, so orient it to face -sun_dir
			var target := -godot_sun_dir
			light.global_position = Vector3.ZERO
			light.look_at(target, Vector3.UP)
		var sun_color := Color(float(sun_color_arr[0]), float(sun_color_arr[1]), float(sun_color_arr[2]))
		light.light_color = sun_color
		light.light_energy = 1.0

	# Update WorldEnvironment with procedural sky
	var world_env: WorldEnvironment = get_node_or_null("../WorldEnvironment")
	if world_env and world_env.environment:
		var env := world_env.environment

		# Create procedural sky
		var sky := Sky.new()
		var sky_mat := ProceduralSkyMaterial.new()

		# Derive sky colors from sun color and ambient
		var sun_c := Color(float(sun_color_arr[0]), float(sun_color_arr[1]), float(sun_color_arr[2]))
		var amb_c := Color(float(ambient_arr[0]), float(ambient_arr[1]), float(ambient_arr[2]))

		# Sky top: blue tinted by ambient
		sky_mat.sky_top_color = Color(
			lerp(0.2, amb_c.r, 0.3),
			lerp(0.4, amb_c.g, 0.3),
			lerp(0.8, amb_c.b, 0.3)
		)
		# Sky horizon: blend sun color and ambient
		sky_mat.sky_horizon_color = Color(
			lerp(sun_c.r, amb_c.r, 0.5),
			lerp(sun_c.g, amb_c.g, 0.5),
			lerp(sun_c.b, amb_c.b, 0.5)
		)
		# Ground colors
		sky_mat.ground_bottom_color = Color(0.15, 0.13, 0.1)
		sky_mat.ground_horizon_color = sky_mat.sky_horizon_color * 0.8

		sky_mat.sun_angle_max = 30.0
		sky_mat.sun_curve = 0.15

		sky.sky_material = sky_mat
		env.sky = sky
		env.background_mode = Environment.BG_SKY
		env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		env.ambient_light_energy = 0.6



## Return stats dictionary for the Godot-side asset pipeline
func get_pipeline_stats() -> Dictionary:
	# Texture stats from our own thread pool
	_texture_queue_lock.lock()
	var tex_q := _texture_queue.size()
	_texture_queue_lock.unlock()
	_texture_results_lock.lock()
	var tex_ready := _texture_results.size()
	_texture_results_lock.unlock()

	# Mesh stats from WorkerThreadPool
	var mesh_ready := 0
	for task_id: int in _mesh_tasks:
		if WorkerThreadPool.is_task_completed(task_id):
			mesh_ready += 1

	# Compute budget averages and reset
	var n := maxf(_budget_samples, 1)
	var avg_elapsed := _budget_elapsed_ms / n
	var avg_budget := _budget_total_ms / n
	var avg_used := _budget_used_ms / n
	_budget_samples = 0
	_budget_elapsed_ms = 0.0
	_budget_total_ms = 0.0
	_budget_used_ms = 0.0

	# Per-step timing averages and reset
	_timing_lock.lock()
	var tc := maxi(_timing_count, 1)
	var avg_load := _timing_load_ms / tc
	var avg_mipmap := _timing_mipmap_ms / tc
	var avg_compress := _timing_compress_ms / tc
	var timing_n := _timing_count
	_timing_load_ms = 0.0
	_timing_mipmap_ms = 0.0
	_timing_compress_ms = 0.0
	_timing_count = 0
	_timing_lock.unlock()

	# Main-thread finalization timing averages and reset
	var ftc := maxi(_fin_tex_count, 1)
	var avg_tex_create := _fin_tex_create_ms / ftc
	var avg_tex_apply := _fin_tex_apply_ms / ftc
	var fin_tex_n := _fin_tex_count
	_fin_tex_create_ms = 0.0
	_fin_tex_apply_ms = 0.0
	_fin_tex_count = 0
	var fmc := maxi(_fin_mesh_count, 1)
	var avg_mesh_extract := _fin_mesh_extract_ms / fmc
	var avg_mesh_apply := _fin_mesh_apply_ms / fmc
	var fin_mesh_n := _fin_mesh_count
	_fin_mesh_extract_ms = 0.0
	_fin_mesh_apply_ms = 0.0
	_fin_mesh_count = 0

	return {
		"texWorkers": TEXTURE_THREAD_COUNT,
		"texReady": tex_ready,
		"texQueue": tex_q,
		"texTiming": "%.0f/%.0f/%.0fms load/mip/s3tc (n=%d)" % [avg_load, avg_mipmap, avg_compress, timing_n],
		"texDone": _tex_finalized_count,
		"texCached": texture_cache.size(),
		"texFailed": texture_load_failed.size(),
		"texPending": pending_textures.size(),
		"texFinalize": "%.2f/%.2fms create/apply (n=%d)" % [avg_tex_create, avg_tex_apply, fin_tex_n],
		"meshWorkers": _mesh_tasks.size(),
		"meshReady": mesh_ready,
		"meshQueue": _mesh_queue.size(),
		"meshDone": _mesh_finalized_count,
		"meshCached": mesh_cache.size(),
		"meshFailed": mesh_load_failed.size(),
		"meshPending": pending_meshes.size(),
		"meshFinalize": "%.2f/%.2fms extract/apply (n=%d)" % [avg_mesh_extract, avg_mesh_apply, fin_mesh_n],
		"budgetElapsed": avg_elapsed,
		"budgetAvail": avg_budget,
		"budgetUsed": avg_used,
		"objects": objects.size(),
		"primShapes": prim_generator.get_cache_size(),
		"avatars": avatars.size(),
		"materials": material_cache.size(),
		"materialLookups": _material_lookups,
		"materialReuse": _material_lookups - material_cache.size(),
		"texOpaque": _texture_opaque.values().count(true),
		"lightsActive": _light_count,
		"lightsTotal": _object_light_data.size(),
	}


# ─── Debug Inspection ──────────────────────────────────

## Raycast against objects. AABB broad phase on all objects, then per-triangle
## narrow phase on candidates for precise picking.
func pick_object(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	# Broad phase: AABB test (skip objects far from camera)
	var max_pick_dist := 200.0
	var candidates: Array = []  # Array of { id, xform, inv, local_from, local_dir }
	for id: int in objects:
		var rsi: RSInstance = objects[id]
		if rsi.mesh == null:
			continue
		if ray_origin.distance_to(rsi.pos) > max_pick_dist:
			continue
		var xform := Transform3D(Basis(rsi.rot) * Basis.from_scale(rsi.scl), rsi.pos)
		var inv := xform.affine_inverse()
		var local_from := inv * ray_origin
		var local_dir := (inv.basis * ray_dir).normalized()
		if rsi.mesh.get_aabb().intersects_ray(local_from, local_dir) != null:
			candidates.append({ "id": id, "mesh": rsi.mesh, "xform": xform, "local_from": local_from, "local_dir": local_dir })

	if candidates.size() == 0:
		return {}

	# Narrow phase: per-triangle intersection on AABB candidates
	var best_id: int = -1
	var best_dist: float = INF
	for c: Dictionary in candidates:
		var dist := _ray_mesh_intersect(c["mesh"], c["local_from"], c["local_dir"], c["xform"])
		if dist >= 0.0 and dist < best_dist:
			best_dist = dist
			best_id = c["id"]

	# Fallback: if triangle test missed all (degenerate mesh), use nearest AABB hit
	if best_id < 0:
		for c: Dictionary in candidates:
			var hit = (c["mesh"] as Mesh).get_aabb().intersects_ray(c["local_from"], c["local_dir"])
			if hit != null:
				var world_hit: Vector3 = (c["xform"] as Transform3D) * hit
				var dist: float = ray_origin.distance_to(world_hit)
				if dist < best_dist:
					best_dist = dist
					best_id = c["id"]

	if best_id < 0:
		return {}
	return { "localId": best_id, "distance": best_dist }


## Test ray against mesh triangles. Returns world-space distance or -1.0 on miss.
func _ray_mesh_intersect(mesh: Mesh, local_from: Vector3, local_dir: Vector3, xform: Transform3D) -> float:
	var best_t: float = -1.0
	for si: int in range(mesh.get_surface_count()):
		var arrays: Array = mesh.surface_get_arrays(si)
		if arrays.size() == 0:
			continue
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var indices = arrays[Mesh.ARRAY_INDEX]
		if indices != null and indices.size() >= 3:
			var idx_count: int = indices.size()
			var i := 0
			while i < idx_count - 2:
				var t := _ray_tri(local_from, local_dir,
					verts[indices[i]], verts[indices[i + 1]], verts[indices[i + 2]])
				if t >= 0.0:
					var world_hit: Vector3 = xform * (local_from + local_dir * t)
					var dist: float = (xform * local_from).distance_to(world_hit)
					if best_t < 0.0 or dist < best_t:
						best_t = dist
				i += 3
		elif verts.size() >= 3:
			var i := 0
			while i < verts.size() - 2:
				var t := _ray_tri(local_from, local_dir,
					verts[i], verts[i + 1], verts[i + 2])
				if t >= 0.0:
					var world_hit: Vector3 = xform * (local_from + local_dir * t)
					var dist: float = (xform * local_from).distance_to(world_hit)
					if best_t < 0.0 or dist < best_t:
						best_t = dist
				i += 3
	return best_t


## Möller–Trumbore ray-triangle intersection. Returns t >= 0 on hit, -1.0 on miss.
func _ray_tri(origin: Vector3, dir: Vector3, v0: Vector3, v1: Vector3, v2: Vector3) -> float:
	var e1 := v1 - v0
	var e2 := v2 - v0
	var h := dir.cross(e2)
	var a := e1.dot(h)
	if absf(a) < 1e-8:
		return -1.0
	var f := 1.0 / a
	var s := origin - v0
	var u := f * s.dot(h)
	if u < 0.0 or u > 1.0:
		return -1.0
	var q := s.cross(e1)
	var v := f * dir.dot(q)
	if v < 0.0 or u + v > 1.0:
		return -1.0
	var t := f * e2.dot(q)
	if t < 1e-6:
		return -1.0
	return t


## Return the RenderingServer instance RID for an object (used for highlight overlay).
func get_object_rid(local_id: int) -> RID:
	var rsi: RSInstance = objects.get(local_id)
	if rsi == null:
		return RID()
	return rsi.rid


## Return per-face info array for an object.
func get_object_face_info(local_id: int) -> Array:
	return object_faces.get(local_id, [])


## Set planar shader debug mode on all cached planar materials.
## mode: 0=off, 1=SL normal, 2=UV, 3=binormal
func set_planar_debug_mode(mode: int) -> void:
	var count := 0
	for key: String in material_cache:
		var mat: Material = material_cache[key]
		if mat is ShaderMaterial:
			var smat := mat as ShaderMaterial
			# Only set on shaders that have the debug_mode uniform (planar variants)
			if smat.shader != null and "debug_mode" in smat.shader.code:
				smat.set_shader_parameter("debug_mode", mode)
				count += 1


## Return debug summary for an object.
func get_object_debug_info(local_id: int) -> Dictionary:
	var rsi: RSInstance = objects.get(local_id)
	if rsi == null:
		return {}
	var surface_count: int = rsi.mesh.get_surface_count() if rsi.mesh else 0
	return {
		"localId": local_id,
		"pos": rsi.pos,
		"scl": rsi.scl,
		"meshId": pending_meshes.get(local_id, ""),
		"parentId": object_parent.get(local_id, 0),
		"surfaceCount": surface_count,
	}
