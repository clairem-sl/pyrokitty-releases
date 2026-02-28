shader_type spatial;
render_mode cull_back;

// Standard UV mapping with SL's xform() texture transform.
// Used for faces with non-zero texture rotation (StandardMaterial3D has no rotation).
// Uses mesh UV coordinates (not planar projection — see planar_map.gdshader for that).

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform float repeat_u = 1.0;
uniform float repeat_v = 1.0;
uniform float offset_u = 0.0;
uniform float offset_v = 0.0;
uniform float tex_rotation = 0.0;
uniform float alpha_scissor_threshold = -1.0; // <0 = disabled
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

	if (full_bright) {
		EMISSION = ALBEDO;
		ALBEDO = vec3(0.0);
	}

	// Alpha mask: discard below threshold (opaque pipeline, no ALPHA write)
	if (alpha_scissor_threshold >= 0.0) {
		if (tex_color.a * albedo_color.a < alpha_scissor_threshold) {
			discard;
		}
	}
}
