import type { UUID } from '../classes/UUID';
import type { ILandBlock } from '../classes/interfaces/ILandBlock';

export class ParcelOverlayCompleteEvent
{
    public cacheID: UUID;
    public gridX: number;
    public gridY: number;
    public parcelOverlay: ILandBlock[];
}
