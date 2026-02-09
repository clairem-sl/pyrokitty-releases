/**
 * Chat tools: say, send IM, send group message, get recent IMs, get recent nearby chat
 */

import type { ToolDef } from './session.js';
import type { BotManager } from '../bot-manager.js';

export const chatTools: ToolDef[] = [
  {
    name: 'sl_say',
    description: 'Send nearby chat message in-world. Other avatars in the region will see it.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message text to say' },
        type: { type: 'string', description: 'Chat type: "whisper", "normal", or "shout" (default: normal)' },
        channel: { type: 'number', description: 'Chat channel (default: 0 = public)' },
      },
      required: ['message'],
    },
    handler: async (args, bot) => {
      const type = (args.type as 'whisper' | 'normal' | 'shout') || 'normal';
      const channel = (args.channel as number) || 0;
      await bot.say(args.message as string, type, channel);
      return { content: [{ type: 'text', text: `Said "${args.message}" (${type})` }] };
    },
  },
  {
    name: 'sl_send_im',
    description: 'Send an instant message (IM) to another avatar by their UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        avatarId: { type: 'string', description: 'Target avatar UUID' },
        message: { type: 'string', description: 'Message text' },
      },
      required: ['avatarId', 'message'],
    },
    handler: async (args, bot) => {
      await bot.sendIM(args.avatarId as string, args.message as string);
      return { content: [{ type: 'text', text: `IM sent to ${args.avatarId}` }] };
    },
  },
  {
    name: 'sl_send_group_message',
    description: 'Send a message to a group chat by group UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Group UUID' },
        message: { type: 'string', description: 'Message text' },
      },
      required: ['groupId', 'message'],
    },
    handler: async (args, bot) => {
      await bot.sendGroupMessage(args.groupId as string, args.message as string);
      return { content: [{ type: 'text', text: `Group message sent to ${args.groupId}` }] };
    },
  },
  {
    name: 'sl_get_recent_ims',
    description: 'Get recent incoming instant messages received by the bot (up to 50 most recent).',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      const ims = bot.getRecentIMs();
      if (ims.length === 0) {
        return { content: [{ type: 'text', text: 'No recent IMs.' }] };
      }
      const formatted = ims.map(im =>
        `[${new Date(im.timestamp).toLocaleTimeString()}] ${im.fromName}: ${im.message}`
      ).join('\n');
      return { content: [{ type: 'text', text: formatted }] };
    },
  },
  {
    name: 'sl_get_recent_chat',
    description: 'Get recent nearby (local) chat messages from other avatars (up to 100 most recent).',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      const msgs = bot.getRecentChat();
      if (msgs.length === 0) {
        return { content: [{ type: 'text', text: 'No recent nearby chat.' }] };
      }
      const formatted = msgs.map(m =>
        `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.fromName} (${m.chatType}): ${m.message}`
      ).join('\n');
      return { content: [{ type: 'text', text: formatted }] };
    },
  },
];
