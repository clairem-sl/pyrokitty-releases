import { InventoryItem } from './InventoryItem';
export declare class LLLindenText {
    version: number;
    body: string;
    embeddedItems: Map<number, InventoryItem>;
    private readonly lineObj;
    constructor(data?: Buffer);
    toAsset(): Buffer;
    private parseEmbeddedItems;
    private getLastToken;
}
//# sourceMappingURL=LLLindenText.d.ts.map