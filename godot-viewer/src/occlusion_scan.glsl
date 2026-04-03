#[compute]
#version 450

// Scans the ID-buffer pick viewport texture and flags which numeric object IDs
// are visible. Each pixel encodes a 24-bit ID as RGB. The storage buffer has
// one uint per possible ID; any non-zero entry means "visible in this frame".

layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

layout(rgba8, set = 0, binding = 0) restrict readonly uniform image2D id_image;

layout(set = 0, binding = 1, std430) restrict buffer VisibilityBuffer {
	uint visible[];
};

void main() {
	ivec2 pos = ivec2(gl_GlobalInvocationID.xy);
	ivec2 size = imageSize(id_image);
	if (pos.x >= size.x || pos.y >= size.y) return;

	vec4 c = imageLoad(id_image, pos);
	uint id = (uint(round(c.r * 255.0)) << 16)
	         | (uint(round(c.g * 255.0)) << 8)
	         |  uint(round(c.b * 255.0));
	if (id != 0u) {
		visible[id] = 1u;
	}
}
