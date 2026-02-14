/**
 * Social tools: friends, groups, avatar lookup, balance
 */

import type { ToolDef } from './session.js';
import type { BotManager } from '../bot-manager.js';

export const socialTools: ToolDef[] = [
  {
    name: 'sl_get_friends',
    description: 'List friends with online status.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      const friends = bot.getFriends();
      if (friends.length === 0) {
        return { content: [{ type: 'text', text: 'No friends in list.' }] };
      }
      const lines = friends.map(f =>
        `${f.name || '(resolving...)'} (${f.id}) ${f.online ? '🟢 online' : '⚫ offline'}`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  },
  {
    name: 'sl_get_groups',
    description: 'List groups the bot is a member of.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      const groups = bot.getGroups();
      if (groups.length === 0) {
        return { content: [{ type: 'text', text: 'No groups.' }] };
      }
      const lines = groups.map(g => `${g.name} (${g.id})`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  },
  {
    name: 'sl_avatar_name_to_key',
    description: 'Look up an avatar UUID from their name (e.g. "John Doe" or "john.doe").',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Avatar name to look up' },
      },
      required: ['name'],
    },
    handler: async (args, bot) => {
      try {
        const uuid = await bot.avatarName2Key(args.name as string);
        return { content: [{ type: 'text', text: uuid }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Lookup failed: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_avatar_key_to_name',
    description: 'Look up an avatar name from their UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'Avatar UUID to look up' },
      },
      required: ['uuid'],
    },
    handler: async (args, bot) => {
      try {
        const name = await bot.avatarKey2Name(args.uuid as string);
        return { content: [{ type: 'text', text: name }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Lookup failed: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_get_avatar_state',
    description: 'Get an avatar\'s state (sitting/standing) and what they\'re sitting on, by UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        avatarId: { type: 'string', description: 'Target avatar UUID' },
      },
      required: ['avatarId'],
    },
    handler: async (args, bot) => {
      try {
        const state = await bot.getAvatarState(args.avatarId as string);
        if (!state) {
          return { content: [{ type: 'text', text: 'Avatar not found in region.' }], isError: true };
        }
        const pos = `(${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)})`;
        if (state.sitting) {
          const onObj = state.sittingOnName ? ` on "${state.sittingOnName}" (localId ${state.sittingOnLocalId})` : ` on object localId ${state.sittingOnLocalId}`;
          return { content: [{ type: 'text', text: `Sitting${onObj} at ${pos}` }] };
        }
        return { content: [{ type: 'text', text: `Standing at ${pos}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_get_balance',
    description: 'Get the bot\'s L$ (Linden Dollar) balance.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      try {
        const balance = await bot.getBalance();
        return { content: [{ type: 'text', text: `L$${balance}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed to get balance: ${err.message}` }], isError: true };
      }
    },
  },
];
