/**
 * Minesweeper tools: read board state, analyze for mines/safe cells, walk to cells.
 *
 * Sprite sheet mapping (4x4 grid, repeat=0.25):
 *   (-0.375, 0.125)  = covered/unrevealed  "."
 *   (-0.375, 0.375)  = empty (0 mines)     "0"
 *   (-0.375, -0.125) = 1 neighbor mine      "1"
 *   (-0.125, -0.125) = 2 neighbor mines     "2"
 *   (0.125, -0.125)  = 3 neighbor mines     "3"
 *   (0.375, -0.125)  = 4 neighbor mines     "4"
 *   (-0.125, 0.125)  = mine/bomb (game over sprite)  "X"
 *   (0.125, 0.375)   = mine (auto-revealed/flagged)  "X"
 *
 * Board layout:
 *   32 child prims named "row-colGroup" (e.g. "1-1", "1-2")
 *   colGroup 1 = cols 1-8, colGroup 2 = cols 9-16
 *   Each prim has 8 faces: face 7 = leftmost col, face 0 = rightmost col
 *
 * Coordinate mapping (root rotation quaternion 0.5,-0.5,-0.5,0.5):
 *   Cell spacing: 1.3125m, board spans ~21m in each direction
 *   Row N world X  = rootX - 9.845 + (N-1) * 1.3125
 *   Col N world Y  = rootY - 9.844 + (N-1) * 1.3125
 *   Board surface Z = rootZ + 0.672
 */

import type { ToolDef } from './session.js';

const CELL_SPACING = 1.3125;
// Offsets from root position to row 1/col 1 center
const ROW1_OFFSET = -9.845;  // root.x + ROW1_OFFSET = row 1 world X
const COL1_OFFSET = -9.844;  // root.y + COL1_OFFSET = col 1 world Y
const SURFACE_Y_OFFSET = 0.672; // root.z + this = board surface Z

/** Decode UV offset to short cell state string */
function decodeCell(offsetU: number, offsetV: number): string {
  const u = Math.round(offsetU * 1000) / 1000;
  const v = Math.round(offsetV * 1000) / 1000;

  if (u === -0.375 && v === 0.125) return '.';   // covered
  if (u === -0.375 && v === 0.375) return '0';   // empty
  if (u === -0.375 && v === -0.125) return '1';
  if (u === -0.125 && v === -0.125) return '2';
  if (u === 0.125 && v === -0.125) return '3';
  if (u === 0.375 && v === -0.125) return '4';
  if (u === -0.125 && v === 0.125) return 'X';   // mine (game-over sprite)
  if (u === 0.125 && v === 0.375) return 'X';    // mine (auto-revealed)
  return `?`;  // unknown sprite
}

/** Parse the board into a 16x16 string grid from readBoardState output */
function buildGrid(cells: Array<{ name: string; faces: Array<{ face: number; offsetU: number; offsetV: number }> }>): string[][] {
  const grid: string[][] = Array.from({ length: 16 }, () => Array(16).fill('?'));
  for (const prim of cells) {
    const match = prim.name.match(/^(\d+)-(\d+)$/);
    if (!match) continue;
    const row = parseInt(match[1], 10);
    const colGroup = parseInt(match[2], 10);
    const colStart = colGroup === 1 ? 1 : 9;
    for (const face of prim.faces) {
      const col = colStart + (7 - face.face);
      if (col >= 1 && col <= 16 && row >= 1 && row <= 16) {
        grid[row - 1][col - 1] = decodeCell(face.offsetU, face.offsetV);
      }
    }
  }
  return grid;
}

/** Format grid as readable text */
function formatGrid(grid: string[][]): string {
  const header = '    ' + Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(3)).join('');
  const rows = grid.map((row, i) =>
    `${String(i + 1).padStart(2)}: ${row.map(c => c.padStart(3)).join('')}`
  );
  return header + '\n' + rows.join('\n');
}

/** Get 8-neighbors of a cell (1-indexed) */
function neighbors(row: number, col: number): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr, c = col + dc;
      if (r >= 1 && r <= 16 && c >= 1 && c <= 16) result.push([r, c]);
    }
  }
  return result;
}

/**
 * Constraint propagation solver. Returns sets of definite mines and safe cells.
 * Iterates until no new deductions can be made.
 */
