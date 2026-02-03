import type { GameObject } from './public/GameObject';
import type { Region } from './Region';
import type { GetObjectsOptions } from './commands/RegionCommands';
export declare class ObjectResolver {
    private readonly resolveQueue;
    private readonly getCostsQueue;
    private region?;
    constructor(region?: Region);
    resolveObjects(objects: GameObject[], options: GetObjectsOptions): Promise<GameObject[]>;
    getInventory(object: GameObject): Promise<void>;
    getInventories(objects: GameObject[]): Promise<void>;
    getCosts(objects: GameObject[]): Promise<void>;
    shutdown(): void;
    private scanObject;
    private resolveInternal;
    private getCostsInternal;
    private waitForResolve;
}
//# sourceMappingURL=ObjectResolver.d.ts.map