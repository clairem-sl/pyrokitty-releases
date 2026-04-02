extends RefCounted

## Terrain heightmap, water (OceanFFT), underwater fog (GPU shader), and sky/environment.

const Ocean3DScript = preload("res://addons/tessarakkt.oceanfft/components/Ocean3D.gd")
const QuadTree3DScript = preload("res://addons/tessarakkt.oceanfft/components/QuadTree3D.gd")
const UnderwaterFogShader = preload("res://src/underwater_fog.gdshader")

var sm  # scene_manager reference

var terrain_nodes: Dictionary = {}    # cacheID (String) -> MeshInstance3D
var terrain_heights: Dictionary = {}  # cacheID (String) -> PackedFloat32Array (256x256)
var terrain_grid: Dictionary = {}     # "gridX,gridY" -> cacheID — for neighbor lookups
var _ocean = null  # Ocean3D
var _ocean_quad_tree = null  # QuadTree3D
var _ocean_logged_ready: bool = false
var _water_height: float = 20.0       # SL water surface Y (Godot coords), set by handle_terrain_ready
var _underwater_fog_color: Color = Color(0.03, 0.06, 0.12)  # EEP waterFogColor
var _underwater_fog_density: float = 0.12                     # EEP waterFogDensity
var _underwater_fog_quad: MeshInstance3D  # fullscreen quad with underwater fog shader

# Sun/ambient fade-in — starts at 0, ramps to target over 10s
var _sun_target_energy: float = 0.0
var _ambient_target_energy: float = 0.0
var _sun_energy: float = 0.0
var _ambient_energy: float = 0.0
const _LIGHT_FADE_SPEED: float = 0.333  # units/sec (~3s to reach 1.0)


func _init(scene_manager) -> void:
	sm = scene_manager


## Called from scene_manager._process every frame
func process(_delta: float) -> void:
	# OceanFFT simulation (pure GPU — no CPU readback)
	if _ocean != null and _ocean.initialized:
		_ocean.simulate(_delta)
		# Sync wind scroll to underwater fog shader so wave heights track
		if _underwater_fog_quad != null:
			var fog_mat: ShaderMaterial = _underwater_fog_quad.material_override
			if fog_mat:
				fog_mat.set_shader_parameter("wind_uv_offset", _ocean.wind_uv_offset)

	# Fade sun/ambient toward targets
	if _sun_energy < _sun_target_energy or _ambient_energy < _ambient_target_energy:
		var step := _LIGHT_FADE_SPEED * _delta
		_sun_energy = minf(_sun_energy + step, _sun_target_energy)
		_ambient_energy = minf(_ambient_energy + step, _ambient_target_energy)
		var light: DirectionalLight3D = sm.get_node_or_null("../DirectionalLight3D")
		if light:
			light.light_energy = _sun_energy
		var world_env: WorldEnvironment = sm.get_node_or_null("../WorldEnvironment")
		if world_env and world_env.environment:
			world_env.environment.ambient_light_energy = _ambient_energy


## Remove terrain and water meshes for region change
func clear() -> void:
	for node: MeshInstance3D in terrain_nodes.values():
		if is_instance_valid(node):
			node.queue_free()
	terrain_nodes.clear()
	terrain_heights.clear()
	terrain_grid.clear()
	if _ocean != null:
		if _ocean is Node and is_instance_valid(_ocean):
			_ocean.queue_free()
		_ocean = null
	if _ocean_quad_tree != null:
		if _ocean_quad_tree is Node and is_instance_valid(_ocean_quad_tree):
			_ocean_quad_tree.queue_free()
		_ocean_quad_tree = null
	if _underwater_fog_quad != null:
		if is_instance_valid(_underwater_fog_quad):
			_underwater_fog_quad.queue_free()
		_underwater_fog_quad = null
	_ocean_logged_ready = false


