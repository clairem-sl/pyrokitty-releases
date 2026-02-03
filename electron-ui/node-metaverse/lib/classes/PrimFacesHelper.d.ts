import type { GameObject } from './public/GameObject';
import type { Bot } from '../Bot';
export declare class PrimFacesHelper {
    private readonly bot;
    private readonly container;
    readerID: string;
    private chatSubs?;
    private readonly onGotFaces;
    private readonly finished;
    private sides;
    constructor(bot: Bot, container: GameObject);
    getFaces(): Promise<number>;
    private waitForSides;
}
//# sourceMappingURL=PrimFacesHelper.d.ts.map