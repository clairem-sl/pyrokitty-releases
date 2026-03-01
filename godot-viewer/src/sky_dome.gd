extends MeshInstance3D

## Atmosphere sky dome using fbcosentino's extremely-fast-atmosphere shader.
## shader_type spatial emits motion vectors — fully TAA-compatible, no sky ghosting.
##
## Position is updated externally each frame (by Main) to follow the active camera.
## The box must fit within the camera's far clip plane so its faces aren't clipped;
## call set_camera_far() once at startup and whenever the far plane changes.
##
## Atmosphere shader params (sea_level, atmosphere_radius) stay fixed at the defaults
## from the fbcosentino demo — the camera is always at the sphere center so the visual
## is identical regardless of scale. Only the box size changes with far.

@export var sun_object: Node3D

func _init() -> void:
	# Flip-faces box: inside surface faces the camera (camera is always inside)
	var box := BoxMesh.new()
	box.flip_faces = true
	box.size = Vector3(250.0, 250.0, 250.0)  # overridden by set_camera_far()
	mesh = box

	var shader := load("res://addons/extremely_fast_atmosphere/atmosphere/atmosphere_fbcosentino.gdshader") as Shader
	var mat := ShaderMaterial.new()
	mat.render_priority = 2
	mat.shader = shader

	# -- Height profile: density and color by altitude --
	# Dense blue at horizon, fading clear toward zenith
	var h_curve := Curve.new()
	h_curve.add_point(Vector2(0.0, 1.0), 0.0, -5.456)
	h_curve.add_point(Vector2(0.247, 0.331), -1.25, -1.25)
	h_curve.add_point(Vector2(1.0, 0.0), 0.0, 0.0)
	var h_curve_tex := CurveTexture.new()
	h_curve_tex.curve = h_curve
	mat.set_shader_parameter("height_profile_curve", h_curve_tex)

	var h_main := Gradient.new()
	h_main.offsets = PackedFloat32Array([0.0, 0.103])
	h_main.colors = PackedColorArray([Color(0.74, 0.944, 1.0), Color(0.408, 0.794, 0.998)])
	var h_main_tex := GradientTexture1D.new()
	h_main_tex.gradient = h_main
	mat.set_shader_parameter("height_profile_main_colors", h_main_tex)

	var h_back := Gradient.new()
	h_back.offsets = PackedFloat32Array([0.0, 0.013, 0.102, 0.558, 1.0])
	h_back.colors = PackedColorArray([
		Color(0.0, 0.0, 0.0), Color(1.0, 0.200, 0.160),
		Color(1.0, 0.905, 0.795), Color(0.79, 0.716, 0.632), Color(0.0, 0.0, 0.0)
	])
	var h_back_tex := GradientTexture1D.new()
	h_back_tex.gradient = h_back
	mat.set_shader_parameter("height_profile_back_colors", h_back_tex)

	# -- Direction profile: density and color by sun angle (day/night) --
	var d_curve := Curve.new()
	d_curve.add_point(Vector2(0.0, 0.0), 0.0, 0.0)
	d_curve.add_point(Vector2(0.421, 0.206), 1.05, 1.05)
	d_curve.add_point(Vector2(0.575, 1.0), 0.0, 0.0)
	var d_curve_tex := CurveTexture.new()
	d_curve_tex.curve = d_curve
	mat.set_shader_parameter("direction_profile_curve", d_curve_tex)

	var d_main := Gradient.new()
	d_main.offsets = PackedFloat32Array([0.378, 0.531, 0.633])
	d_main.colors = PackedColorArray([
		Color(0.0, 0.0, 0.0), Color(0.98, 0.711, 0.519), Color(1.0, 1.0, 1.0)
	])
	var d_main_tex := GradientTexture1D.new()
	d_main_tex.gradient = d_main
	mat.set_shader_parameter("direction_profile_main_colors", d_main_tex)

	var d_back := Gradient.new()
	d_back.offsets = PackedFloat32Array([0.503, 0.575])
	d_back.colors = PackedColorArray([Color(0.087, 0.0, 0.45), Color(0.0, 0.791, 0.587)])
	var d_back_tex := GradientTexture1D.new()
	d_back_tex.gradient = d_back
	mat.set_shader_parameter("direction_profile_back_colors", d_back_tex)

	# -- Water overlay (disabled) --
	var water := Gradient.new()
	water.colors = PackedColorArray([Color(0.0, 0.49, 0.503), Color(0.0, 0.45, 0.45)])
	var water_tex := GradientTexture1D.new()
	water_tex.gradient = water
	mat.set_shader_parameter("water_depth_profile_colors", water_tex)
	mat.set_shader_parameter("water_density_factor", 0.0)

	mat.set_shader_parameter("sea_level", 100.0)
	mat.set_shader_parameter("atmosphere_radius", 110.0)
	mat.set_shader_parameter("atmosphere_density", 0.2)

	material_override = mat


func _ready() -> void:
	set_physics_process(sun_object != null)


## Resize the box so it fits within the camera far clip plane.
## Atmosphere sphere radius stays fixed at 110m — the camera is always inside
## it regardless of box size, so visual appearance doesn't change.
func set_camera_far(far: float) -> void:
	var box := mesh as BoxMesh
	if box:
		# 1.8x gives ~10% headroom before the far clip (e.g. 57.6m for 32m far)
		box.size = Vector3.ONE * far * 1.8


func _physics_process(_delta: float) -> void:
	if sun_object:
		# Rotate to face away from the sun — shader reads forward vector as light direction
		var delta_pos := sun_object.global_position - global_position
		look_at(global_position - delta_pos)