function solve(grid: string[][]): { mines: Set<string>; safe: Set<string> } {
  const mines = new Set<string>();
  const safe = new Set<string>();

  // Initialize known mines from board
  for (let r = 1; r <= 16; r++) {
    for (let c = 1; c <= 16; c++) {
      if (grid[r - 1][c - 1] === 'X') mines.add(`${r},${c}`);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 1; r <= 16; r++) {
      for (let c = 1; c <= 16; c++) {
        const val = grid[r - 1][c - 1];
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 0) continue; // skip non-number cells

        const nbrs = neighbors(r, c);
        let knownMines = 0;
        const covered: Array<[number, number]> = [];

        for (const [nr, nc] of nbrs) {
          const key = `${nr},${nc}`;
          const nval = grid[nr - 1][nc - 1];
          if (mines.has(key) || nval === 'X') {
            knownMines++;
          } else if (nval === '.' || nval === '?') {
            if (!safe.has(key)) covered.push([nr, nc]);
          }
        }

        if (covered.length === 0) continue;

        // All mines found → remaining covered are safe
        if (knownMines === num) {
          for (const [nr, nc] of covered) {
            const key = `${nr},${nc}`;
            if (!safe.has(key)) {
              safe.add(key);
              changed = true;
            }
          }
        }

        // Remaining covered must all be mines
        if (knownMines + covered.length === num) {
          for (const [nr, nc] of covered) {
            const key = `${nr},${nc}`;
            if (!mines.has(key)) {
              mines.add(key);
              changed = true;
            }
          }
        }
      }
    }
  }

  return { mines, safe };
}

/** Convert row,col (1-indexed) to world coordinates given root position */
function cellToWorld(row: number, col: number, rootX: number, rootY: number, rootZ: number): { x: number; y: number; z: number } {
  return {
    x: rootX + ROW1_OFFSET + (row - 1) * CELL_SPACING,
    y: rootY + COL1_OFFSET + (col - 1) * CELL_SPACING,
    z: rootZ + SURFACE_Y_OFFSET,
  };
}

