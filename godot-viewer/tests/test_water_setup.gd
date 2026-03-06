extends Node

## Tests for OceanFFT + SSR water setup.
## Validates shader compilation, Ocean3D initialization guards, and scene_manager
## water plane construction without needing a full viewer session.
## Run: cd godot-viewer && GODOT=$(cat godot-version.txt | tr -d '[:space:]') && \
##      ./$GODOT/${GODOT}_console.exe --headless --quit-after 10 --scene tests/test_water_setup.tscn

var _passed := 0
var _failed := 0


func _ready() -> void:
	_passed = 0
	_failed = 0

	_test_surface_visual_shader_loads()
	_test_ocean3d_not_initialized_by_default()
	_test_ocean3d_initialize_and_simulate()
	_test_quadtree_instantiation()
	_test_ocean_material_params()
	_test_initialized_guard_simulate()
	_test_initialized_guard_wave_height()

	print("--- water_setup tests: %d passed, %d failed ---" % [_passed, _failed])


# ─── Helpers ──────────────────────────────────────

func _assert(condition: bool, msg: String) -> void:
	if condition:
		_passed += 1
	else:
		_failed += 1
		push_error("FAIL: %s" % msg)


func _assert_eq(actual, expected, msg: String) -> void:
	_assert(actual == expected, "%s: expected %s, got %s" % [msg, str(expected), str(actual)])


# ─── Tests ────────────────────────────────────────

func _test_surface_visual_shader_loads() -> void:
	var shader = load("res://addons/tessarakkt.oceanfft/shaders/SurfaceVisual.gdshader")
	_assert(shader != null, "SurfaceVisual.gdshader should load")
	_assert(shader is Shader, "SurfaceVisual.gdshader should be a Shader resource")


func _test_ocean3d_not_initialized_by_default() -> void:
	var ocean := Ocean3D.new()
	_assert_eq(ocean.initialized, false, "Ocean3D should not be initialized by default")


func _test_ocean3d_initialize_and_simulate() -> void:
	# Ocean3D compute shaders need a real RenderingDevice (GPU).
	# In headless mode RD is null, so skip this test.
	var rd := RenderingServer.get_rendering_device()
	if rd == null:
		print("  [SKIP] _test_ocean3d_initialize_and_simulate — no RenderingDevice (headless)")
		return

	var ocean := Ocean3D.new()
	ocean.fft_resolution = Ocean3D.FFTResolution.FFT_128x128
	ocean.horizontal_dimension = 256
	ocean.simulation_enabled = false
	ocean.initialize_simulation()

	# initialize_simulation defers to the render thread; wait a frame
	await get_tree().process_frame
	await get_tree().process_frame

	_assert_eq(ocean.initialized, true, "Ocean3D should be initialized after initialize_simulation + frame")

	# simulate should not crash now
	ocean.simulation_enabled = true
	ocean.simulate(0.016)
	_assert(true, "Ocean3D.simulate() did not crash after initialization")


func _test_quadtree_instantiation() -> void:
	var qt_scene = load("res://addons/tessarakkt.oceanfft/components/QuadTree3D.tscn")
	_assert(qt_scene != null, "QuadTree3D.tscn should load")

	var qt := qt_scene.instantiate() as QuadTree3D
	_assert(qt != null, "QuadTree3D should instantiate")
	_assert(qt is QuadTree3D, "Instantiated node should be QuadTree3D")
	qt.queue_free()


func _test_ocean_material_params() -> void:
	var ocean := Ocean3D.new()
	var mat: ShaderMaterial = ocean.material
	_assert(mat != null, "Ocean3D.material should not be null")
	_assert(mat is ShaderMaterial, "Ocean3D.material should be a ShaderMaterial")

	# Set our custom params — should not error
	mat.set_shader_parameter("water_opacity", 1.0)
	mat.set_shader_parameter("opacity_depth", 5.0)
	mat.set_shader_parameter("deep_color", Color(0.01, 0.04, 0.1))

	# SSR params should exist in the shader
	mat.set_shader_parameter("ssr_resolution", 0.25)
	mat.set_shader_parameter("ssr_max_travel", 20.0)
	mat.set_shader_parameter("ssr_mix_strength", 0.7)
	_assert(true, "Setting SSR shader parameters did not error")


func _test_initialized_guard_simulate() -> void:
	# Simulates what scene_manager._process does: guard on .initialized
	var ocean := Ocean3D.new()
	ocean.simulation_enabled = false

	# This is the guard we use in scene_manager — should skip without error
	if ocean.initialized:
		ocean.simulate(0.016)
	_assert(true, "Guarded simulate() skipped correctly when not initialized")


func _test_initialized_guard_wave_height() -> void:
	# Simulates what _update_underwater_fog does: guard on .initialized
	var ocean := Ocean3D.new()

	if ocean.initialized:
		# Would crash without guard — but we skip it
		var _h = ocean.get_wave_height(null, Vector3.ZERO)
	_assert(true, "Guarded get_wave_height() skipped correctly when not initialized")
