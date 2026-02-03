import { TextureAnimFlags } from '../../enums/TextureAnimFlags';
import { Vector2 } from '../Vector2';
export declare class TextureAnim {
    textureAnimFlags: TextureAnimFlags;
    textureAnimFace: number;
    textureAnimSize: Vector2;
    textureAnimStart: number;
    textureAnimLength: number;
    textureAnimRate: number;
    static from(buf: Buffer): TextureAnim;
    toBuffer(): Buffer;
    toBase64(): string;
}
//# sourceMappingURL=TextureAnim.d.ts.map