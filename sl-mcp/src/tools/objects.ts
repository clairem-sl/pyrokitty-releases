/**
 * Object tools: rez, name, describe, move, scale, find, touch, delete
 */

import type { ToolDef } from './session.js';
import type { BotManager } from '../bot-manager.js';

export const objectTools: ToolDef[] = [
  {
    name: 'sl_rez_prim',
    description: 'Rez one or more new prims near the bot. Returns their local IDs and UUIDs.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of prims to rez (default: 1)' },
      },
    },
    handler: async (args, bot) => {
      const count = (args.count as number) || 1;
      const objects = await bot.rezPrims(count);
      const info = objects.map(o => ({
        localId: o.localId,
        uuid: o.uuid,
        position: o.position,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
    },
  },
  {
    name: 'sl_set_object_name',
    description: 'Set the name of an in-world object by its local ID.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Object local ID' },
        name: { type: 'string', description: 'New name for the object' },
      },
      required: ['localId', 'name'],
    },
    handler: async (args, bot) => {
      await bot.setObjectName(args.localId as number, args.name as string);
      return { content: [{ type: 'text', text: `Renamed object ${args.localId} to "${args.name}"` }] };
    },
  },
  {
    name: 'sl_set_object_description',
    description: 'Set the description of an in-world object by its local ID.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Object local ID' },
        description: { type: 'string', description: 'New description for the object' },
      },
      required: ['localId', 'description'],
    },
    handler: async (args, bot) => {
      await bot.setObjectDescription(args.localId as number, args.description as string);
      return { content: [{ type: 'text', text: `Set description on object ${args.localId}` }] };
    },
  },
  {
    name: 'sl_set_object_position',
    description: 'Move an in-world object to a new position.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Object local ID' },
        x: { type: 'number', description: 'X position' },
        y: { type: 'number', description: 'Y position' },
        z: { type: 'number', description: 'Z position' },
      },
      required: ['localId', 'x', 'y', 'z'],
    },
    handler: async (args, bot) => {
      await bot.setObjectPosition(args.localId as number, args.x as number, args.y as number, args.z as number);
      return { content: [{ type: 'text', text: `Moved object ${args.localId} to (${args.x}, ${args.y}, ${args.z})` }] };
    },
  },
  {
    name: 'sl_set_object_scale',
    description: 'Set the scale (size) of an in-world object.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Object local ID' },
        x: { type: 'number', description: 'X scale' },
        y: { type: 'number', description: 'Y scale' },
        z: { type: 'number', description: 'Z scale' },
      },
      required: ['localId', 'x', 'y', 'z'],
    },
    handler: async (args, bot) => {
      await bot.setObjectScale(args.localId as number, args.x as number, args.y as number, args.z as number);
      return { content: [{ type: 'text', text: `Scaled object ${args.localId} to (${args.x}, ${args.y}, ${args.z})` }] };
    },
  },
  {
    name: 'sl_find_objects',
    description: 'Find in-world objects by name. Uses micromatch glob patterns (case insensitive). Use "*keyword*" to match names containing a word, "exact name" for exact match. Examples: "*Minesweeper*", "*chair*", "Object".',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match object names (e.g. "*keyword*")' },
      },
      required: ['pattern'],
    },
    handler: async (args, bot) => {
      const objects = await bot.findObjectsByName(args.pattern as string);
      if (objects.length === 0) {
        return { content: [{ type: 'text', text: 'No objects found matching that pattern.' }] };
      }
      const info = objects.map(o => ({
        localId: o.localId,
        uuid: o.uuid,
        name: o.name,
        position: o.position,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
    },
  },
  {
    name: 'sl_get_object_children',
    description: 'Get the child prims of a linkset by root object local ID. Returns each child\'s localId, name, and position (relative to root).',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Root object local ID' },
      },
      required: ['localId'],
    },
    handler: async (args, bot) => {
      try {
        const children = await bot.getObjectChildren(args.localId as number);
        if (children.length === 0) {
          return { content: [{ type: 'text', text: 'No child prims found (single prim object).' }] };
        }
        return { content: [{ type: 'text', text: `${children.length} children:\n${JSON.stringify(children, null, 2)}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed to get children: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_get_object_textures',
    description: 'Get texture information for each face of a prim. Returns texture UUIDs, offsets, repeat, and rotation per face.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Object local ID' },
      },
      required: ['localId'],
    },
    handler: async (args, bot) => {
      try {
        const textures = await bot.getObjectTextures(args.localId as number);
        return { content: [{ type: 'text', text: JSON.stringify(textures, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed to get textures: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_get_object_inventory',
    description: 'List the contents (task inventory) of an in-world object by its local ID.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Object local ID' },
      },
      required: ['localId'],
    },
    handler: async (args, bot) => {
      try {
        const items = await bot.getObjectInventory(args.localId as number);
        if (items.length === 0) {
          return { content: [{ type: 'text', text: 'Object inventory is empty.' }] };
        }
        const lines = items.map(i => `${i.name} (${i.type}) - ${i.description || 'no description'}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed to get inventory: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_touch_object',
    description: 'Touch (click) an in-world object by its local ID.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Object local ID' },
      },
      required: ['localId'],
    },
    handler: async (args, bot) => {
      await bot.touchObject(args.localId as number);
      return { content: [{ type: 'text', text: `Touched object ${args.localId}` }] };
    },
  },
  {
    name: 'sl_delete_object',
    description: 'Delete (derez) an in-world object by its local ID. Object must be owned by the bot.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Object local ID' },
      },
      required: ['localId'],
    },
    handler: async (args, bot) => {
      await bot.deleteObject(args.localId as number);
      return { content: [{ type: 'text', text: `Deleted object ${args.localId}` }] };
    },
  },
];