export const minesweeperTools: ToolDef[] = [
  {
    name: 'sl_minesweeper_read_board',
    description: 'Read the full board state of an in-world Minesweeper game. Returns a decoded 16x16 grid with root position/rotation. Legend: .=covered, 0-4=neighbor count, X=mine. Coordinate mapping: WorldX = rootX - localZ (rows), WorldY = rootY - localX (cols).',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Root object local ID of the Minesweeper board' },
      },
      required: ['localId'],
    },
    handler: async (args, bot) => {
      try {
        const { root, cells } = await bot.readBoardState(args.localId as number);
        if (cells.length === 0) {
          return { content: [{ type: 'text', text: 'No grid cells found. Is this a Minesweeper board?' }], isError: true };
        }

        const rootInfo = `Root pos:(${root.position.x.toFixed(3)},${root.position.y.toFixed(3)},${root.position.z.toFixed(3)}) rot:(${root.rotation.x.toFixed(4)},${root.rotation.y.toFixed(4)},${root.rotation.z.toFixed(4)},${root.rotation.w.toFixed(4)})`;

        const grid = buildGrid(cells);
        const gridText = formatGrid(grid);

        const allCells = grid.flat();
        const covered = allCells.filter(c => c === '.').length;
        const mineCount = allCells.filter(c => c === 'X').length;
        const revealed = 256 - covered;
        const summary = `Revealed: ${revealed}/256  Covered: ${covered}  Mines: ${mineCount}`;

        return { content: [{ type: 'text', text: `${rootInfo}\n${summary}\n${gridText}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed to read board: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_minesweeper_analyze',
    description: 'Read the Minesweeper board and run constraint propagation to find definite mines and safe cells. Returns the board grid, lists of deduced mines and safe cells with world coordinates, and a suggested walk path through safe cells.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Root object local ID of the Minesweeper board' },
      },
      required: ['localId'],
    },
    handler: async (args, bot) => {
      try {
        const { root, cells } = await bot.readBoardState(args.localId as number);
        if (cells.length === 0) {
          return { content: [{ type: 'text', text: 'No grid cells found.' }], isError: true };
        }

        const grid = buildGrid(cells);
        const { mines, safe } = solve(grid);

        const allCells = grid.flat();
        const covered = allCells.filter(c => c === '.').length;
        const mineCount = allCells.filter(c => c === 'X').length;
        const revealed = 256 - covered;

        // Format mines list
        const knownMines = Array.from(mines).sort().map(key => {
          const [r, c] = key.split(',').map(Number);
          const onBoard = grid[r - 1][c - 1] === 'X';
          return `  (${r},${c})${onBoard ? ' [visible]' : ' [deduced]'}`;
        });

        // Format safe cells with world coordinates
        const rx = root.position.x, ry = root.position.y, rz = root.position.z;
        const safeCells = Array.from(safe).sort().map(key => {
          const [r, c] = key.split(',').map(Number);
          const world = cellToWorld(r, c, rx, ry, rz);
          return { row: r, col: c, x: world.x, y: world.y, z: world.z };
        });

        const safeLines = safeCells.map(s =>
          `  (${s.row},${s.col}) → world (${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)})`
        );

        // Build walk path: sort safe cells to minimize travel distance (greedy nearest-neighbor)
        let path = '';
        if (safeCells.length > 0) {
          // Get bot position
          const status = bot.getStatus();
          const botPos = status.position as { x: number; y: number; z: number } | undefined;
          let curX = botPos?.x ?? rx;
          let curY = botPos?.y ?? ry;

          const remaining = [...safeCells];
          const ordered: typeof safeCells = [];
          while (remaining.length > 0) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < remaining.length; i++) {
              const dx = remaining[i].x - curX;
              const dy = remaining[i].y - curY;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            const next = remaining.splice(bestIdx, 1)[0];
            ordered.push(next);
            curX = next.x;
            curY = next.y;
          }

          path = '\n\nSuggested walk order (nearest-neighbor from bot):\n' +
            ordered.map((s, i) =>
              `  ${i + 1}. (${s.row},${s.col}) → (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`
            ).join('\n');
        }

        const gridText = formatGrid(grid);
        const summary = `Revealed: ${revealed}/256  Covered: ${covered}  Mines visible: ${mineCount}  Mines deduced: ${mines.size}  Safe deduced: ${safe.size}`;

        const text = [
          summary,
          gridText,
          `\nDeduced mines (${mines.size}):`,
          ...knownMines,
          `\nSafe cells to reveal (${safe.size}):`,
          ...safeLines,
          path,
        ].join('\n');

        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed to analyze: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_minesweeper_walk_to_cell',
    description: 'Walk the bot to a specific Minesweeper cell by row and column number (1-16). Automatically calculates world coordinates from the board root position. Use sl_minesweeper_analyze first to find safe cells.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Root object local ID of the Minesweeper board' },
        row: { type: 'number', description: 'Row number (1-16)' },
        col: { type: 'number', description: 'Column number (1-16)' },
      },
      required: ['localId', 'row', 'col'],
    },
    handler: async (args, bot) => {
      try {
        const row = args.row as number;
        const col = args.col as number;
        if (row < 1 || row > 16 || col < 1 || col > 16) {
          return { content: [{ type: 'text', text: 'Row and col must be 1-16.' }], isError: true };
        }

        // Get root position for coordinate calculation
        const { root } = await bot.readBoardState(args.localId as number);
        const world = cellToWorld(row, col, root.position.x, root.position.y, root.position.z);

        const result = await bot.walkTo(world.x, world.y, world.z, 1.5, 30000);
        return { content: [{ type: 'text', text: `Walking to cell (${row},${col}) at world (${world.x.toFixed(1)}, ${world.y.toFixed(1)}, ${world.z.toFixed(1)}): ${result}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    },
  },
  {
    name: 'sl_minesweeper_walk_path',
    description: 'Walk the bot through a sequence of Minesweeper cells. Reads the board, walks to each cell in order, re-reads the board after, and returns the updated state. Provide cells as an array of [row,col] pairs.',
    inputSchema: {
      type: 'object',
      properties: {
        localId: { type: 'number', description: 'Root object local ID of the Minesweeper board' },
        cells: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          description: 'Array of [row, col] pairs to walk through in order',
        },
      },
      required: ['localId', 'cells'],
    },
    handler: async (args, bot) => {
      try {
        const cellList = args.cells as Array<[number, number]>;
        if (cellList.length === 0) {
          return { content: [{ type: 'text', text: 'No cells provided.' }], isError: true };
        }

        // Get root position
        const { root } = await bot.readBoardState(args.localId as number);
        const rx = root.position.x, ry = root.position.y, rz = root.position.z;

        const walkLog: string[] = [];
        for (const [row, col] of cellList) {
          if (row < 1 || row > 16 || col < 1 || col > 16) {
            walkLog.push(`(${row},${col}): skipped (out of range)`);
            continue;
          }
          const world = cellToWorld(row, col, rx, ry, rz);
          const result = await bot.walkTo(world.x, world.y, world.z, 1.5, 20000);
          walkLog.push(`(${row},${col}): ${result}`);
        }

        // Re-read board after walking
        const { cells: newCells } = await bot.readBoardState(args.localId as number);
        const newGrid = buildGrid(newCells);
        const allCells = newGrid.flat();
        const covered = allCells.filter(c => c === '.').length;
        const mineCount = allCells.filter(c => c === 'X').length;
        const revealed = 256 - covered;

        const text = [
          'Walk results:',
          ...walkLog,
          '',
          `Board after: Revealed ${revealed}/256  Covered: ${covered}  Mines: ${mineCount}`,
          formatGrid(newGrid),
        ].join('\n');

        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    },
  },
];
