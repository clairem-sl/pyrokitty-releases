import type { LLSDType } from '../llsd/LLSDType';
import { UUID } from '../UUID';
import { LLSettings } from '../LLSettings';
export declare class RegionEnvironment {
    regionID?: UUID;
    parcelID?: number | UUID;
    isDefault?: boolean;
    envVersion?: number;
    trackAltitudes?: [number, number, number];
    dayOffset?: number;
    dayNames?: string[];
    dayLength?: number;
    dayHash?: number;
    dayCycle?: LLSettings;
    constructor(data: LLSDType);
    toNotation(): string;
}
//# sourceMappingURL=RegionEnvironment.d.ts.map