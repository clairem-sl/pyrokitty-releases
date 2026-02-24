extends Node3D

## Manages in-world objects and avatars as MeshInstance3D boxes.
## Coordinate conversion: SL (X=East, Y=North, Z=Up) -> Godot (X=Right, Y=Up, Z=-Forward)
##   Position: (sl.x, sl.z, -sl.y)
##   Quaternion: (sl.x, sl.z, -sl.y, sl.w)

signal self_avatar_moved(pos: Vector3)

class AsyncResult extends RefCounted:
	var data: Image    # Worker writes decoded/compressed Image here
	var error: bool = false

var objects: Dictionary = {}   # localId (int) -> MeshInstance3D
var avatars: Dictionary = {}   # avatarId (String) -> MeshInstance3D
var self_avatar_id: String = ""

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
var object_faces: Dictionary = {}         # localId (int) -> Array[face_info dicts] (persists for mesh swaps)
var pending_textures: Dictionary = {}     # localId (int) -> Array[{ faceIndex, textureId, color, ... }]
var texture_load_failed: Dictionary = {}  # textureId (String) -> bool

# Async texture loading (WorkerThreadPool)
var _texture_tasks: Dictionary = {}      # task_id (int) -> { textureId: String, result: AsyncResult, path: String }
var _texture_in_flight: Dictionary = {}  # textureId (String) -> true (dedup)
const TEXTURE_FINALIZE_PER_FRAME: int = 4

func _ready() -> void:
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
	var mesh_instance := MeshInstance3D.new()

	if not mesh_id.is_empty() and mesh_cache.has(mesh_id):
		# Real mesh already loaded — use it
		mesh_instance.mesh = mesh_cache[mesh_id]
	else:
		# Box placeholder
		mesh_instance.mesh = object_mesh
		if not mesh_id.is_empty() and not mesh_load_failed.has(mesh_id):
			pending_meshes[local_id] = mesh_id

	# Apply per-face texture materials
	var faces: Array = msg.get("faces", [])
	if faces.size() > 0:
		object_faces[local_id] = faces
		_apply_face_materials(mesh_instance, local_id, faces)
	else:
		# No texture info — use default gray
		mesh_instance.material_override = object_material

	# Apply transform
	var pos: Array = msg.get("position", [0, 0, 0])
	var rot: Array = msg.get("rotation", [0, 0, 0, 1])
	var scl: Array = msg.get("scale", [0.5, 0.5, 0.5])

	var godot_pos := sl_to_godot_pos(pos)
	var godot_rot := sl_to_godot_quat(rot)
	var godot_scale := sl_to_godot_scale(scl)

	mesh_instance.scale = godot_scale  # SL prims have independent scale — no compensation

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
			var parent_node: MeshInstance3D = objects[parent_id]
			mesh_instance.position = parent_node.position + parent_node.quaternion * godot_pos
			mesh_instance.quaternion = parent_node.quaternion * godot_rot
		else:
			# Parent hasn't arrived — use offset as-is (will be corrected when parent arrives)
			mesh_instance.position = godot_pos
			mesh_instance.quaternion = godot_rot
			if not pending_children.has(parent_id):
				pending_children[parent_id] = []
			pending_children[parent_id].append(local_id)
	else:
		# Root prim — position is world absolute
		mesh_instance.position = godot_pos
		mesh_instance.quaternion = godot_rot

	add_child(mesh_instance)
	objects[local_id] = mesh_instance

	# If this is a root and we have pending children, fix their world positions
	if parent_id == 0 and pending_children.has(local_id):
		for child_id: int in pending_children[local_id]:
			if objects.has(child_id) and child_offset_pos.has(child_id):
				var child_node: MeshInstance3D = objects[child_id]
				child_node.position = mesh_instance.position + mesh_instance.quaternion * child_offset_pos[child_id]
				child_node.quaternion = mesh_instance.quaternion * child_offset_rot[child_id]
		pending_children.erase(local_id)


