/**
 * Shared types and utilities for godot-bridge modules.
 */

export type SendFn = (msg: object) => void;

/** HUD attachment points (34-41 in AttachmentPoint enum) should not be sent to Godot */
export function isHudAttachment(obj: any): boolean {
  const ap = obj.attachmentPoint ?? 0;
  return ap >= 34 && ap <= 41;
}

/** Magic texture UUIDs for SL water exclusion (invisiprims) — skip downloading these */
export const WATER_EXCLUSION_TEXTURES = new Set([
  'e97cf410-8e61-7005-ec06-629eba4cd1fb',
  '38b86f85-2575-52a9-a531-23108d8da837',
]);

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
