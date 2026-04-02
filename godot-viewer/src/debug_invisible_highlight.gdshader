shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never;

void fragment() {
	ALBEDO = vec3(1.0, 0.0, 0.0);
	ALPHA = 0.4;
}
