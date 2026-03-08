extends RefCounted

## Raycasting, object picking, debug inspection, and object properties.

var sm  # scene_manager reference


func _init(scene_manager) -> void:
	sm = scene_manager


## Raycast against objects. AABB broad phase on all objects, then per-triangle
## narrow phase on candidates for precise picking.
func pick_object(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	# Broad phase: AABB test (skip objects far from camera)
	var max_pick_dist := 200.0
	var candidates: Array = []  # Array of { id, xform, inv, local_from, local_dir }
	for id: int in sm.objects:
		var rsi = sm.objects[id]
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


## Moller-Trumbore ray-triangle intersection. Returns t >= 0 on hit, -1.0 on miss.
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


## Like _ray_tri but also returns barycentric coords (u, v) for interpolation.
## Returns { t, u, v } on hit, empty dict on miss.
func _ray_tri_bary(origin: Vector3, dir: Vector3, v0: Vector3, v1: Vector3, v2: Vector3) -> Dictionary:
	var e1 := v1 - v0
	var e2 := v2 - v0
	var h := dir.cross(e2)
	var a := e1.dot(h)
	if absf(a) < 1e-8:
		return {}
	var f := 1.0 / a
	var s := origin - v0
	var bary_u := f * s.dot(h)
	if bary_u < 0.0 or bary_u > 1.0:
		return {}
	var q := s.cross(e1)
	var bary_v := f * dir.dot(q)
	if bary_v < 0.0 or bary_u + bary_v > 1.0:
		return {}
	var t := f * e2.dot(q)
	if t < 1e-6:
		return {}
	return { "t": t, "u": bary_u, "v": bary_v }


## Detailed raycast returning face index, interpolated UV/normal, and hit position.
## Returns {} on miss. Positions/normals are in object-local space.
func pick_object_detailed(ray_origin: Vector3, ray_dir: Vector3) -> Dictionary:
	var max_pick_dist := 200.0
	var candidates: Array = []
	for id: int in sm.objects:
		var rsi = sm.objects[id]
		if rsi.mesh == null:
			continue
		if ray_origin.distance_to(rsi.pos) > max_pick_dist:
			continue
		var xform := Transform3D(Basis(rsi.rot) * Basis.from_scale(rsi.scl), rsi.pos)
		var inv := xform.affine_inverse()
		var local_from := inv * ray_origin
		var local_dir := (inv.basis * ray_dir).normalized()
		if rsi.mesh.get_aabb().intersects_ray(local_from, local_dir) != null:
			candidates.append({ "id": id, "mesh": rsi.mesh, "xform": xform, "inv": inv,
				"local_from": local_from, "local_dir": local_dir })

	if candidates.size() == 0:
		return {}

	var best: Dictionary = {}
	var best_dist: float = INF

	for c: Dictionary in candidates:
		var mesh: Mesh = c["mesh"]
		var local_from: Vector3 = c["local_from"]
		var local_dir: Vector3 = c["local_dir"]
		var xform: Transform3D = c["xform"]

		for si: int in range(mesh.get_surface_count()):
			var arrays: Array = mesh.surface_get_arrays(si)
			if arrays.size() == 0:
				continue
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var uvs = arrays[Mesh.ARRAY_TEX_UV]
			var normals = arrays[Mesh.ARRAY_NORMAL]
			var indices = arrays[Mesh.ARRAY_INDEX]

			var tri_list: Array[Array] = []
			if indices != null and indices.size() >= 3:
				var i := 0
				while i < indices.size() - 2:
					tri_list.append([indices[i], indices[i + 1], indices[i + 2]])
					i += 3
			elif verts.size() >= 3:
				var i := 0
				while i < verts.size() - 2:
					tri_list.append([i, i + 1, i + 2])
					i += 3

			for tri: Array in tri_list:
				var hit := _ray_tri_bary(local_from, local_dir,
					verts[tri[0]], verts[tri[1]], verts[tri[2]])
				if hit.is_empty():
					continue
				var world_hit: Vector3 = xform * (local_from + local_dir * hit["t"])
				var dist: float = (xform * local_from).distance_to(world_hit)
				if dist < best_dist:
					best_dist = dist
					var bary_u: float = hit["u"]
					var bary_v: float = hit["v"]
					var bary_w: float = 1.0 - bary_u - bary_v
					var interp_uv := Vector2.ZERO
					if uvs != null and uvs.size() > tri[2]:
						interp_uv = uvs[tri[0]] * bary_w + uvs[tri[1]] * bary_u + uvs[tri[2]] * bary_v
					var interp_normal := Vector3.UP
					if normals != null and normals.size() > tri[2]:
						interp_normal = (normals[tri[0]] * bary_w + normals[tri[1]] * bary_u + normals[tri[2]] * bary_v).normalized()
					var local_hit: Vector3 = local_from + local_dir * hit["t"]
					best = {
						"localId": c["id"],
						"distance": dist,
						"faceIndex": si,
						"st": interp_uv,
						"normal": interp_normal,
						"hitPosLocal": local_hit,
					}

	return best


## Return the RenderingServer instance RID for an object (used for highlight overlay).
func get_object_rid(local_id: int) -> RID:
	var rsi = sm.objects.get(local_id)
	if rsi == null:
		return RID()
	return rsi.rid


## Return per-face info array for an object.
func get_object_face_info(local_id: int) -> Array:
	return sm.object_faces.get(local_id, [])


## Set planar shader debug mode on all cached planar materials.
## mode: 0=off, 1=SL normal, 2=UV, 3=binormal
func set_planar_debug_mode(mode: int) -> void:
	var count := 0
	for key: String in sm.material_cache:
		var mat: Material = sm.material_cache[key]
		if mat is ShaderMaterial:
			var smat := mat as ShaderMaterial
			# Only set on shaders that have the debug_mode uniform (planar variants)
			if smat.shader != null and "debug_mode" in smat.shader.code:
				smat.set_shader_parameter("debug_mode", mode)
				count += 1


## Return debug summary for an object.
func get_object_debug_info(local_id: int) -> Dictionary:
	var rsi = sm.objects.get(local_id)
	if rsi == null:
		return {}
	var surface_count: int = rsi.mesh.get_surface_count() if rsi.mesh else 0
	var meta: Dictionary = sm.object_meta.get(local_id, {})
	return {
		"localId": local_id,
		"uuid": meta.get("uuid", ""),
		"name": meta.get("name", ""),
		"description": meta.get("description", ""),
		"pos": rsi.pos,
		"rot": rsi.rot,
		"scl": rsi.scl,
		"meshId": sm.pending_meshes.get(local_id, ""),
		"parentId": sm.object_parent.get(local_id, 0),
		"surfaceCount": surface_count,
	}


func handle_object_properties(msg: Dictionary) -> void:
	var local_id: int = int(msg.get("localId", 0))
	if local_id == 0:
		return
	var obj_name: String = str(msg.get("name", ""))
	var obj_desc: String = str(msg.get("description", ""))
	if sm.object_meta.has(local_id):
		sm.object_meta[local_id]["name"] = obj_name
		sm.object_meta[local_id]["description"] = obj_desc
	sm.object_properties_received.emit(local_id, obj_name, obj_desc)