func handle_terrain_ready(msg: Dictionary) -> void:
	var bin_path: String = msg.get("path", "")
	if bin_path.is_empty():
		DebugLog.warn("terrain", "terrain_ready: no path")
		return

	# Read raw Float32LE binary (256*256*4 = 262144 bytes)
	var f := FileAccess.open(bin_path, FileAccess.READ)
	if f == null:
		DebugLog.warn("terrain", "terrain_ready: can't open %s" % bin_path)
		return

	var heights := PackedFloat32Array()
	heights.resize(65536)
	for i in range(65536):
		heights[i] = f.get_float()
	f.close()

	var cache_id: String = str(msg.get("cacheID", ""))
	var grid_x: int = int(msg.get("gridX", 0))
	var grid_y: int = int(msg.get("gridY", 0))
	var offset_x: float = float(msg.get("offsetX", 0.0))
	var offset_y: float = float(msg.get("offsetY", 0.0))

	# Store heights and grid mapping for neighbor stitching
	terrain_heights[cache_id] = heights
	var grid_key := "%d,%d" % [grid_x, grid_y]
	terrain_grid[grid_key] = cache_id

	# Build this tile (with neighbor edge data if available)
	_build_terrain_tile(cache_id, grid_x, grid_y, offset_x, offset_y)

	# Rebuild the tile to the west (it needs our x=0 column as its east edge)
	var west_key := "%d,%d" % [grid_x - 1, grid_y]
	if terrain_grid.has(west_key):
		var west_id: String = terrain_grid[west_key]
		_build_terrain_tile(west_id, grid_x - 1, grid_y, offset_x - 256.0, offset_y)

	# Rebuild the tile to the south (it needs our y=0 row as its north edge)
	var south_key := "%d,%d" % [grid_x, grid_y - 1]
	if terrain_grid.has(south_key):
		var south_id: String = terrain_grid[south_key]
		_build_terrain_tile(south_id, grid_x, grid_y - 1, offset_x, offset_y - 256.0)

	DebugLog.debug("terrain", "Tile loaded: cacheID=%s grid=(%d,%d) offset=(%.0f, %.0f)" % [cache_id.substr(0, 8), grid_x, grid_y, offset_x, offset_y])

	# Build water plane
	var water_height: float = float(msg.get("waterHeight", 20.0))
	_water_height = water_height
	_build_water_plane(water_height)


## Build (or rebuild) a single terrain tile with stitched neighbor edges.
func _build_terrain_tile(cache_id: String, grid_x: int, grid_y: int, offset_x: float, offset_y: float) -> void:
	var heights: PackedFloat32Array = terrain_heights.get(cache_id, PackedFloat32Array())
	if heights.size() < 65536:
		return

	# East neighbor: their x=0 column is our x=256 edge
	var east_edge := PackedFloat32Array()
	var east_key := "%d,%d" % [grid_x + 1, grid_y]
	if terrain_grid.has(east_key):
		var east_h: PackedFloat32Array = terrain_heights.get(terrain_grid[east_key], PackedFloat32Array())
		if east_h.size() >= 65536:
			east_edge.resize(256)
			for y in range(256):
				east_edge[y] = east_h[y * 256 + 0]  # x=0 column of east neighbor

	# North neighbor: their y=0 row is our y=256 edge
	var north_edge := PackedFloat32Array()
	var north_key := "%d,%d" % [grid_x, grid_y + 1]
	if terrain_grid.has(north_key):
		var north_h: PackedFloat32Array = terrain_heights.get(terrain_grid[north_key], PackedFloat32Array())
		if north_h.size() >= 65536:
			north_edge.resize(256)
			for x in range(256):
				north_edge[x] = north_h[0 * 256 + x]  # y=0 row of north neighbor

	# Corner (256, 256) — northeast neighbor's (0, 0)
	var corner_h: float = 0.0
	var ne_key := "%d,%d" % [grid_x + 1, grid_y + 1]
	if terrain_grid.has(ne_key):
		var ne_h: PackedFloat32Array = terrain_heights.get(terrain_grid[ne_key], PackedFloat32Array())
		if ne_h.size() >= 65536:
			corner_h = ne_h[0]

	var mesh := _build_terrain_mesh(heights, east_edge, north_edge, corner_h)

	# Remove existing tile
	if terrain_nodes.has(cache_id):
		var old_node: MeshInstance3D = terrain_nodes[cache_id]
		if is_instance_valid(old_node):
			old_node.queue_free()

	var tile := MeshInstance3D.new()
	tile.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.36, 0.50, 0.25)
	mat.roughness = 0.9
	tile.material_override = mat
	tile.position = Vector3(offset_x, 0.0, -offset_y)

	sm.add_child(tile)
	terrain_nodes[cache_id] = tile


