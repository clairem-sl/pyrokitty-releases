shader_type spatial;
render_mode world_vertex_coords, depth_draw_always, cull_disabled;

const float EPSILON = 1e-5;

#include "OceanCommon.gdshaderinc"


// Sun specular highlight
uniform float specular_strength = 1.0;
uniform float specular_power = 1500.0;

// ALPHA will begin decreasing to 0.0 after view_distance_max * view_fade_start
uniform float view_fade_start = 0.95;

// Colors
uniform vec4 deep_color:source_color = vec4(0.004f, 0.016f, 0.047f, 1.0);
uniform vec4 shallow_color:source_color = vec4(0, 0.729412, 0.988235, 1);


group_uniforms Fresnel;
/******************************************************************************/
// Note that PBR specular and metallic settings can significantly affect the
// result of fresnel shading. Consider playing with those settings if fresnel
// shading can't be made to look proper with just these settings.

// Fresnel Shading
uniform float fresnel_offset = 0.02;
uniform float fresnel_strength = 0.0;
uniform float fresnel_power = 5.0;
uniform float fresnel_exposure = 0.03;
uniform vec4 fresnel_sky_color:source_color = vec4(1.6f, 4.8f, 6.4f, 1.0);


group_uniforms PhysicallyBasedRendering;
/******************************************************************************/
uniform float pbr_specular_strength = 0.1;
uniform float pbr_specular_offset = 0.1;
uniform float pbr_metallic_strength = 0.0;


group_uniforms Refraction;
/******************************************************************************/
// TODO: Needs to be completely redone;

uniform float refraction_factor_min = 0.0;
uniform float refraction_factor_max = 0.15;
uniform float refraction_distance_power = 1.55;
uniform float refraction_distance_max = 30000.0;
uniform float refraction_background_brightness = 0.2;

// Adjusts how strong the refraction is based on the distance between the ocean
// pixel and the object behind it.
uniform float refraction_depth_factor = 0.03;


group_uniforms SubSurfaceScattering;
/******************************************************************************/
uniform float sss_backlight_strength = 0.0125;
uniform float sss_backlight_fov = 10.0;
uniform float sss_backlight_depth = 15.0;
uniform float sss_upwelling = 0.075;
uniform vec4 sss_color:source_color = vec4(0, 0.729412, 0.988235, 1);


group_uniforms Shoreline;
/******************************************************************************/
// Fade water to transparent near the shore based on water column depth.

uniform float shore_fade_depth = 2.0;

// Overall water opacity. Depth-based: shallow water is more transparent,
// deep water approaches this maximum. Controls the upper bound of alpha.
uniform float water_opacity : hint_range(0.0, 1.0) = 1.0;
// How many metres of water column before opacity reaches water_opacity.
uniform float opacity_depth : hint_range(0.1, 100.0) = 15.0;


group_uniforms ScreenSpaceReflections;
/******************************************************************************/
uniform float ssr_resolution   : hint_range(0.01, 10.0, 0.01)  = 0.25;
uniform float ssr_max_travel   : hint_range(0.0, 200.0, 0.1)   = 20.0;
uniform float ssr_max_diff     : hint_range(0.1, 10.0, 0.1)    = 0.5;
uniform float ssr_mix_strength : hint_range(0.0, 1.0, 0.01)    = 0.7;
uniform float ssr_screen_border_fadeout : hint_range(0.0, 1.0, 0.1) = 0.3;


group_uniforms Whitecaps;
/******************************************************************************/
// Basic whitecap rendering using Jacobian determinant.
// TODO: Calculate Jacobian and foam in another shader to support temporal
//       effects like foam persisting and bubbling out.

uniform float foam_jacobian_limit = 0.5;
uniform float foam_coverage = 0.1;
uniform float foam_mix_strength = 1.0;
uniform float foam_diffuse_strength = 1.0;
uniform vec4 foam_diffuse_color:source_color = vec4(0.91764706373215, 0.96862745285034, 1.0, 1.0);
uniform sampler2D foam_texture : hint_default_white;


group_uniforms Internal;
/******************************************************************************/
// These are intended to be updated during runtime. Setting values in the editor
// may not have the desired result.

// The vertex resolution of the mesh tiles the shader is applied to.
uniform float vertex_resolution = 256.0;


group_uniforms Internal.WaveDeformModifiers;
/******************************************************************************/
// Adjust the wave displacement maps as they are applied to the surface.
// This will be correctly accounted for by normals and whitecaps.
// Settings will only affect buoyancy if set through Ocean3D

// Simple planetary curve approximation.
// Decrease height of surface exponentially as distance from camera increases.
uniform float planetary_curve_strength = 0.000001;

