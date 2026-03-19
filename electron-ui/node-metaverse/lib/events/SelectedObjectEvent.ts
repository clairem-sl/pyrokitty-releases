import type { GameObject } from '../classes/public/GameObject';
import type { UUID } from '../classes/UUID';

export class SelectedObjectEvent
{
    public object: GameObject;
    public cacheID: UUID;
}