func handle_object_update_batch(msg: Dictionary) -> void:
	var obj_list: Array = msg.get("objects", [])
	for obj: Dictionary in obj_list:
		var local_id: int = int(obj.get("localId", 0))
		if local_id == 0:
			continue

		var mesh_instance: MeshInstance3D = objects.get(local_id)
		if mesh_instance == null:
			continue

		if object_parent.has(local_id):
			# Child prim — positions are relative to parent
			if obj.has("position"):
				var new_offset := sl_to_godot_pos(obj["position"])
				child_offset_pos[local_id] = new_offset
				var parent_node: MeshInstance3D = objects.get(object_parent[local_id])
				if parent_node:
					mesh_instance.position = parent_node.position + parent_node.quaternion * new_offset
			if obj.has("rotation"):
				var new_rot := sl_to_godot_quat(obj["rotation"])
				child_offset_rot[local_id] = new_rot
				var parent_node: MeshInstance3D = objects.get(object_parent[local_id])
				if parent_node:
					mesh_instance.quaternion = parent_node.quaternion * new_rot
			if obj.has("scale"):
				mesh_instance.scale = sl_to_godot_scale(obj["scale"])
		else:
			# Root prim — positions are world absolute
			if obj.has("position"):
				mesh_instance.position = sl_to_godot_pos(obj["position"])
			if obj.has("rotation"):
				mesh_instance.quaternion = sl_to_godot_quat(obj["rotation"])
			if obj.has("scale"):
				mesh_instance.scale = sl_to_godot_scale(obj["scale"])

			# Propagate root movement to all children
			if object_children.has(local_id):
				_update_children_transforms(local_id)


## Recompute world positions of all children from parent's current transform
func _update_children_transforms(parent_id: int) -> void:
	var parent_node: MeshInstance3D = objects.get(parent_id)
	if parent_node == null:
		return
	for child_id: int in object_children[parent_id]:
		if objects.has(child_id) and child_offset_pos.has(child_id):
			var child_node: MeshInstance3D = objects[child_id]
			child_node.position = parent_node.position + parent_node.quaternion * child_offset_pos[child_id]
			child_node.quaternion = parent_node.quaternion * child_offset_rot[child_id]


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

	# Free the node
	if objects.has(local_id):
		objects[local_id].queue_free()
		objects.erase(local_id)

	# Clean up all tracking dicts
	pending_meshes.erase(local_id)
	pending_textures.erase(local_id)
	object_faces.erase(local_id)
	child_offset_pos.erase(local_id)
	child_offset_rot.erase(local_id)
	pending_children.erase(local_id)


# ─── Mesh Pipeline ───────────────────────────────────

func handle_mesh_ready(msg: Dictionary) -> void:
	var mesh_id: String = msg.get("meshId", "")
	var glb_path: String = msg.get("path", "")
	if mesh_id.is_empty() or glb_path.is_empty():
		return

	# Load the GLB into a Mesh resource
	var loaded_mesh: Mesh = _load_glb(glb_path)
	if loaded_mesh == null:
		print("[SceneManager] GLB load failed: %s" % glb_path)
		mesh_load_failed[mesh_id] = true
		return

	mesh_cache[mesh_id] = loaded_mesh
	#print("[SceneManager] Loaded GLB for %s" % mesh_id)

	# Replace all pending boxes waiting for this mesh
	var to_remove: Array = []
	for local_id: int in pending_meshes:
		if pending_meshes[local_id] == mesh_id:
			var mi: MeshInstance3D = objects.get(local_id)
			if mi != null:
				mi.mesh = loaded_mesh
				# Reapply per-face materials now that we have real mesh with proper surfaces
				if object_faces.has(local_id):
					mi.material_override = null
					_apply_face_materials(mi, local_id, object_faces[local_id])
				elif mi.material_override == object_material:
					mi.material_override = null
			to_remove.append(local_id)

	for local_id: int in to_remove:
		pending_meshes.erase(local_id)


