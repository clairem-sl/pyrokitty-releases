extends RefCounted

## Texture loading (thread pool), mesh loading (WorkerThreadPool), material
## creation/caching, and application of textures/meshes to pending objects.

const FrameBudget = preload("res://src/frame_budget.gd")
const PlanarMapShader = preload("res://src/planar_map.gdshader")
const PlanarMapAlphaShader = preload("res://src/planar_map_alpha.gdshader")
const StandardUVShader = preload("res://src/standard_uv.gdshader")
const StandardUVAlphaShader = preload("res://src/standard_uv_alpha.gdshader")

var sm  # scene_manager reference

class AsyncResult extends RefCounted:
	var data       # Worker writes Image (texture) here
	var gltf_state: GLTFState    # Worker writes parsed GLTF state here (mesh pipeline)
	var error: bool = false

# Async texture loading (own Thread pool — bypasses WorkerThreadPool low-priority cap)
var TEXTURE_THREAD_COUNT: int = FrameBudget.TEXTURE_THREAD_COUNT
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

# Async mesh loading (WorkerThreadPool)
var _mesh_tasks: Dictionary = {}         # task_id (int) -> { meshId: String, result: AsyncResult, path: String }
var _mesh_in_flight: Dictionary = {}     # meshId (String) -> true (dedup)
var _mesh_queue: Array = []              # queued { meshId, path } waiting to be submitted
var MESH_MAX_IN_FLIGHT: int = FrameBudget.MESH_MAX_IN_FLIGHT

# Texture alpha tracking: textureId -> true if fully opaque (DXT1/BC1, no alpha channel)
var _texture_opaque: Dictionary = {}
var _material_lookups: int = 0   # total calls to _get_or_create_material (lifetime)

# Placeholder material cache: "colorhex_fb_ds" -> StandardMaterial3D
var _placeholder_cache: Dictionary = {}

# Double-sided shader cache
var _double_sided_shader_cache: Dictionary = {}  # Shader -> Shader (cull_back -> cull_disabled variant)


func _init(scene_manager) -> void:
	sm = scene_manager


func start_threads() -> void:
	_start_texture_threads()


func shutdown() -> void:
	_shutting_down = true


# ─── Mesh Pipeline ───────────────────────────────────

func handle_mesh_ready(msg: Dictionary) -> void:
	var mesh_id: String = msg.get("meshId", "")
	var glb_path: String = msg.get("path", "")
	if mesh_id.is_empty() or glb_path.is_empty():
		return

	# Skip if already cached, in-flight, or previously failed
	if _shutting_down or sm.mesh_cache.has(mesh_id) or _mesh_in_flight.has(mesh_id) or sm.mesh_load_failed.has(mesh_id):
		return

	_mesh_in_flight[mesh_id] = true
	_mesh_queue.append({ "meshId": mesh_id, "path": glb_path })


## Apply a loaded mesh to all pending objects waiting for it
func _apply_mesh_to_pending(mesh_id: String) -> void:
	if not sm._pending_by_mesh.has(mesh_id):
		return
	var loaded_mesh: Mesh = sm.mesh_cache[mesh_id]
	var local_ids: Array = sm._pending_by_mesh[mesh_id]
	sm._pending_by_mesh.erase(mesh_id)
	for local_id: int in local_ids:
		sm.pending_meshes.erase(local_id)
		var rsi = sm.objects.get(local_id)
		if rsi != null:
			rsi.set_mesh(loaded_mesh)
			# Reapply per-face materials now that we have real mesh with proper surfaces
			if sm.object_faces.has(local_id):
				rsi.set_material_override(null)
				apply_face_materials(rsi, local_id, sm.object_faces[local_id])
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
	if _shutting_down or sm.texture_cache.has(texture_id) or _texture_in_flight.has(texture_id) or sm.texture_load_failed.has(texture_id):
		return

	_texture_in_flight[texture_id] = true
	_texture_queue_lock.lock()
	_texture_queue.append({ "textureId": texture_id, "path": tex_path })
	_texture_queue_lock.unlock()


