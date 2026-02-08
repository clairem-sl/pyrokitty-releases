/**
 * Navigation tools: teleport, get nearby avatars, get region info
 */

import type { ToolDef } from './session.js';
import type { BotManager } from '../bot-manager.js';

export const navigationTools: ToolDef[] = [
  {
    name: 'sl_teleport',
    description: 'Teleport the bot to a named region with optional coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        regionName: { type: 'string', description: 'Region name to teleport to' },
        x: { type: 'number', description: 'X coordinate (default: 128)' },
        y: { type: 'number', description: 'Y coordinate (default: 128)' },
        z: { type: 'number', description: 'Z coordinate (default: 30)' },
      },
      required: ['regionName'],
    },
    handler: async (args, bot) => {
      try {
        const result = await bot.teleport(
          args.regionName as string,
          args.x as number | undefined,
          args.y as number | undefined,
          args.z as number | undefined,
        );
        return { content: [{ type: 'text', text: result }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Teleport failed: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_get_nearby_avatars',
    description: 'List avatars currently in the same region, with their positions.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      const avatars = await bot.getNearbyAvatars();
      if (avatars.length === 0) {
        return { content: [{ type: 'text', text: 'No nearby avatars.' }] };
      }
      const lines = avatars.map(a => {
        const nameDisplay = a.displayName
          ? `${a.displayName} (${a.name})`
          : a.name;
        return `${nameDisplay} (${a.id}) at (${a.position.x.toFixed(1)}, ${a.position.y.toFixed(1)}, ${a.position.z.toFixed(1)})`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  },
  {
    name: 'sl_get_region_info',
    description: 'Get current region name, grid coordinates, and agent position.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      const info = bot.getRegionInfo();
      if (!info) {
        return { content: [{ type: 'text', text: 'Not connected to a region.' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
    },
  },
];