func _load_glb(file_path: String) -> Mesh:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()

	var err := doc.append_from_file(file_path, state)
	if err != OK:
		push_warning("[SceneManager] GLTFDocument.append_from_file error %s: %s" % [error_string(err), file_path])
		return null

	var scene: Node = doc.generate_scene(state)
	if scene == null:
		push_warning("[SceneManager] GLTFDocument.generate_scene returned null")
		return null

	# Find the first MeshInstance3D in the generated scene tree
	var mesh: Mesh = _find_mesh_in_tree(scene)
	scene.queue_free()
	return mesh


func _find_mesh_in_tree(node: Node) -> Mesh:
	if node is MeshInstance3D:
		return (node as MeshInstance3D).mesh
	for child in node.get_children():
		var m: Mesh = _find_mesh_in_tree(child)
		if m != null:
			return m
	return null


# ─── Texture Pipeline ────────────────────────────────

func handle_texture_ready(msg: Dictionary) -> void:
	var texture_id: String = msg.get("textureId", "")
	var tex_path: String = msg.get("path", "")
	if texture_id.is_empty() or tex_path.is_empty():
		return

	# Skip if already cached, in-flight, or previously failed
	if texture_cache.has(texture_id) or _texture_in_flight.has(texture_id) or texture_load_failed.has(texture_id):
		return

	_texture_in_flight[texture_id] = true

	# Spawn worker thread for heavy CPU work (Image.load + mipmaps + S3TC compress)
	var result := AsyncResult.new()
	var task_id: int = WorkerThreadPool.add_task(func() -> void:
		var img := Image.new()
		var err := img.load(tex_path)
		if err != OK:
			result.error = true
			return
		img.generate_mipmaps()
		img.compress(Image.COMPRESS_S3TC)
		result.data = img
	)
	_texture_tasks[task_id] = { "textureId": texture_id, "result": result, "path": tex_path }


## Apply a cached texture to all pending objects waiting for it
func _apply_texture_to_pending(texture_id: String) -> void:
	var to_remove: Array = []
	for local_id: int in pending_textures:
		var face_list: Array = pending_textures[local_id]
		var remaining: Array = []
		for face_info: Dictionary in face_list:
			if face_info["textureId"] == texture_id:
				var mi: MeshInstance3D = objects.get(local_id)
				if mi != null:
					var face_idx: int = face_info["faceIndex"]
					var uv: Dictionary = face_info.get("uv", {})
					var am: int = int(face_info.get("alphaMode", -1))
					var ac: float = float(face_info.get("alphaCutoff", 0.5))
					mi.set_surface_override_material(face_idx, _get_or_create_material(
						texture_id, face_info["color"], face_info["fullBright"], face_info["doubleSided"], uv, am, ac))
			else:
				remaining.append(face_info)
		if remaining.size() == 0:
			to_remove.append(local_id)
		else:
			pending_textures[local_id] = remaining

	for local_id: int in to_remove:
		pending_textures.erase(local_id)


func _process(_delta: float) -> void:
	if _texture_tasks.is_empty():
		return

	var finalized: int = 0
	var done_ids: Array = []

	for task_id: int in _texture_tasks:
		if finalized >= TEXTURE_FINALIZE_PER_FRAME:
			break
		if not WorkerThreadPool.is_task_completed(task_id):
			continue

		WorkerThreadPool.wait_for_task_completion(task_id)
		done_ids.append(task_id)

		var info: Dictionary = _texture_tasks[task_id]
		var texture_id: String = info["textureId"]
		var result: AsyncResult = info["result"]

		_texture_in_flight.erase(texture_id)

		if result.error or result.data == null:
			print("[SceneManager] Texture load failed: %s" % info["path"])
			texture_load_failed[texture_id] = true
		else:
			# Finalize on main thread: create GPU texture from worker-prepared Image
			texture_cache[texture_id] = ImageTexture.create_from_image(result.data)
			_apply_texture_to_pending(texture_id)

		finalized += 1

	for task_id: int in done_ids:
		_texture_tasks.erase(task_id)


