// bc-compress.wgsl — BC1/BC3 GPU texture compression via compute shader.
// Port of Microsoft's FastBlockCompress algorithm.
//
// Each invocation compresses one 4x4 pixel block.
// Workgroup size: 8x8 = 64 blocks per workgroup.

// ─── Alpha Detection ──────────────────────────────────
// Each thread reads one pixel. If alpha < 250/255 ≈ 0.98, atomicOr a flag.

@group(0) @binding(0) var alpha_input_tex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> alpha_flag: atomic<u32>;

@compute @workgroup_size(8, 8, 1)
fn detect_alpha(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(alpha_input_tex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  let texel = textureLoad(alpha_input_tex, vec2<u32>(gid.x, gid.y), 0);
  if (texel.a < 0.98) {
    atomicOr(&alpha_flag, 1u);
  }
}

// ─── 2x Downsample (Mipmap Generation) ────────────────
// Each thread writes one output pixel by averaging a 2x2 block from source.

struct DownsampleParams {
  src_width: u32,
  src_height: u32,
};

@group(0) @binding(0) var<uniform> ds_params: DownsampleParams;
@group(0) @binding(1) var ds_input_tex: texture_2d<f32>;
@group(0) @binding(2) var ds_output_tex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn downsample_2x(@builtin(global_invocation_id) gid: vec3<u32>) {
  let out_dims = textureDimensions(ds_output_tex);
  if (gid.x >= out_dims.x || gid.y >= out_dims.y) {
    return;
  }

  let sx = gid.x * 2u;
  let sy = gid.y * 2u;

  // Clamp source reads to valid range
  let max_x = ds_params.src_width - 1u;
  let max_y = ds_params.src_height - 1u;

  let p00 = textureLoad(ds_input_tex, vec2<u32>(min(sx, max_x), min(sy, max_y)), 0);
  let p10 = textureLoad(ds_input_tex, vec2<u32>(min(sx + 1u, max_x), min(sy, max_y)), 0);
  let p01 = textureLoad(ds_input_tex, vec2<u32>(min(sx, max_x), min(sy + 1u, max_y)), 0);
  let p11 = textureLoad(ds_input_tex, vec2<u32>(min(sx + 1u, max_x), min(sy + 1u, max_y)), 0);

  let avg = (p00 + p10 + p01 + p11) * 0.25;

  textureStore(ds_output_tex, vec2<u32>(gid.x, gid.y), avg);
}

// ─── BC Compression ───────────────────────────────────

struct Params {
  width: u32,        // texture width in pixels
  height: u32,       // texture height in pixels
  blocks_wide: u32,  // ceil(width / 4)
  format: u32,       // 0=BC1, 1=BC3
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var input_tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> output_buf: array<u32>;

// ─── Helpers ─────────────────────────────────────────────

fn color_to_rgb565(r: f32, g: f32, b: f32) -> u32 {
  let ri = u32(clamp(r * 31.0 + 0.5, 0.0, 31.0));
  let gi = u32(clamp(g * 63.0 + 0.5, 0.0, 63.0));
  let bi = u32(clamp(b * 31.0 + 0.5, 0.0, 31.0));
  return (ri << 11u) | (gi << 5u) | bi;
}

fn rgb565_to_color(c: u32) -> vec3<f32> {
  let r = f32((c >> 11u) & 0x1Fu) / 31.0;
  let g = f32((c >> 5u) & 0x3Fu) / 63.0;
  let b = f32(c & 0x1Fu) / 31.0;
  return vec3<f32>(r, g, b);
}

// ─── BC1 Compression ────────────────────────────────────

@compute @workgroup_size(8, 8, 1)
fn compress_bc1(@builtin(global_invocation_id) gid: vec3<u32>) {
  let block_x = gid.x;
  let block_y = gid.y;

  if (block_x >= params.blocks_wide || block_y >= (params.height + 3u) / 4u) {
    return;
  }

  // Read 16 pixels for this 4x4 block
  var pixels: array<vec3<f32>, 16>;
  var min_color = vec3<f32>(1.0, 1.0, 1.0);
  var max_color = vec3<f32>(0.0, 0.0, 0.0);

  for (var py = 0u; py < 4u; py++) {
    for (var px = 0u; px < 4u; px++) {
      let sx = min(block_x * 4u + px, params.width - 1u);
      let sy = min(block_y * 4u + py, params.height - 1u);
      let texel = textureLoad(input_tex, vec2<u32>(sx, sy), 0);
      let idx = py * 4u + px;
      pixels[idx] = texel.rgb;
      min_color = min(min_color, texel.rgb);
      max_color = max(max_color, texel.rgb);
    }
  }

  // Inset bounding box by 1/16 of its range (improves quality)
  let inset = (max_color - min_color) / 16.0;
  let c0 = clamp(max_color - inset, vec3<f32>(0.0), vec3<f32>(1.0));
  let c1 = clamp(min_color + inset, vec3<f32>(0.0), vec3<f32>(1.0));

  var ep0 = color_to_rgb565(c0.r, c0.g, c0.b);
  var ep1 = color_to_rgb565(c1.r, c1.g, c1.b);

  // Ensure ep0 > ep1 for 4-color mode (no alpha)
  if (ep0 < ep1) {
    let tmp = ep0;
    ep0 = ep1;
    ep1 = tmp;
  }
  // If equal, nudge apart
  if (ep0 == ep1) {
    ep0 = min(ep0 + 1u, 0xFFFFu);
  }

  // Reconstruct palette colors for index computation
  let palette0 = rgb565_to_color(ep0);
  let palette1 = rgb565_to_color(ep1);
  let palette2 = (2.0 * palette0 + palette1) / 3.0;
  let palette3 = (palette0 + 2.0 * palette1) / 3.0;

  // Compute 2-bit index per pixel (closest palette entry)
  var indices = 0u;
  for (var i = 0u; i < 16u; i++) {
    let p = pixels[i];
    let d0 = dot(p - palette0, p - palette0);
    let d1 = dot(p - palette1, p - palette1);
    let d2 = dot(p - palette2, p - palette2);
    let d3 = dot(p - palette3, p - palette3);

    var best = 0u;
    var best_d = d0;
    if (d1 < best_d) { best = 1u; best_d = d1; }
    if (d2 < best_d) { best = 2u; best_d = d2; }
    if (d3 < best_d) { best = 3u; }

    indices |= (best << (i * 2u));
  }

  // Write 2 u32s (8 bytes) for BC1 block
  let block_idx = (block_y * params.blocks_wide + block_x) * 2u;
  output_buf[block_idx]     = ep0 | (ep1 << 16u);
  output_buf[block_idx + 1u] = indices;
}

// ─── BC3 Compression ────────────────────────────────────

@compute @workgroup_size(8, 8, 1)
fn compress_bc3(@builtin(global_invocation_id) gid: vec3<u32>) {
  let block_x = gid.x;
  let block_y = gid.y;

  if (block_x >= params.blocks_wide || block_y >= (params.height + 3u) / 4u) {
    return;
  }

  // Read 16 pixels
  var pixels: array<vec3<f32>, 16>;
  var alphas: array<f32, 16>;
  var min_color = vec3<f32>(1.0, 1.0, 1.0);
  var max_color = vec3<f32>(0.0, 0.0, 0.0);
  var min_alpha = 1.0f;
  var max_alpha = 0.0f;

  for (var py = 0u; py < 4u; py++) {
    for (var px = 0u; px < 4u; px++) {
      let sx = min(block_x * 4u + px, params.width - 1u);
      let sy = min(block_y * 4u + py, params.height - 1u);
      let texel = textureLoad(input_tex, vec2<u32>(sx, sy), 0);
      let idx = py * 4u + px;
      pixels[idx] = texel.rgb;
      alphas[idx] = texel.a;
      min_color = min(min_color, texel.rgb);
      max_color = max(max_color, texel.rgb);
      min_alpha = min(min_alpha, texel.a);
      max_alpha = max(max_alpha, texel.a);
    }
  }

  // ── Alpha block (8 bytes = 2 u32) ──

  var alpha0 = u32(clamp(max_alpha * 255.0 + 0.5, 0.0, 255.0));
  var alpha1 = u32(clamp(min_alpha * 255.0 + 0.5, 0.0, 255.0));

  // Ensure alpha0 > alpha1 for 8-interpolated-values mode
  if (alpha0 == alpha1) {
    alpha0 = min(alpha0 + 1u, 255u);
  }
  if (alpha0 < alpha1) {
    let tmp = alpha0;
    alpha0 = alpha1;
    alpha1 = tmp;
  }

  // Compute 3-bit alpha index per pixel
  // 8 interpolated values: a0, a1, 6/7*a0+1/7*a1, 5/7*a0+2/7*a1, ... 1/7*a0+6/7*a1
  var alpha_indices = 0u;         // low 32 bits (pixels 0..9, partial 10)
  var alpha_indices_hi = 0u;      // high 16 bits (pixels 10..15)

  let a0f = f32(alpha0) / 255.0;
  let a1f = f32(alpha1) / 255.0;

  for (var i = 0u; i < 16u; i++) {
    let a = alphas[i];
    var best = 0u;
    var best_d = abs(a - a0f);

    let d1 = abs(a - a1f);
    if (d1 < best_d) { best = 1u; best_d = d1; }

    // Interpolated values 2-7
    for (var j = 1u; j <= 6u; j++) {
      let interp = (f32(7u - j) * a0f + f32(j) * a1f) / 7.0;
      let d = abs(a - interp);
      if (d < best_d) { best = j + 1u; best_d = d; }
    }

    let bit_pos = i * 3u;
    if (bit_pos < 32u) {
      alpha_indices |= (best << bit_pos);
      // Handle straddling the 32-bit boundary
      if (bit_pos + 3u > 32u) {
        alpha_indices_hi |= (best >> (32u - bit_pos));
      }
    } else {
      alpha_indices_hi |= (best << (bit_pos - 32u));
    }
  }

  // Pack alpha block: [alpha0, alpha1, 48 bits of indices]
  let alpha_word0 = alpha0 | (alpha1 << 8u) | ((alpha_indices & 0xFFFFu) << 16u);
  let alpha_word1 = (alpha_indices >> 16u) | (alpha_indices_hi << 16u);

  // ── Color block (same as BC1) ──

  let inset = (max_color - min_color) / 16.0;
  let c0 = clamp(max_color - inset, vec3<f32>(0.0), vec3<f32>(1.0));
  let c1 = clamp(min_color + inset, vec3<f32>(0.0), vec3<f32>(1.0));

  var ep0 = color_to_rgb565(c0.r, c0.g, c0.b);
  var ep1 = color_to_rgb565(c1.r, c1.g, c1.b);

  if (ep0 < ep1) {
    let tmp = ep0;
    ep0 = ep1;
    ep1 = tmp;
  }
  if (ep0 == ep1) {
    ep0 = min(ep0 + 1u, 0xFFFFu);
  }

  let palette0 = rgb565_to_color(ep0);
  let palette1 = rgb565_to_color(ep1);
  let palette2 = (2.0 * palette0 + palette1) / 3.0;
  let palette3 = (palette0 + 2.0 * palette1) / 3.0;

  var indices = 0u;
  for (var i = 0u; i < 16u; i++) {
    let p = pixels[i];
    let d0 = dot(p - palette0, p - palette0);
    let d1 = dot(p - palette1, p - palette1);
    let d2 = dot(p - palette2, p - palette2);
    let d3 = dot(p - palette3, p - palette3);

    var best = 0u;
    var best_d = d0;
    if (d1 < best_d) { best = 1u; best_d = d1; }
    if (d2 < best_d) { best = 2u; best_d = d2; }
    if (d3 < best_d) { best = 3u; }

    indices |= (best << (i * 2u));
  }

  // Write 4 u32s (16 bytes) for BC3 block: alpha (8B) + color (8B)
  let block_idx = (block_y * params.blocks_wide + block_x) * 4u;
  output_buf[block_idx]     = alpha_word0;
  output_buf[block_idx + 1u] = alpha_word1;
  output_buf[block_idx + 2u] = ep0 | (ep1 << 16u);
  output_buf[block_idx + 3u] = indices;
}
