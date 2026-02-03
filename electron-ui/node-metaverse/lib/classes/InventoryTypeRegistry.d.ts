import { InventoryType } from '../enums/InventoryType';
import { AssetType } from '../enums/AssetType';
export declare class RegisteredInventoryType {
    type: InventoryType;
    typeName: string;
    humanName: string;
    assetTypes: AssetType[];
}
export declare class InventoryTypeRegistry {
    private static readonly invTypeByType;
    private static readonly invTypeByName;
    private static readonly invTypeByHumanName;
    static registerInventoryType(type: InventoryType, typeName: string, humanName: string, assetTypes: AssetType[]): void;
    static getType(type: InventoryType): RegisteredInventoryType | undefined;
    static getTypeName(type: InventoryType): string;
    static getHumanName(type: InventoryType): string;
    static getTypeFromTypeName(type: string): RegisteredInventoryType | undefined;
    static getTypeFromHumanName(type: string): RegisteredInventoryType | undefined;
}
//# sourceMappingURL=InventoryTypeRegistry.d.ts.map