## Apply per-face materials to a mesh instance.
## Faces with cached textures are applied immediately; others go to pending_textures.
func _apply_face_materials(mi: MeshInstance3D, local_id: int, faces: Array) -> void:
	mi.material_override = null
	var surface_count: int = mi.mesh.get_surface_count() if mi.mesh else 0
	var pending: Array = []

	for face_info: Dictionary in faces:
		var face_idx: int = int(face_info.get("index", 0))
		var texture_id: String = str(face_info.get("textureId", ""))
		var color: Array = face_info.get("color", [1, 1, 1, 1])
		var full_bright: bool = face_info.get("fullBright", false)
		var double_sided: bool = face_info.get("doubleSided", false)
		var alpha_mode: int = int(face_info.get("alphaMode", -1))
		var alpha_cutoff: float = float(face_info.get("alphaCutoff", 0.5))
		var uv_info: Dictionary = {
			"repeatU": face_info.get("repeatU", 1.0),
			"repeatV": face_info.get("repeatV", 1.0),
			"offsetU": face_info.get("offsetU", 0.0),
			"offsetV": face_info.get("offsetV", 0.0),
			"texRotation": face_info.get("rotation", 0.0)
		}

		if texture_id.is_empty():
			continue

		# Skip faces beyond the mesh's actual surface count
		if face_idx >= surface_count:
			continue

		if texture_cache.has(texture_id):
			mi.set_surface_override_material(face_idx, _get_or_create_material(
				texture_id, color, full_bright, double_sided, uv_info, alpha_mode, alpha_cutoff))
		else:
			mi.set_surface_override_material(face_idx, _make_placeholder_material(color, full_bright, double_sided))
			if not texture_load_failed.has(texture_id):
				pending.append({
					"faceIndex": face_idx,
					"textureId": texture_id,
					"color": color,
					"fullBright": full_bright,
					"doubleSided": double_sided,
					"alphaMode": alpha_mode,
					"alphaCutoff": alpha_cutoff,
					"uv": uv_info
				})

	if pending.size() > 0:
		pending_textures[local_id] = pending


func _get_or_create_material(texture_id: String, color: Array, full_bright: bool, double_sided: bool, uv_info: Dictionary = {}, alpha_mode: int = -1, alpha_cutoff: float = 0.5) -> StandardMaterial3D:
	# Build cache key from texture + color + fullbright + doubleSided + UV + alpha params
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
	var uv_key := "%.3f_%.3f_%.3f_%.3f_%.3f" % [ru, rv, ou, ov, tr]
	var alpha_key := "%d_%.2f" % [alpha_mode, alpha_cutoff]
	var key := "%s_%s_%s_%s_%s_%s" % [texture_id, color_hex, fb_str, ds_str, uv_key, alpha_key]

	if material_cache.has(key):
		return material_cache[key]

	var mat := StandardMaterial3D.new()
	mat.albedo_texture = texture_cache[texture_id]
	mat.albedo_color = Color(color[0], color[1], color[2], color[3])

	# UV repeat and offset
	mat.uv1_scale = Vector3(ru, rv, 1.0)
	mat.uv1_offset = Vector3(ou, ov, 0.0)

	# Texture rotation — requires shader override (not supported in StandardMaterial3D)
	# TODO: implement via custom shader when tr != 0

	# Cull mode: double-sided disables backface culling
	if double_sided:
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED

	# Alpha handling
	# alphaMode: -1=default (SL standard), 0=OPAQUE, 1=BLEND, 2=MASK
	if alpha_mode == 0:
		# GLTF OPAQUE — no transparency
		pass
	elif alpha_mode == 1:
		# GLTF BLEND — smooth alpha blending
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	elif alpha_mode == 2:
		# GLTF MASK — alpha scissor with explicit cutoff
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		mat.alpha_scissor_threshold = alpha_cutoff
	else:
		# Standard SL: no explicit alpha mode
		if color[3] < 1.0:
			# Tinted transparency — smooth blend
			mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		else:
			# Enable scissor so texture alpha channels work (trees, fences, etc.)
			# Opaque textures have alpha=1.0 everywhere so this is safe
			mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
			mat.alpha_scissor_threshold = 0.5

	# Fullbright = unshaded
	if full_bright:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	material_cache[key] = mat
	return mat


