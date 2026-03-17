/**
 * Shared types and utilities for godot-bridge modules.
 */

export type SendFn = (msg: object) => void;

/** HUD attachment points (31-38 in avatar_lad.xml) should not be sent to Godot */
export function isHudAttachment(obj: any): boolean {
  const ap = obj.attachmentPoint ?? 0;
  return ap >= 31 && ap <= 38;
}

/** Magic texture UUIDs for SL water exclusion (invisiprims) — skip downloading these */
export const WATER_EXCLUSION_TEXTURES = new Set([
  'e97cf410-8e61-7005-ec06-629eba4cd1fb',  // IMG_ALPHA_GRAD
  '38b86f85-2575-52a9-a531-23108d8da837',  // IMG_ALPHA_GRAD_2D
]);

/**
 * Built-in SL texture UUIDs that should never be fetched from the asset server.
 * These are hardcoded in the viewer and handled purely in code.
 */
export const IMG_TRANSPARENT = '8dcd4a48-2d37-4909-9f78-f7a9eb4ef903';
export const IMG_INVISIBLE   = '3a367d1c-bef1-6d43-7595-e88c1e3aadb3';
export const IMG_WHITE        = '5748decc-f629-461c-9a36-a35a221fe21f';
export const IMG_DEFAULT      = 'd2114404-dd59-4a4d-8e6c-49359e91bbf0';

/** Faces with these textures should be fully transparent (not sent to Godot) */
export const TRANSPARENT_TEXTURES = new Set([IMG_TRANSPARENT, IMG_INVISIBLE]);

/** Faces with these textures use the face's own color — no texture fetch needed */
export const SOLID_COLOR_TEXTURES = new Set([IMG_WHITE, IMG_DEFAULT]);

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// ─── SL → Godot coordinate conversion ────────────────────
// SL: X=East, Y=North, Z=Up.  Godot: X=Right, Y=Up, Z=-Forward.

/** Convert SL position {x,y,z} to Godot [x, z, -y] */
export function slPos(p: { x: number; y: number; z: number }): [number, number, number] {
  return [p.x, p.z, -p.y];
}

/** Convert SL quaternion {x,y,z,w} to Godot [x, z, -y, w] */
export function slQuat(q: { x: number; y: number; z: number; w: number }): [number, number, number, number] {
  return [q.x, q.z, -q.y, q.w];
}

/** Convert SL scale {x,y,z} to Godot [x, z, y] */
export function slScale(s: { x: number; y: number; z: number }): [number, number, number] {
  return [s.x, s.z, s.y];
}

/** Convert SL velocity/acceleration array [x,y,z] to Godot [x, z, -y] */
export function slVec3(v: [number, number, number]): [number, number, number] {
  return [v[0], v[2], -v[1]];
}

/**
 * Magic bake texture UUIDs — when an attachment face uses one of these,
 * it means "substitute the avatar's actual baked texture for this channel."
 * Map key = magic UUID, value = AvatarAppearance TextureEntry face index (0-10).
 */
export const BAKE_MAGIC_UUIDS: ReadonlyMap<string, number> = new Map([
  ['5a9f4a74-30f2-821c-b88d-70499d3e7183', 0],  // HEAD
  ['ae2de45c-d252-50b8-5c6e-19f39ce79317', 1],  // UPPER
  ['24daea5f-0539-cfcf-047f-fbc40b2786ba', 2],  // LOWER
  ['52cc6bb6-2ee5-e632-d3ad-50197b1dcb8a', 3],  // EYES
  ['43529ce8-7faa-ad92-165a-bc4078371687', 4],  // SKIRT
  ['09aac1fb-6bce-0bee-7d44-caac6dbb6c63', 5],  // HAIR
  ['ff62763f-d60a-9855-890b-0c96f8f8cd98', 6],  // LEFTARM
  ['8e915e25-31d1-cc95-ae08-d58a47488251', 7],  // LEFTLEG
  ['9742065b-19b5-297c-858a-29711d539043', 8],  // AUX1
  ['03642e83-2bd1-4eb9-34b4-4c47ed586d2d', 9],  // AUX2
  ['edd51b77-fc10-ce7a-4b3d-011dfc349e4f', 10], // AUX3
]);

export const BAKE_CHANNEL_NAMES = [
  'HEAD', 'UPPER', 'LOWER', 'EYES', 'SKIRT', 'HAIR',
  'LEFTARM', 'LEFTLEG', 'AUX1', 'AUX2', 'AUX3',
];

/**
 * Maps bake channel index (0-10) to ETextureIndex face in AvatarAppearance TextureEntry.
 * These are NOT sequential — they're scattered across the ETextureIndex enum.
 */
export const BAKE_CHANNEL_TO_TE_FACE = [
  8,   // HEAD → TEX_HEAD_BAKED
  9,   // UPPER → TEX_UPPER_BAKED
  10,  // LOWER → TEX_LOWER_BAKED
  11,  // EYES → TEX_EYES_BAKED
  20,  // SKIRT → TEX_SKIRT_BAKED
  21,  // HAIR → TEX_HAIR_BAKED
  40,  // LEFTARM → TEX_LEFT_ARM_BAKED
  41,  // LEFTLEG → TEX_LEFT_LEG_BAKED
  42,  // AUX1 → TEX_AUX1_BAKED
  43,  // AUX2 → TEX_AUX2_BAKED
  44,  // AUX3 → TEX_AUX3_BAKED
];
