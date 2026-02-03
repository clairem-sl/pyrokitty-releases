import type { LandStatReportType } from '../enums/LandStatReportType';
import type { LandStatFlags } from '../enums/LandStatFlags';
import type { Vector3 } from '../classes/Vector3';
import type { UUID } from '../classes/UUID';
export declare class LandStatsEvent {
    totalObjects: number;
    reportType: LandStatReportType;
    requestFlags: LandStatFlags;
    objects: {
        position: Vector3;
        ownerName: string;
        score: number;
        objectID: UUID;
        localID: number;
        objectName: string;
        monoScore: number;
        ownerID: UUID;
        parcelName: string;
        publicURLs: number;
        size: number;
        timestamp: number;
    }[];
}
//# sourceMappingURL=LandStatsEvent.d.ts.map