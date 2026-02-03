import { AssetType } from '../enums/AssetType';
export declare class RegisteredAssetType {
    type: AssetType;
    description: string;
    typeName: string;
    humanName: string;
    canLink: boolean;
    canFetch: boolean;
    canKnow: boolean;
}
export declare class AssetTypeRegistry {
    private static readonly assetTypeByType;
    private static readonly assetTypeByName;
    private static readonly assetTypeByHumanName;
    static registerAssetType(type: AssetType, description: string, typeName: string, humanName: string, canLink: boolean, canFetch: boolean, canKnow: boolean): void;
    static getType(type: AssetType): RegisteredAssetType | undefined;
    static getTypeName(type: AssetType): string;
    static getHumanName(type: AssetType): string;
    static getTypeFromTypeName(type: string): RegisteredAssetType | undefined;
    static getTypeFromHumanName(type: string): RegisteredAssetType | undefined;
}
//# sourceMappingURL=AssetTypeRegistry.d.ts.map