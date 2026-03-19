import type { UUID } from '../classes/UUID';
import type { RegionEnvironment } from '../classes/public/RegionEnvironment';

export class RegionEnvironmentEvent
{
    public cacheID: UUID;
    public gridX: number;
    public gridY: number;
    public environment: RegionEnvironment;
}
