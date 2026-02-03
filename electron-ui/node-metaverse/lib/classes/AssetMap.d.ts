import { UUID } from './UUID';
import type { InventoryItem } from './InventoryItem';
import type { AssetType } from '../enums/AssetType';
export interface AssetData<T = InventoryItem> {
    name?: string;
    description?: string;
    assetType?: AssetType;
    item?: T;
}
export declare class AssetMap<T = InventoryItem> {
    private readonly map;
    private readonly pending;
    get(uuid: UUID | string): AssetData<T> | undefined;
    request(uuid: UUID | string, metadata?: AssetData<T>): void;
    delete(uuid: UUID | string): void;
    getFetchList(): string[];
    setItem(uuid: UUID | string, item: T): void;
    doneFetch(list: string[]): void;
}
//# sourceMappingURL=AssetMap.d.ts.map