func _make_placeholder_material(color: Array, full_bright: bool, double_sided: bool) -> StandardMaterial3D:
	# Solid-color placeholder shown while texture downloads
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(color[0], color[1], color[2], color[3])

	if double_sided:
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED

	if color[3] < 1.0:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		mat.alpha_scissor_threshold = 0.5

	if full_bright:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	return mat


# ─── Self Avatar ─────────────────────────────────────

func set_self_avatar_id(id: String) -> void:
	self_avatar_id = id
	print("[SceneManager] Self avatar: %s" % id)
	# If we already have this avatar, emit its position
	if avatars.has(id):
		self_avatar_moved.emit(avatars[id].position)


## Set the self avatar's yaw directly (for instant A/D feedback)
func set_self_avatar_yaw(godot_yaw: float) -> void:
	if self_avatar_id.is_empty():
		return
	var mi: MeshInstance3D = avatars.get(self_avatar_id)
	if mi == null:
		return
	# Godot yaw around Y axis
	mi.quaternion = Quaternion(Vector3.UP, godot_yaw)


# ─── Avatar Handlers ──────────────────────────────────

func handle_avatar_create(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	if avatar_id.is_empty():
		return

	# Remove existing if duplicate
	if avatars.has(avatar_id):
		avatars[avatar_id].queue_free()

	var mesh_instance := MeshInstance3D.new()
	mesh_instance.mesh = avatar_mesh
	mesh_instance.material_override = avatar_material

	var pos: Array = msg.get("position", [128, 128, 25])
	mesh_instance.position = sl_to_godot_pos(pos)
	# Offset Y by half height so avatar stands on ground
	mesh_instance.position.y += 0.9

	if msg.has("rotation"):
		mesh_instance.quaternion = sl_to_godot_quat(msg["rotation"])

	add_child(mesh_instance)
	avatars[avatar_id] = mesh_instance

	if avatar_id == self_avatar_id:
		self_avatar_moved.emit(mesh_instance.position)


func handle_avatar_update(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	var mesh_instance: MeshInstance3D = avatars.get(avatar_id)
	if mesh_instance == null:
		return

	if msg.has("position"):
		mesh_instance.position = sl_to_godot_pos(msg["position"])
		mesh_instance.position.y += 0.9

		if avatar_id == self_avatar_id:
			self_avatar_moved.emit(mesh_instance.position)

	if msg.has("rotation"):
		mesh_instance.quaternion = sl_to_godot_quat(msg["rotation"])


func handle_avatar_kill(msg: Dictionary) -> void:
	var avatar_id: String = msg.get("id", "")
	if avatars.has(avatar_id):
		avatars[avatar_id].queue_free()
		avatars.erase(avatar_id)


# ─── Terrain + Water + Sky ───────────────────────────

var terrain_node: MeshInstance3D
var water_node: MeshInstance3D

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
	print("[SceneManager] Terrain mesh created (256x256)")

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
	if water_node:
		water_node.queue_free()

	water_node = MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(256.0, 256.0)
	water_node.mesh = plane

	# Position at center of region, at water height
	# SL region: x=0..255, y=0..255 -> Godot: x=0..255, z=0..-255
	# Center: x=127.5, z=-127.5
	water_node.position = Vector3(127.5, water_height, -127.5)

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.1, 0.3, 0.5, 0.5)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.roughness = 0.1
	mat.metallic = 0.3
	water_node.material_override = mat

	add_child(water_node)
	print("[SceneManager] Water plane at height %.1f" % water_height)


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

	print("[SceneManager] Environment updated (sunDir=%s)" % str(godot_sun_dir))