func _build_terrain_mesh(heights: PackedFloat32Array, east_edge: PackedFloat32Array, north_edge: PackedFloat32Array, corner_h: float) -> ArrayMesh:
	# 257x257 vertices (256 quads per axis = 256m). Heights array is 256x256.
	# East edge (x=256) and north edge (y=256) come from neighboring regions.
	# If no neighbor data, those arrays are empty and we repeat the last row/column.
	const W := 257
	var has_east := east_edge.size() >= 256
	var has_north := north_edge.size() >= 256
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var indices := PackedInt32Array()

	verts.resize(W * W)
	normals.resize(W * W)

	# Place vertices: Godot coords = (x, height, -y)
	for y in range(W):
		for x in range(W):
			var h: float
			if x < 256 and y < 256:
				h = heights[y * 256 + x]
			elif x == 256 and y < 256:
				h = east_edge[y] if has_east else heights[y * 256 + 255]
			elif y == 256 and x < 256:
				h = north_edge[x] if has_north else heights[255 * 256 + x]
			else:
				# Corner (256, 256) — use neighbor data or repeat
				if has_east and has_north:
					h = corner_h
				elif has_east:
					h = east_edge[255]
				elif has_north:
					h = north_edge[255]
				else:
					h = heights[255 * 256 + 255]
			verts[y * W + x] = Vector3(float(x), h, -float(y))

	# Compute normals from height differences (sample from vertex positions)
	for y in range(W):
		for x in range(W):
			var hL: float = verts[y * W + maxi(x - 1, 0)].y
			var hR: float = verts[y * W + mini(x + 1, W - 1)].y
			var hD: float = verts[mini(y + 1, W - 1) * W + x].y
			var hU: float = verts[maxi(y - 1, 0) * W + x].y
			normals[y * W + x] = Vector3(hL - hR, 2.0, hD - hU).normalized()

	# Build triangle indices: 256x256 cells, 2 triangles each
	indices.resize(256 * 256 * 6)
	var ii := 0
	for y in range(256):
		for x in range(256):
			var tl := y * W + x
			var tr := tl + 1
			var bl := (y + 1) * W + x
			var br := bl + 1
			indices[ii] = tl; ii += 1
			indices[ii] = bl; ii += 1
			indices[ii] = tr; ii += 1
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
	DebugLog.debug("water", "_build_water_plane called, water_height=%s" % water_height)

	# Tear down any existing water
	if _ocean_quad_tree:
		_ocean_quad_tree.queue_free()
		_ocean_quad_tree = null
	if _underwater_fog_quad != null:
		if is_instance_valid(_underwater_fog_quad):
			_underwater_fog_quad.queue_free()
		_underwater_fog_quad = null
	_ocean = null
	_ocean_logged_ready = false

	var qt_scene = load("res://addons/tessarakkt.oceanfft/components/QuadTree3D.tscn")

	# Create Ocean3D resource (FFT simulation)
	_ocean = Ocean3DScript.new()
	_ocean.fft_resolution = Ocean3DScript.FFTResolution.FFT_128x128
	_ocean.horizontal_dimension = 256
	_ocean.wind_speed = 12.0
	_ocean.wind_direction_degrees = 45.0
	_ocean.choppiness = 0.6
	_ocean.time_scale = 1.0
	_ocean.simulation_frameskip = 1
	_ocean.heightmap_sync_frameskip = -1  # no GPU→CPU readback — fog is GPU-side
	_ocean.simulation_enabled = true
	_ocean.initialize_simulation()

	# Configure shader material params
	var mat: ShaderMaterial = _ocean.material
	mat.set_shader_parameter("water_opacity", 1.0)
	mat.set_shader_parameter("opacity_depth", 5.0)
	mat.set_shader_parameter("deep_color", Color(0.01, 0.04, 0.1))
	mat.set_shader_parameter("fresnel_strength", 1.0)
	# Refraction: default depth_factor (0.00001) is invisible — boost so
	# underwater objects visibly distort through the FFT wave normals.
	mat.set_shader_parameter("refraction_depth_factor", 0.03)
	mat.set_shader_parameter("refraction_factor_max", 0.15)

	# Create QuadTree3D (LOD mesh tiles)
	_ocean_quad_tree = qt_scene.instantiate()
	_ocean_quad_tree.lod_level = 5
	_ocean_quad_tree.quad_size = 4096
	_ocean_quad_tree.mesh_vertex_resolution = 64
	_ocean_quad_tree.morph_range = 0.3
	var r: Array[float] = [48.0, 96.0, 192.0, 384.0, 768.0, 1536.0]
	_ocean_quad_tree.ranges = r
	_ocean_quad_tree.material = mat

	# Position at water height
	_ocean_quad_tree.position = Vector3(128.0, water_height, -128.0)

	sm.add_child(_ocean_quad_tree)

	# Layer 2 so spot/omni lights don't cast blocky shadow artifacts on water
	_set_layer_recursive(_ocean_quad_tree, 2)

	# GPU underwater fog — fullscreen quad with depth-based shader
	_create_underwater_fog_quad(water_height)

	DebugLog.log("water", "OceanFFT water added at height %s" % water_height)


