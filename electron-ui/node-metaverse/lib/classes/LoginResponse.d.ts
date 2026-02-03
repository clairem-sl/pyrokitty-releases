import { Agent } from './Agent';
import { Region } from './Region';
import type { ClientEvents } from './ClientEvents';
import type { BotOptionFlags } from '..';
import { LoginFlags } from '..';
export declare class LoginResponse {
    loginFlags: LoginFlags;
    loginMessage: string;
    agent: Agent;
    region: Region;
    events: {
        categories: {
            categoryID: number;
            categoryName: string;
        }[];
    };
    classifieds: {
        categories: {
            categoryID: number;
            categoryName: string;
        }[];
    };
    searchToken: string;
    mfaHash?: string;
    clientEvents: ClientEvents;
    accountType?: string;
    accountLevelBenefits?: {
        animated_object_limit: number;
        animation_upload_cost: number;
        attachment_limit: number;
        create_group_cost: number;
        group_membership_limit: number;
        picks_limit: number;
        sound_upload_cost: number;
        texture_upload_cost: number;
        large_texture_upload_cost?: number[];
    };
    premiumPackages?: Record<string, {
        benefits: Record<string, any>;
    }>;
    constructor(json: any, clientEvents: ClientEvents, options: BotOptionFlags);
    private static toRegionHandle;
    private static parseVector3;
    private static parseHome;
}
//# sourceMappingURL=LoginResponse.d.ts.map