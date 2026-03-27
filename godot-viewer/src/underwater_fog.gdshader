shader_type spatial;
render_mode blend_mix, unshaded, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled;

// Uniforms updated from terrain_environment.gd
uniform float water_height = 20.0;
uniform vec3 fog_color : source_color = vec3(0.03, 0.06, 0.12);
uniform float fog_density = 0.12;

// OceanFFT wave displacement — same textures/params as SurfaceVisual.gdshader
const int CASCADE_COUNT = 3;
uniform sampler2D cascade_displacements[CASCADE_COUNT];
uniform float cascade_uv_scales[CASCADE_COUNT];
uniform float uv_scale = 0.001953125;
uniform vec2 wind_uv_offset = vec2(0.0, 0.0);

uniform sampler2D depth_texture : hint_depth_texture, filter_nearest;

// Sample wave height at a world XZ position (matches OceanCommon.gdshaderinc)
float get_wave_height(vec2 world_xz) {
	float height = 0.0;
	for (int i = 0; i < CASCADE_COUNT; i++) {
		vec2 uv = world_xz * uv_scale * (1.0 / cascade_uv_scales[i])
		         + wind_uv_offset * cascade_uv_scales[i];
		height += texture(cascade_displacements[i], uv).g;
	}
	return height;
}

void vertex() {
	// Fullscreen quad — map local vertices (-1..1) directly to clip space
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
}

void fragment() {
	vec3 cam_pos = INV_VIEW_MATRIX[3].xyz;

	// Sample FFT wave height at camera XZ position
	float wave_y = water_height + get_wave_height(cam_pos.xz);

	// Camera above the local wave surface — nothing to draw
	if (cam_pos.y >= wave_y) {
		discard;
	}

	// Reconstruct view-space depth for distance fog
	float raw_depth = textureLod(depth_texture, SCREEN_UV, 0.0).r;
	vec4 clip_pos = vec4(SCREEN_UV * 2.0 - 1.0, raw_depth, 1.0);
	vec4 view_pos = INV_PROJECTION_MATRIX * clip_pos;
	view_pos.xyz /= view_pos.w;
	float dist = length(view_pos.xyz);

	// Exponential fog matching Godot's built-in fog model
	float fog_factor = clamp(1.0 - exp(-dist * fog_density), 0.0, 0.9);

	ALBEDO = fog_color;
	ALPHA = fog_factor;
}
