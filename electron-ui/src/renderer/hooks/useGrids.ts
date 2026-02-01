import { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { Grid, IPC_CHANNELS } from '../../shared/types';

export function useGrids() {
  const [grids, setGrids] = useState<Grid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_GRIDS);
        setGrids(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load grids');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const getGrid = (id: string) => grids.find((g) => g.id === id);

  return { grids, loading, error, getGrid };
}
