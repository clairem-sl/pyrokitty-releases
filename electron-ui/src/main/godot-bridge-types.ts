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
  'e97cf410-8e61-7005-ec06-629eba4cd1fb',
  '38b86f85-2575-52a9-a531-23108d8da837',
]);

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

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
  41,  // LEFTARM → TEX_LEFT_ARM_BAKED
  42,  // LEFTLEG → TEX_LEFT_LEG_BAKED
  43,  // AUX1 → TEX_AUX1_BAKED
  44,  // AUX2 → TEX_AUX2_BAKED
  45,  // AUX3 → TEX_AUX3_BAKED
];
