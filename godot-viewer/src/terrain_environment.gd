extends RefCounted

## Terrain heightmap, water (OceanFFT + flat fallback), underwater fog, and sky/environment.

const Ocean3DScript = preload("res://addons/tessarakkt.oceanfft/components/Ocean3D.gd")
const QuadTree3DScript = preload("res://addons/tessarakkt.oceanfft/components/QuadTree3D.gd")

var sm  # scene_manager reference

var terrain_node: MeshInstance3D
var water_node: MeshInstance3D  # flat fallback (only if OceanFFT unavailable)
var _ocean = null  # Ocean3D
var _ocean_quad_tree = null  # QuadTree3D
var _ocean_logged_ready: bool = false
var _water_height: float = 20.0       # SL water surface Y (Godot coords), set by handle_terrain_ready
var _camera_underwater: bool = false   # true when camera is below water surface

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
	# OceanFFT simulation
	if _ocean != null and _ocean.initialized:
		_ocean.simulate(_delta)

	# Underwater fog check
	if _ocean_quad_tree != null or water_node != null:
		_update_underwater_fog()

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
	if terrain_node:
		terrain_node.queue_free()
		terrain_node = null
	if water_node:
		water_node.queue_free()
		water_node = null
	if _ocean != null:
		if _ocean is Node and is_instance_valid(_ocean):
			_ocean.queue_free()
		_ocean = null
	if _ocean_quad_tree != null:
		if _ocean_quad_tree is Node and is_instance_valid(_ocean_quad_tree):
			_ocean_quad_tree.queue_free()
		_ocean_quad_tree = null
	_ocean_logged_ready = false


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

	sm.add_child(terrain_node)

	# Build water plane
	var water_height: float = float(msg.get("waterHeight", 20.0))
	_water_height = water_height
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

	# Try OceanFFT addon
	var qt_scene = load("res://addons/tessarakkt.oceanfft/components/QuadTree3D.tscn")
	if qt_scene == null:
		push_warning("[Water] OceanFFT addon not found — using flat water fallback")
		_build_flat_water(water_height)
		return

	# Create Ocean3D resource (FFT simulation)
	_ocean = Ocean3DScript.new()
	_ocean.fft_resolution = Ocean3DScript.FFTResolution.FFT_128x128
	_ocean.horizontal_dimension = 256
	_ocean.wind_speed = 12.0
	_ocean.wind_direction_degrees = 45.0
	_ocean.choppiness = 0.6
	_ocean.time_scale = 1.0
	_ocean.simulation_frameskip = 1
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

	print("[Water] OceanFFT water added at height ", water_height)


## Recursively set all MeshInstance3D children to a specific render layer (removing layer 1).
## Skips VisibleOnScreenNotifier3D so LOD visibility detection still works.
func _set_layer_recursive(node: Node, layer: int) -> void:
	if node is MeshInstance3D:
		node.set_layer_mask_value(1, false)
		node.set_layer_mask_value(layer, true)
	for child in node.get_children():
		_set_layer_recursive(child, layer)


func _update_underwater_fog() -> void:
	var camera: Camera3D = sm.get_node_or_null("../Camera3D")
	if camera == null:
		return
	# Use FFT wave height at camera position when available
	var effective_water_y := _water_height
	if _ocean != null and _ocean.initialized:
		effective_water_y = _ocean.get_wave_height(camera, camera.global_position) + _water_height
	var is_underwater := camera.global_position.y < effective_water_y

	if is_underwater == _camera_underwater:
		return  # no state change
	_camera_underwater = is_underwater

	var world_env: WorldEnvironment = sm.get_node_or_null("../WorldEnvironment")
	if world_env == null or world_env.environment == null:
		return
	var env := world_env.environment

	if is_underwater:
		env.fog_enabled = true
		env.fog_light_color = Color(0.03, 0.06, 0.12)
		env.fog_density = 0.12
		env.fog_light_energy = 0.6
	else:
		# Reset underwater fog color back to defaults
		env.fog_light_color = Color.WHITE
		env.fog_light_energy = 1.0
		env.fog_enabled = false


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
	water_node.set_layer_mask_value(1, false)
	water_node.set_layer_mask_value(2, true)
	sm.add_child(water_node)


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
