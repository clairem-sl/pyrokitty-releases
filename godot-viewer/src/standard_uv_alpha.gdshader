shader_type spatial;
render_mode blend_mix, cull_back;

// Alpha-blend variant of standard_uv.gdshader.
// Used for faces with resolved_mode 1 (blend) or semi-transparent color.
// Writes ALPHA for proper alpha blending — see standard_uv.gdshader for opaque variant.

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform float repeat_u = 1.0;
uniform float repeat_v = 1.0;
uniform float offset_u = 0.0;
uniform float offset_v = 0.0;
uniform float tex_rotation = 0.0;
uniform bool full_bright = false;

varying vec2 xformed_uv;

void vertex() {
	// Mesh UVs are in Godot convention (V flipped by prim_mesh_generator: 1.0 - tt).
	// Convert Godot UV → SL UV before applying SL's xform(), then convert back.
	vec2 uv = vec2(UV.x, 1.0 - UV.y);  // Godot → SL UV convention

	// Apply SL's xform() — center at 0.5, rotate, scale, offset + re-center
	// Matches llface.cpp:763-787
	uv -= vec2(0.5);

	// Rotate (SL rotation direction: s*cos+t*sin, -s*sin+t*cos)
	float cr = cos(tex_rotation);
	float sr = sin(tex_rotation);
	uv = vec2(uv.x * cr + uv.y * sr, -uv.x * sr + uv.y * cr);

	// Scale by repeat
	uv *= vec2(repeat_u, repeat_v);

	// Offset + re-center
	uv += vec2(offset_u + 0.5, offset_v + 0.5);

	xformed_uv = vec2(uv.x, 1.0 - uv.y);  // SL → Godot UV convention
}

void fragment() {
	vec4 tex_color = texture(albedo_tex, xformed_uv);
	ALBEDO = tex_color.rgb * albedo_color.rgb;
	ALPHA = tex_color.a * albedo_color.a;

	if (full_bright) {
		EMISSION = ALBEDO;
		ALBEDO = vec3(0.0);
	}
}
