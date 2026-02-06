import type { UUID } from '../classes/UUID';

export interface GroupData {
    groupID: UUID;
    groupName: string;
    groupInsigniaID: UUID;
    contribution: number;
    groupPowers: string; // Base64 encoded
    acceptNotices: boolean;
    listInProfile: boolean;
}

export class AgentGroupDataUpdateEvent {
    public agentID: UUID;
    public groups: GroupData[];
}