// Decreases the height of the wave deformation as distance from the camera
// increases.
// This occurs after surface normals and whitecap coverage has been calculated.
uniform float amplitude_scale_min = 0.25;
uniform float amplitude_scale_max = 1.0;
uniform float amplitude_scale_fade_distance = 12000.0;


uniform sampler2D depth_texture : hint_depth_texture, filter_linear_mipmap;
uniform sampler2D screen_texture : hint_screen_texture, filter_linear_mipmap;

// Instance Uniforms
/******************************************************************************/
instance uniform float patch_size = 512.0;
instance uniform float min_lod_morph_distance;
instance uniform float max_lod_morph_distance;


// Varyings
/******************************************************************************/
varying vec3 world_vertex;
varying vec3 world_normal;
varying float jacobian_determinant;
varying float wave_height;
varying float foam_mix_factor;
varying float foam_specular_factor;


vec2 lod_morph(float morph_factor, vec2 grid_pos) {
	vec2 fracPart = fract(grid_pos.xy * vertex_resolution * 0.5) * 2.0 / vertex_resolution;
	return fracPart * patch_size * morph_factor;
}


vec3 HDR(vec3 color, float e) {
	return 1.0 - exp(-color * e);
}


// ── Screen-Space Reflections (ported from GodotSSRWater by Marcel Bankmann) ──

bool is_within_screen_boundaries(vec2 position) {
	return position.x > 0.0 && position.x < 1.0 && position.y > 0.0 && position.y < 1.0;
}

vec2 get_uv_from_view_position(vec3 position_view_space, mat4 proj_m) {
	vec4 position_clip_space = proj_m * vec4(position_view_space.xyz, 1.0);
	vec2 position_ndc = position_clip_space.xy / position_clip_space.w;
	return position_ndc.xy * 0.5 + 0.5;
}

vec3 get_view_position_from_uv(vec2 uv, float depth, mat4 inv_proj_m) {
	vec4 position_ndc = vec4((uv * 2.0) - 1.0, depth, 1.0);
	vec4 view_position = inv_proj_m * position_ndc;
	return view_position.xyz /= view_position.w;
}

float get_screen_border_alpha(vec2 screen_position) {
	vec2 shifted = 4.0 * screen_position * (1.0 - screen_position);
	float mask = shifted.x * shifted.y;
	float offset = mix(0.0, 0.5, (clamp(ssr_screen_border_fadeout, 0.75, 1.0) - 0.75) / 0.25);
	float alpha = clamp(smoothstep(0.0, 2.0 * ssr_screen_border_fadeout, mask) - offset, 0.0, 1.0);
	return abs(ssr_screen_border_fadeout) < EPSILON ? 1.0 : alpha;
}

vec4 get_ssr_color(vec3 surface_view_position, vec3 normal_view_space, vec3 view_view_space, mat4 proj_m, mat4 inv_proj_m, vec2 frag_coord) {
	if (ssr_max_travel < EPSILON) {
		return vec4(0);
	}

	vec3 view_dir = view_view_space * -1.0;
	vec3 reflect_dir = normalize(reflect(view_dir, normal_view_space));

	// Jitter ray start by 0-1 step to break staircase aliasing into noise
	float dither = fract(sin(dot(frag_coord, vec2(12.9898, 78.233))) * 43758.5453);
	vec3 current_pos = surface_view_position + reflect_dir * ssr_resolution * dither;
	vec3 prev_pos = current_pos;
	vec2 current_screen_pos = vec2(0.0);
	bool hit = false;
	float hit_travel = 0.0;

	// Coarse ray march — use textureLod to avoid undefined mipmap gradients in loop
	for (float travel = 0.0; travel < ssr_max_travel; travel += ssr_resolution) {
		prev_pos = current_pos;
		current_pos += reflect_dir * ssr_resolution;
		current_screen_pos = get_uv_from_view_position(current_pos, proj_m);

		if (!is_within_screen_boundaries(current_screen_pos)) break;

		float depth_raw = textureLod(depth_texture, current_screen_pos, 0.0).x;
		vec3 depth_view_pos = get_view_position_from_uv(current_screen_pos, depth_raw, inv_proj_m);
		float depth_diff = depth_view_pos.z - current_pos.z;

		if (depth_diff >= 0.0 && depth_diff < ssr_max_diff) {
			hit = true;
			hit_travel = travel;
			break;
		}
	}

	if (!hit) {
		return vec4(-1.0);
	}

	// Binary refinement: narrow down the exact hit point
	vec3 lo = prev_pos;
	vec3 hi = current_pos;
	for (int i = 0; i < 10; i++) {
		vec3 mid = (lo + hi) * 0.5;
		vec2 mid_uv = get_uv_from_view_position(mid, proj_m);
		float mid_depth = textureLod(depth_texture, mid_uv, 0.0).x;
		vec3 mid_view = get_view_position_from_uv(mid_uv, mid_depth, inv_proj_m);
		if (mid_view.z - mid.z >= 0.0) {
			hi = mid;
		} else {
			lo = mid;
		}
	}

	current_screen_pos = get_uv_from_view_position(hi, proj_m);
	vec3 resulting_color = textureLod(screen_texture, current_screen_pos, 0.0).rgb;
	float border_alpha = get_screen_border_alpha(current_screen_pos);
	// Fade out distant hits to avoid jarring pop-in at SSR range limit
	float distance_fade = 1.0 - smoothstep(ssr_max_travel * 0.5, ssr_max_travel, hit_travel);
	return vec4(resulting_color, border_alpha * distance_fade);
}