## Recursively set all MeshInstance3D children to a specific render layer (removing layer 1).
## Skips VisibleOnScreenNotifier3D so LOD visibility detection still works.
func _set_layer_recursive(node: Node, layer: int) -> void:
	if node is MeshInstance3D:
		node.set_layer_mask_value(1, false)
		node.set_layer_mask_value(layer, true)
	for child in node.get_children():
		_set_layer_recursive(child, layer)


## Create the fullscreen quad that handles underwater fog entirely on the GPU.
## The shader checks camera Y vs water_height and applies depth-based fog — no CPU readback.
func _create_underwater_fog_quad(water_height: float) -> void:
	if _underwater_fog_quad != null:
		if is_instance_valid(_underwater_fog_quad):
			_underwater_fog_quad.queue_free()

	_underwater_fog_quad = MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(2.0, 2.0)
	_underwater_fog_quad.mesh = quad

	var mat := ShaderMaterial.new()
	mat.shader = UnderwaterFogShader
	mat.set_shader_parameter("water_height", water_height)
	mat.set_shader_parameter("fog_color", Vector3(_underwater_fog_color.r, _underwater_fog_color.g, _underwater_fog_color.b))
	mat.set_shader_parameter("fog_density", _underwater_fog_density)

	# Share the OceanFFT displacement textures so the fog responds to wave heights
	if _ocean != null and _ocean.initialized:
		var ocean_mat: ShaderMaterial = _ocean.material
		mat.set_shader_parameter("cascade_displacements", ocean_mat.get_shader_parameter("cascade_displacements"))
		mat.set_shader_parameter("cascade_uv_scales", ocean_mat.get_shader_parameter("cascade_uv_scales"))
		mat.set_shader_parameter("uv_scale", ocean_mat.get_shader_parameter("uv_scale"))
		mat.set_shader_parameter("wind_uv_offset", ocean_mat.get_shader_parameter("wind_uv_offset"))

	# Render after everything else
	mat.render_priority = 100
	_underwater_fog_quad.material_override = mat

	# Ensure it's not affected by culling or transforms
	_underwater_fog_quad.extra_cull_margin = 16384.0
	sm.add_child(_underwater_fog_quad)

## Update underwater fog shader uniforms when EEP settings change.
func _update_underwater_fog_uniforms() -> void:
	if _underwater_fog_quad == null or not is_instance_valid(_underwater_fog_quad):
		return
	var mat: ShaderMaterial = _underwater_fog_quad.material_override
	if mat:
		mat.set_shader_parameter("fog_color", Vector3(_underwater_fog_color.r, _underwater_fog_color.g, _underwater_fog_color.b))
		mat.set_shader_parameter("fog_density", _underwater_fog_density)



