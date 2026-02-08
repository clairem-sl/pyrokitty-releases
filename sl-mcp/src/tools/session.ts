/**
 * Session tools: login, logout, status
 */

import type { BotManager } from '../bot-manager.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, bot: BotManager) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

export const sessionTools: ToolDef[] = [
  {
    name: 'sl_login',
    description: 'Login bot to Second Life. Returns connection status and region name.',
    inputSchema: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'Avatar first name' },
        lastName: { type: 'string', description: 'Avatar last name (use "Resident" for single-name accounts)' },
        password: { type: 'string', description: 'Account password' },
        loginUrl: { type: 'string', description: 'Grid login URL (default: Second Life main grid)' },
        startLocation: { type: 'string', description: 'Start location: "home", "last", or "uri:RegionName&x&y&z"' },
      },
      required: ['firstName', 'lastName', 'password'],
    },
    handler: async (args, bot) => {
      try {
        const result = await bot.login({
          firstName: args.firstName as string,
          lastName: args.lastName as string,
          password: args.password as string,
          loginUrl: args.loginUrl as string | undefined,
          startLocation: args.startLocation as string | undefined,
        });
        return { content: [{ type: 'text', text: result }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Login failed: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_logout',
    description: 'Disconnect bot from Second Life.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      await bot.logout();
      return { content: [{ type: 'text', text: 'Logged out.' }] };
    },
  },
  {
    name: 'sl_status',
    description: 'Get bot connection state, avatar name/UUID, current region, and position.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, bot) => {
      const status = bot.getStatus();
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    },
  },
];
