import type { UUID } from '../classes/UUID';
import type * as Long from 'long';
export declare class GroupProfileReplyEvent {
    GroupID: UUID;
    Name: string;
    Charter: string;
    ShowInList: boolean;
    MemberTitle: string;
    PowersMask: Long;
    InsigniaID: UUID;
    FounderID: UUID;
    MembershipFee: number;
    OpenEnrollment: boolean;
    Money: number;
    GroupMembershipCount: number;
    GroupRolesCount: number;
    AllowPublish: boolean;
    MaturePublish: boolean;
    OwnerRole: UUID;
}
//# sourceMappingURL=GroupProfileReplyEvent.d.ts.map