void vertex() {
	float linear_dist = length(VERTEX - CAMERA_POSITION_WORLD);
	
	// LOD Morph
	float morph_factor = (clamp(linear_dist, min_lod_morph_distance, max_lod_morph_distance) - min_lod_morph_distance) / (max_lod_morph_distance - min_lod_morph_distance);
	VERTEX.xz -= lod_morph(morph_factor, UV);
	
	// Domain Warp
	vec2 domain_warped_uv = domain_warp(VERTEX.xz, linear_dist);
	
	// Vertex Offset
	// Use the world vertex XZ coordinates as UV for simplicity
	vec3 displacement = get_displacement(domain_warped_uv);
	VERTEX += displacement;
	world_vertex = VERTEX;
	
	// Surface Normals & Jacobian
	vec4 nj = get_normals_jacobian(domain_warped_uv, displacement);
	NORMAL = nj.xyz * normal_factor;
	world_normal = NORMAL;  // capture before Godot transforms to view space
	jacobian_determinant = nj.w;
	
	// Wave Amplitude Distance Fade
	// Flattens the waves with increasing distance from camera. This is done
	// after surface normal calculations to retain normals in the distance.
	float amplitude_fade_range = clamp(linear_dist, 0.0, amplitude_scale_fade_distance) / amplitude_scale_fade_distance;
	VERTEX.y *= mix(amplitude_scale_max, amplitude_scale_min, amplitude_fade_range);
	
	// Planetary Curve
	// Take distance squared from camera to vertex, multiply by strength factor,
	// subtract from vertex Y.
	float curvation = planetary_curve_strength * (pow(abs(domain_warped_uv.x - CAMERA_POSITION_WORLD.x), 2.0) + pow(abs(domain_warped_uv.y - CAMERA_POSITION_WORLD.z), 2.0));
	VERTEX.y -= curvation;
}


