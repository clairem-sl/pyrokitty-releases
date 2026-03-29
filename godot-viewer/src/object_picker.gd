extends RefCounted

## Physics-based object picker using ConcavePolygonShape3D and intersect_ray().
## Replaces GDScript per-triangle Moller-Trumbore with C++ BVH-backed raycasting.

var sm  # scene_manager reference

const PICK_LAYER: int = 1 << 20  # Collision layer bit 20 (isolated from game physics)
const MAX_PICK_DIST: float = 200.0

# Physics body tracking
var _body_to_uuid: Dictionary = {}     # body RID get_id() (int) -> UUID (String)
var _uuid_to_body: Dictionary = {}     # UUID (String) -> body RID
var _mesh_shape_cache: Dictionary = {} # cache_key (String) -> ConcavePolygonShape3D
var _mesh_tri_map: Dictionary = {}     # cache_key (String) -> Array of [surface_idx, tri_in_surface]
var _uuid_to_cache_key: Dictionary = {} # UUID (String) -> cache_key (String)


func _init(scene_manager) -> void:
	sm = scene_manager


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

	# Wire RSInstance callback for automatic transform sync
	rsi.on_transform_pushed = func(xf: Transform3D) -> void:
		PhysicsServer3D.body_set_state(body, PhysicsServer3D.BODY_STATE_TRANSFORM, xf)


## Destroy the physics body for an object.
func _destroy_pick_body(obj_uuid: String) -> void:
	if not _uuid_to_body.has(obj_uuid):
		return
	var body: RID = _uuid_to_body[obj_uuid]

	# Clear the RSInstance callback before freeing body
	var rsi = sm.objects.get(obj_uuid)
	if rsi != null:
		rsi.on_transform_pushed = Callable()

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


## Raycast against objects using physics. Returns { uuid, distance } or {}.
func pick_object(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
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


## Detailed raycast returning face index, interpolated UV/normal, and hit position.
func pick_object_detailed(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
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
