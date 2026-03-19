import type { GameObject } from '../classes/public/GameObject';
import type { UUID } from '../classes/UUID';

export class ObjectResolvedEvent
{
    public object: GameObject;
    public cacheID: UUID;
}