void fragment() {
	float linear_dist = length(world_vertex - CAMERA_POSITION_WORLD);
	float fade_start = view_distance_max * view_fade_start;
	float distance_alpha = 1.0 - (clamp(linear_dist, fade_start, view_distance_max) - fade_start) / (view_distance_max - fade_start);

	// Calculate fragments Fresnel factor (declared here so it's in scope for PBR below)
	float fresnel_factor = clamp(pow(abs(1.0 - dot(NORMAL, normalize(VIEW))), fresnel_power), -1.0, 1.0);

	if (!FRONT_FACING) {
		// Viewed from below (underwater): semi-transparent surface showing what's above
		NORMAL = -NORMAL;
		float n_dot_v = max(dot(NORMAL, normalize(VIEW)), 0.0);
		// Blend between deep murk and brighter shallow color based on view angle
		// Looking straight up = more of what's above, glancing = more water color
		ALBEDO = mix(deep_color.rgb * 2.0, shallow_color.rgb, n_dot_v);
		// Let light through so sky/above-water objects are faintly visible
		ALPHA = distance_alpha * mix(0.4, 0.7, n_dot_v);
		ROUGHNESS = 0.15;
		METALLIC = 0.0;
		SPECULAR = 0.3;
		foam_mix_factor = 0.0;
		foam_specular_factor = 1.0;
	} else {
		// Viewed from above (normal path)
		float fresnel = fresnel_factor * fresnel_strength + fresnel_offset;

		// Get the linear depth between each ocean pixel and whatever is behind it.
		float depth = texture(depth_texture, SCREEN_UV).r;
		vec3 depth_view = get_view_position_from_uv(SCREEN_UV, depth, INV_PROJECTION_MATRIX);
		float linear_depth = -depth_view.z;

		// Compute water column depth — needed to attenuate refraction near shore.
		float water_surface_z = -(VIEW_MATRIX * vec4(world_vertex, 1.0)).z;
		float water_column_depth = linear_depth - water_surface_z;

		// Refraction — scale by water_column_depth (metres below surface).
		float shore_refraction_atten = clamp(water_column_depth / 1.5, 0.0, 1.0);
		float refraction_factor = clamp(water_column_depth * refraction_depth_factor, refraction_factor_min, refraction_factor_max) * shore_refraction_atten;
		vec2 refracted_uv = SCREEN_UV - world_normal.xz * refraction_factor;
		vec3 background_color = textureLod(screen_texture, refracted_uv, 0.0).rgb;

		// Depth-based color: blend refracted background toward deep_color as
		// water column deepens. Preserves object colors in shallow/medium water.
		float depth_blend = clamp(water_column_depth / opacity_depth, 0.0, 1.0);
		vec3 water_color = mix(background_color, deep_color.rgb, depth_blend * depth_blend);

		// Fresnel: blend between underwater refracted view and sky reflection
		vec3 fresnel_sky = HDR(fresnel_sky_color.rgb, fresnel_exposure);
		water_color = mix(water_color, fresnel_sky, fresnel);

		// SSR reflection — use softer fresnel (power 2) so reflections are
		// visible at moderate viewing angles, not just extreme glancing.
		vec3 surface_view_pos = get_view_position_from_uv(SCREEN_UV, FRAGCOORD.z, INV_PROJECTION_MATRIX);
		vec4 ssr_color = get_ssr_color(surface_view_pos, NORMAL, VIEW, PROJECTION_MATRIX, INV_PROJECTION_MATRIX, FRAGCOORD.xy);
		float ssr_blend = 0.0;
		if (ssr_color.x >= 0.0) {
			ssr_blend = ssr_mix_strength * ssr_color.a;
			water_color = mix(water_color, ssr_color.rgb, ssr_blend);
		}

		// Whitecap Rendering
		foam_mix_factor = clamp((-jacobian_determinant + foam_jacobian_limit) * foam_coverage, 0.0, 1.0);
		foam_mix_factor = (foam_mix_factor * foam_mix_factor) * foam_mix_strength;
		ALBEDO = mix(water_color, texture(foam_texture, world_vertex.xz * uv_scale).rgb, foam_mix_factor);
		foam_specular_factor = (1.0 - foam_mix_factor);

		// Shore fade for gradual sand-to-water transition. Safe because at the
		// shoreline water_column_depth ≈ 0, so refraction_factor ≈ 0 too —
		// alpha transparency can't cancel refraction where there is none.
		float shore_alpha = clamp(water_column_depth / shore_fade_depth, 0.0, 1.0);
		ALPHA = distance_alpha * shore_alpha;

		// Misc. PBR Settings (above-water only — underwater branch sets its own)
		ROUGHNESS = foam_mix_factor + 0.02;
		METALLIC = pbr_metallic_strength * foam_specular_factor;
		SPECULAR = pbr_specular_strength * foam_specular_factor * fresnel_factor + pbr_specular_offset;
	}

	wave_height = world_vertex.y;
}


void light() {
	vec3 half_vector = normalize(LIGHT + VIEW);

	// Ignore shadow attenuation — underwater terrain casts ugly hard shadows
	// onto the translucent surface. Ocean SSS diffuses light in reality anyway.
	vec3 atten = vec3(1.0);

	// Specular
	float spec = clamp(pow(dot(NORMAL, half_vector), specular_power), 0.0, 1.0) * specular_strength;
	SPECULAR_LIGHT += (LIGHT_COLOR * ALBEDO * atten / PI) * clamp(dot(NORMAL, half_vector), 0.0, 1.0) * foam_specular_factor;
	SPECULAR_LIGHT += LIGHT_COLOR * atten * spec * foam_specular_factor;

	// Sub Surface Scattering
	vec3 sss_sun_light = sss_color.rgb * atten;
	
	// SSS Wave Backlight
	float sss = sss_backlight_strength * max(0.0, wave_height + sss_backlight_depth) * pow(max(0.0, dot(-LIGHT, VIEW)), 4.0);
	sss *= pow(0.5 - 0.5 * dot(-LIGHT, half_vector), 3.0);
	sss *= sss_backlight_fov * pow(max(0.0, dot(VIEW, half_vector)) , 2.0);
	vec3 sss_result = sss * sss_sun_light;
	
	// SSS Upwelling Light
	sss_result += sss_upwelling * max(0.0, dot(LIGHT, half_vector)) * sss_sun_light;
	SPECULAR_LIGHT += sss_result * foam_specular_factor;
	
	// Foam Lighting
	DIFFUSE_LIGHT += foam_diffuse_strength * foam_mix_factor * foam_diffuse_color.rgb * atten;
}