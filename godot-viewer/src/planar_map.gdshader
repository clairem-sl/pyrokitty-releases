shader_type spatial;
render_mode cull_back;

// Implements SL's planarProjection() UV mapping.
// UVs are computed from vertex position × prim scale using the face normal
// to select projection axes — matching indra/newview/llface.cpp:96-129.

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform float repeat_u = 1.0;
uniform float repeat_v = 1.0;
uniform float offset_u = 0.0;
uniform float offset_v = 0.0;
uniform float tex_rotation = 0.0;
uniform float alpha_scissor_threshold = -1.0; // <0 = disabled
uniform bool full_bright = false;
uniform int debug_mode = 0; // 0=off, 1=SL normal, 2=UV, 3=binormal

varying vec2 planar_uv;
varying vec3 debug_sl_normal;
varying vec3 debug_binormal;

void vertex() {
	// Mesh vertices are in Godot space (converted by _sl_to_godot in prim_mesh_generator).
	// Godot scale from MODEL_MATRIX: (sl_sx, sl_sz, sl_sy) due to sl_to_godot_scale().
	float sx = length(MODEL_MATRIX[0].xyz);
	float sy = length(MODEL_MATRIX[1].xyz);
	float sz = length(MODEL_MATRIX[2].xyz);

	// Scale vertex to world size in Godot space
	vec3 scaled = VERTEX * vec3(sx, sy, sz);

	// Convert Godot space → SL space for the projection algorithm
	// Godot (x, y, z) → SL (x, -z, y)  [inverse of _sl_to_godot: (x, z, -y)]
	vec3 sl_pos = vec3(scaled.x, -scaled.z, scaled.y);

	// Normal → SL space (same conversion as position)
	vec3 sl_n = vec3(NORMAL.x, -NORMAL.z, NORMAL.y);

	// SL planarProjection algorithm (llface.cpp:96-129)
	vec3 binormal;
	float d = sl_n.x;
	if (abs(d) >= 0.5) {
		binormal = d < 0.0 ? vec3(0, -1, 0) : vec3(0, 1, 0);
	} else {
		binormal = sl_n.y > 0.0 ? vec3(-1, 0, 0) : vec3(1, 0, 0);
	}
	vec3 tangent_vec = cross(binormal, sl_n);

	// Exact SL formula (llface.cpp:127-128)
	float u = 1.0 + (dot(binormal, sl_pos) * 2.0 - 0.5);
	float v = -(dot(tangent_vec, sl_pos) * 2.0 - 0.5);

	// Apply SL's xform() — texture repeat/offset/rotation (llface.cpp:763-787)
	// Must match exactly: center at 0.5, rotate, scale, offset + re-center
	vec2 uv = vec2(u, v);
	uv -= vec2(0.5);

	// Rotate (SL rotation direction: s*cos+t*sin, -s*sin+t*cos)
	float cr = cos(tex_rotation);
	float sr = sin(tex_rotation);
	uv = vec2(uv.x * cr + uv.y * sr, -uv.x * sr + uv.y * cr);

	// Scale by repeat
	uv *= vec2(repeat_u, repeat_v);

	// Offset + re-center
	uv += vec2(offset_u + 0.5, offset_v + 0.5);

	planar_uv = vec2(uv.x, 1.0 - uv.y);  // SL → Godot UV convention (V=0 at top)
	debug_sl_normal = sl_n;
	debug_binormal = binormal;
}

void fragment() {
	vec4 tex_color = texture(albedo_tex, planar_uv);

	// Debug visualizations: 1=SL normal, 2=UV, 3=binormal
	// Normal: top=blue(0,0,1), bottom=(0.5,0.5,0), +X=red, +Y=green
	// UV: U=red, V=green (fract wraps to 0-1)
	if (debug_mode == 1) {
		ALBEDO = debug_sl_normal * 0.5 + 0.5;
	} else if (debug_mode == 2) {
		ALBEDO = vec3(fract(planar_uv.x), fract(planar_uv.y), 0.0);
	} else if (debug_mode == 3) {
		ALBEDO = debug_binormal * 0.5 + 0.5;
	} else {
		ALBEDO = tex_color.rgb * albedo_color.rgb;
		if (full_bright) {
			EMISSION = ALBEDO;
			ALBEDO = vec3(0.0);
		}
	}

	// Alpha mask: discard below threshold (opaque pipeline, no ALPHA write)
	if (alpha_scissor_threshold >= 0.0) {
		if (tex_color.a * albedo_color.a < alpha_scissor_threshold) {
			discard;
		}
	}
}