## Start dedicated texture worker threads (called once from start_threads)
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

	# Map format: BC1 -> FORMAT_DXT1, BC3 -> FORMAT_DXT5
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
	sm.light_mgr.apply_pending_proj_texture(texture_id)

	if not sm._pending_by_texture.has(texture_id):
		return

	var entries: Array = sm._pending_by_texture[texture_id]
	sm._pending_by_texture.erase(texture_id)

	for entry: Dictionary in entries:
		var local_id: int = entry["localId"]
		var face_info: Dictionary = entry["faceInfo"]
		var rsi = sm.objects.get(local_id)
		if rsi != null:
			var albedo_id: String = face_info["textureId"]
			# Only apply material once albedo is cached (minimum requirement)
			if sm.texture_cache.has(albedo_id):
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
			if not sm.texture_cache.has(tid) and not sm.texture_load_failed.has(tid):
				still_pending = true
				# Re-register under remaining uncached texture IDs
				if not sm._pending_by_texture.has(tid):
					sm._pending_by_texture[tid] = []
				# Avoid duplicate entries
				var already := false
				for existing: Dictionary in sm._pending_by_texture[tid]:
					if existing["localId"] == local_id and existing["faceInfo"]["faceIndex"] == face_info["faceIndex"]:
						already = true
						break
				if not already:
					sm._pending_by_texture[tid].append(entry)

		# Remove from per-object pending list only when ALL textures are resolved
		if not still_pending and sm.pending_textures.has(local_id):
			var face_list: Array = sm.pending_textures[local_id]
			var face_idx_to_remove: int = face_info["faceIndex"]
			face_list = face_list.filter(func(fi: Dictionary) -> bool: return fi["faceIndex"] != face_idx_to_remove)
			if face_list.size() == 0:
				sm.pending_textures.erase(local_id)
			else:
				sm.pending_textures[local_id] = face_list


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


# ─── Finalization (_process budget) ──────────────────

## Called from scene_manager._process to finalize completed textures and meshes
## within the frame time budget.
func finalize_frame(delta: float, vr_mode: bool, target_frame_ms: float) -> void:
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

	# Submit queued mesh work to WorkerThreadPool
	if _mesh_queue.size() > 0:
		_submit_mesh_tasks()

	# Adaptive budget: use whatever time remains before the frame deadline.
	var frame_start_ms := (Time.get_ticks_usec() / 1000.0) - (delta * 1000.0)
	var now_ms := Time.get_ticks_usec() / 1000.0
	var elapsed_ms := now_ms - frame_start_ms
	var remaining_ms := target_frame_ms - elapsed_ms
	var budget_ms: float
	if vr_mode:
		# In VR, never do finalization on an already-late frame — the deadline
		# is missed, adding more CPU work only makes the next frame late too.
		budget_ms = clampf(remaining_ms, 0.0, FrameBudget.MIN_FINALIZE_MS)
	else:
		# Desktop: when over budget be aggressive — frame is slow anyway.
		budget_ms = maxf(remaining_ms, FrameBudget.OVERBUDGET_FINALIZE_MS if remaining_ms < FrameBudget.MIN_FINALIZE_MS else FrameBudget.MIN_FINALIZE_MS)
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
				sm.texture_load_failed[texture_id] = true
			else:
				# DXT1 = opaque (no alpha), DXT5 = has alpha channel
				_texture_opaque[texture_id] = (img.get_format() == Image.FORMAT_DXT1)
				var _t0 := Time.get_ticks_usec()
				sm.texture_cache[texture_id] = ImageTexture.create_from_image(img)
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
				sm.mesh_load_failed[mesh_id] = true
			else:
				# Extract mesh via ImporterMesh — no Node tree, no queue_free
				var gltf_meshes: Array = result.gltf_state.get_meshes()
				if gltf_meshes.is_empty():
					sm.mesh_load_failed[mesh_id] = true
				else:
					var importer_mesh: ImporterMesh = gltf_meshes[0].mesh
					if importer_mesh == null:
						sm.mesh_load_failed[mesh_id] = true
					else:
						var _t0 := Time.get_ticks_usec()
						var m: Mesh = importer_mesh.get_mesh()
						var _t1 := Time.get_ticks_usec()
						if m == null:
							sm.mesh_load_failed[mesh_id] = true
						else:
							sm.mesh_cache[mesh_id] = m
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


# ─── Face Materials ──────────────────────────────────

