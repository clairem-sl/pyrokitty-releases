import { RenderMaterialParam } from './RenderMaterialParam';
export declare class RenderMaterialData {
    params: RenderMaterialParam[];
    constructor(buf?: Buffer, pos?: number, length?: number);
    writeToBuffer(buf: Buffer, pos: number): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=RenderMaterialData.d.ts.map