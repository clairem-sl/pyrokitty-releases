import { CommandsBase } from './CommandsBase';
import { UUID } from '../UUID';
import type { ParcelInfoReplyEvent } from '../../events/ParcelInfoReplyEvent';
import type { LandStatReportType } from '../../enums/LandStatReportType';
import type { LandStatFlags } from '../../enums/LandStatFlags';
import type { LandStatsEvent } from '../../events/LandStatsEvent';
export declare class ParcelCommands extends CommandsBase {
    getParcelInfo(parcelID: UUID | string): Promise<ParcelInfoReplyEvent>;
    getLandStats(parcelID: string | UUID | number, reportType: LandStatReportType, flags: LandStatFlags, filter?: string): Promise<LandStatsEvent>;
}
//# sourceMappingURL=ParcelCommands.d.ts.map