## Apply per-face materials to an RSInstance.
## Faces with cached textures are applied immediately; others go to pending_textures.
func apply_face_materials(rsi, local_id: int, faces: Array) -> void:
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
		var albedo_cached: bool = sm.texture_cache.has(texture_id)

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
			if not sm.texture_cache.has(tid) and not sm.texture_load_failed.has(tid):
				has_pending = true
				if not sm._pending_by_texture.has(tid):
					sm._pending_by_texture[tid] = []
				sm._pending_by_texture[tid].append({ "localId": local_id, "faceInfo": pending_info })

		if has_pending:
			pending.append(pending_info)

	if pending.size() > 0:
		sm.pending_textures[local_id] = pending


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
	if not normal_id.is_empty() and sm.texture_cache.has(normal_id):
		norm_key = normal_id
	var orm_key: String = ""
	if not orm_id.is_empty() and sm.texture_cache.has(orm_id):
		orm_key = orm_id
	var emis_key: String = ""
	if not emissive_id.is_empty() and sm.texture_cache.has(emissive_id):
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

	if sm.material_cache.has(key):
		return sm.material_cache[key]

	# Planar mapping uses a custom ShaderMaterial that implements SL's planarProjection()
	if mapping_type == 2:
		var mat := ShaderMaterial.new()
		# Pick opaque vs alpha-blend shader variant
		var use_alpha: bool = resolved_mode == 1 or (resolved_mode == -1 and color[3] < 1.0)
		var shader: Shader = PlanarMapAlphaShader if use_alpha else PlanarMapShader
		if double_sided:
			shader = _get_double_sided_shader(shader)
		mat.shader = shader
		mat.set_shader_parameter("albedo_tex", sm.texture_cache[texture_id])
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
		sm.material_cache[key] = mat
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
		smat.set_shader_parameter("albedo_tex", sm.texture_cache[texture_id])
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
		sm.material_cache[key] = smat
		return smat

	var mat := StandardMaterial3D.new()
	mat.albedo_texture = sm.texture_cache[texture_id]
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
			var orm_tex: Texture2D = sm.texture_cache[orm_id]
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
			mat.normal_texture = sm.texture_cache[normal_id]

		# Emissive
		var ef: Array = emissive_factor
		var has_emission_factor: bool = float(ef[0]) > 0 or float(ef[1]) > 0 or float(ef[2]) > 0
		if has_emission_factor:
			mat.emission_enabled = true
			mat.emission = Color(ef[0], ef[1], ef[2])
			mat.emission_energy_multiplier = 1.0
		if not emis_key.is_empty():
			mat.emission_enabled = true
			mat.emission_texture = sm.texture_cache[emissive_id]

	sm.material_cache[key] = mat
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


# ─── Stats ───────────────────────────────────────────

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
		"texCached": sm.texture_cache.size(),
		"texFailed": sm.texture_load_failed.size(),
		"texPending": sm.pending_textures.size(),
		"texFinalize": "%.2f/%.2fms create/apply (n=%d)" % [avg_tex_create, avg_tex_apply, fin_tex_n],
		"meshWorkers": _mesh_tasks.size(),
		"meshReady": mesh_ready,
		"meshQueue": _mesh_queue.size(),
		"meshDone": _mesh_finalized_count,
		"meshCached": sm.mesh_cache.size(),
		"meshFailed": sm.mesh_load_failed.size(),
		"meshPending": sm.pending_meshes.size(),
		"meshFinalize": "%.2f/%.2fms extract/apply (n=%d)" % [avg_mesh_extract, avg_mesh_apply, fin_mesh_n],
		"budgetElapsed": avg_elapsed,
		"budgetAvail": avg_budget,
		"budgetUsed": avg_used,
		"objects": sm.objects.size(),
		"primShapes": sm.prim_generator.get_cache_size(),
		"avatars": sm.avatars.size(),
		"materials": sm.material_cache.size(),
		"materialLookups": _material_lookups,
		"materialReuse": _material_lookups - sm.material_cache.size(),
		"texOpaque": _texture_opaque.values().count(true),
		"lightsActive": sm.light_mgr._light_count,
		"lightsTotal": sm.light_mgr._object_light_data.size(),
	}
