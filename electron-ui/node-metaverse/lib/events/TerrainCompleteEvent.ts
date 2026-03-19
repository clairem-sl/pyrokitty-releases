import type { UUID } from '../classes/UUID';

export class TerrainCompleteEvent
{
    public cacheID: UUID;
    public gridX: number;
    public gridY: number;
    public waterHeight: number;
    public terrain: number[][];
}