func handle_environment_data(msg: Dictionary) -> void:
	var sun_dir_arr: Array = msg.get("sunDirection", [0.5, 0.7, -0.5])
	var sun_color_arr: Array = msg.get("sunColor", [1.0, 0.95, 0.8])
	var ambient_arr: Array = msg.get("ambientColor", [0.3, 0.35, 0.4])

	# Convert SL sun direction to Godot coords: (sl.x, sl.z, -sl.y)
	var sl_dir := Vector3(float(sun_dir_arr[0]), float(sun_dir_arr[1]), float(sun_dir_arr[2]))
	var godot_sun_dir := Vector3(sl_dir.x, sl_dir.z, -sl_dir.y).normalized()

	var light: DirectionalLight3D = sm.get_node_or_null("../DirectionalLight3D")
	if light:
		if godot_sun_dir.length() > 0.001:
			# Basis.looking_at(-dir) makes -Z point away from sun, +Z toward sun.
			# ProceduralSkyMaterial renders the sun disc at the light's +Z direction.
			light.basis = Basis.looking_at(-godot_sun_dir, Vector3.UP)
		var sun_color := Color(float(sun_color_arr[0]), float(sun_color_arr[1]), float(sun_color_arr[2]))
		light.light_color = sun_color
		_sun_target_energy = 1.0
		light.light_energy = _sun_energy

	# Update WorldEnvironment with procedural sky
	var world_env: WorldEnvironment = sm.get_node_or_null("../WorldEnvironment")
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
		# Derive ambient energy from SL ambient color luminance
		var amb_lum: float = amb_c.r * 0.2126 + amb_c.g * 0.7152 + amb_c.b * 0.0722
		_ambient_target_energy = clampf(amb_lum * 2.0, 0.05, 1.0)
		env.ambient_light_energy = _ambient_energy

	# --- Water settings from EEP ---
	# Underwater fog color/density
	var fog_changed := false
	if msg.has("waterFogColor"):
		var wfc: Array = msg["waterFogColor"]
		_underwater_fog_color = Color(float(wfc[0]), float(wfc[1]), float(wfc[2]))
		fog_changed = true
	if msg.has("waterFogDensity"):
		# SL fog density is an exponential factor (typically 1-16); map to Godot's 0-1 range
		var sl_density: float = float(msg["waterFogDensity"])
		_underwater_fog_density = clampf(sl_density * 0.02, 0.01, 0.5)
		fog_changed = true
	if fog_changed:
		_update_underwater_fog_uniforms()

	# Ocean wave direction and shader params
	if _ocean != null and _ocean.initialized:
		# Derive wind direction from wave1Direction (dominant wave propagation)
		if msg.has("wave1Direction"):
			var w1: Array = msg["wave1Direction"]
			var wx: float = float(w1[0])
			var wy: float = float(w1[1])
			var mag: float = sqrt(wx * wx + wy * wy)
			if mag > 0.001:
				var dir_rad: float = atan2(wy, wx)
				_ocean.wind_direction_degrees = rad_to_deg(dir_rad)
				# Scale wind speed by wave direction magnitude (typical range ~0.5-2.0)
				_ocean.wind_speed = clampf(mag * 10.0, 3.0, 30.0)
				DebugLog.debug("water", "EEP wave direction: %.1f deg speed: %.1f" % [rad_to_deg(dir_rad), _ocean.wind_speed])

		# Fresnel parameters
		var mat: ShaderMaterial = _ocean.material
		if msg.has("fresnelOffset"):
			mat.set_shader_parameter("fresnel_strength", clampf(float(msg["fresnelOffset"]) + float(msg.get("fresnelScale", 0.4)), 0.1, 2.0))

		# Deep water color from fog color
		if msg.has("waterFogColor"):
			var wfc: Array = msg["waterFogColor"]
			mat.set_shader_parameter("deep_color", Color(float(wfc[0]) * 0.3, float(wfc[1]) * 0.3, float(wfc[2]) * 0.3))
