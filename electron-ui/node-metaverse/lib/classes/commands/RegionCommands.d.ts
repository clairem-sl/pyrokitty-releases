import type * as Long from 'long';
import type { Avatar } from '../public/Avatar';
import { GameObject } from '../public/GameObject';
import type { Parcel } from '../public/Parcel';
import { UUID } from '../UUID';
import { Vector3 } from '../Vector3';
import { CommandsBase } from './CommandsBase';
import type { AssetRegistry } from '../AssetRegistry';
export interface GetObjectsOptions {
    resolve?: boolean;
    forceReResolve?: boolean;
    includeTempObjects?: boolean;
    includeAvatars?: boolean;
    includeAttachments?: boolean;
}
export declare class RegionCommands extends CommandsBase {
    getRegionHandle(regionID: UUID): Promise<Long>;
    waitForHandshake(timeout?: number): Promise<void>;
    estateMessage(method: string, params: string[]): Promise<void>;
    restartRegion(secs: number): Promise<void>;
    simulatorMessage(message: string): Promise<void>;
    cancelRestart(): Promise<void>;
    getAvatarsInRegion(): Avatar[];
    deselectObjects(objects: GameObject[]): Promise<void>;
    countObjects(): number;
    getTerrainTextures(): UUID[];
    exportSettings(): string;
    getTerrain(): Promise<Buffer>;
    selectObjects(objects: GameObject[]): Promise<void>;
    getName(): string;
    resolveObject(object: GameObject, options: GetObjectsOptions): Promise<GameObject[]>;
    resolveObjects(objects: GameObject[], options: GetObjectsOptions): Promise<GameObject[]>;
    fetchObjectInventory(object: GameObject): Promise<void>;
    fetchObjectInventories(objects: GameObject[]): Promise<void>;
    fetchObjectCost(object: GameObject): Promise<void>;
    fetchObjectCosts(objects: GameObject[]): Promise<void>;
    buildObjectNew(obj: GameObject, map: AssetRegistry, callback: (map: AssetRegistry) => Promise<void>, costOnly?: boolean, skipMove?: boolean): Promise<GameObject | null>;
    getObjectByLocalID(id: number, resolve: boolean, waitFor?: number): Promise<GameObject>;
    getObjectByUUID(id: UUID, resolve: boolean, waitFor?: number): Promise<GameObject>;
    findObjectsByName(pattern: string | RegExp, minX?: number, maxX?: number, minY?: number, maxY?: number, minZ?: number, maxZ?: number): Promise<GameObject[]>;
    getParcelAt(x: number, y: number): Promise<Parcel>;
    getParcels(): Promise<Parcel[]>;
    getAllObjects(options: GetObjectsOptions): Promise<GameObject[]>;
    getObjectsInArea(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, resolve?: boolean): Promise<GameObject[]>;
    pruneObjects(checkList: GameObject[]): Promise<GameObject[]>;
    setPersist(persist: boolean): void;
    grabObject(localID: number | UUID, grabOffset?: Vector3, uvCoordinate?: Vector3, stCoordinate?: Vector3, faceIndex?: number, position?: Vector3, normal?: Vector3, binormal?: Vector3): Promise<void>;
    deGrabObject(localID: number | UUID, _grabOffset?: Vector3, uvCoordinate?: Vector3, stCoordinate?: Vector3, faceIndex?: number, position?: Vector3, normal?: Vector3, binormal?: Vector3): Promise<void>;
    dragGrabbedObject(localID: number | UUID, grabPosition: Vector3, grabOffset?: Vector3, uvCoordinate?: Vector3, stCoordinate?: Vector3, faceIndex?: number, position?: Vector3, normal?: Vector3, binormal?: Vector3): Promise<void>;
    touchObject(localID: number | UUID, grabOffset?: Vector3, uvCoordinate?: Vector3, stCoordinate?: Vector3, faceIndex?: number, position?: Vector3, normal?: Vector3, binormal?: Vector3): Promise<void>;
    rezPrims(count: number): Promise<GameObject[]>;
    private createPrims;
    private waitForObjectByLocalID;
    private waitForObjectByUUID;
    private buildPart;
    private gatherAssets;
}
//# sourceMappingURL=RegionCommands.d.ts.map