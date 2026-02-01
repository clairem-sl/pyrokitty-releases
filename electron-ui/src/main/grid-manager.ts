import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Grid } from '../shared/types';

function getGridsFilePath(): string {
  return path.join(app.getAppPath(), 'data', 'grids.json');
}

export class GridManager {
  private grids: Grid[] = [];

  async initialize(): Promise<void> {
    this.loadGrids();
    console.log(`Loaded ${this.grids.length} grids`);
  }

  private loadGrids(): void {
    try {
      const gridsFile = getGridsFilePath();
      if (fs.existsSync(gridsFile)) {
        const data = fs.readFileSync(gridsFile, 'utf-8');
        this.grids = JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading grids:', error);
      this.grids = [];
    }
  }

  getAllGrids(): Grid[] {
    return this.grids;
  }

  getGrid(id: string): Grid | undefined {
    return this.grids.find(g => g.id === id);
  }
}

export const gridManager = new GridManager();
