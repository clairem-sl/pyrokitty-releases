import { UUID } from '../UUID';
import { Buffer } from 'buffer';
import type { LLSubMesh } from './interfaces/LLSubMesh';
import type { LLPhysicsConvex } from './interfaces/LLPhysicsConvex';
import type { LLSkin } from './interfaces/LLSkin';
export declare class LLMesh {
    version?: number;
    lodLevels: Record<string, LLSubMesh[]>;
    physicsConvex?: LLPhysicsConvex;
    physicsHavok?: {
        weldingData: Buffer;
        hullMassProps: {
            CoM: number[];
            inertia: number[];
            mass: number;
            volume: number;
        };
        meshDecompMassProps: {
            CoM: number[];
            inertia: number[];
            mass: number;
            volume: number;
        };
    };
    skin?: LLSkin;
    creatorID?: UUID;
    date?: Date;
    costData?: {
        hull: number;
        hull_discounted_vertices: number;
        mesh: number[];
        mesh_triangles: number;
    };
    submodel_id?: number;
    static from(buf: Buffer): Promise<LLMesh>;
    toAsset(): Promise<Buffer>;
    private static parseSkin;
    private static fixReal;
    private static fixRealLLSD;
    private static parsePhysicsConvex;
    private static parseLODLevel;
    private static decodeByteDomain3;
    private static decodeByteDomain2;
    private static toLLSDReal;
    private encodeSubMesh;
    private expandFromDomain;
    private encodeLODLevel;
    private encodePhysicsHavok;
    private encodePhysicsConvex;
    private encodeSkin;
}
//# sourceMappingURL=LLMesh.d.ts.map