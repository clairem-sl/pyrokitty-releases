import { CommandsBase } from './CommandsBase';
import { UUID } from '../UUID';
import { GroupRole } from '../GroupRole';
import { GroupMember } from '../GroupMember';
import { GroupBanAction } from '../../enums/GroupBanAction';
import { GroupBan } from '../GroupBan';
import type { GroupInviteEvent } from '../../events/GroupInviteEvent';
import type { GroupProfileReplyEvent } from '../../events/GroupProfileReplyEvent';
export declare class GroupCommands extends CommandsBase {
    sendGroupNotice(groupID: UUID | string, subject: string, message: string): Promise<void>;
    sendGroupInviteBulk(groupID: UUID | string, sendTo: {
        avatarID: UUID | string;
        roleID: UUID | string | undefined;
    }[]): Promise<void>;
    getSessionAgentCount(sessionID: UUID | string): number;
    sendGroupInvite(groupID: UUID | string, to: UUID | string, role: UUID | string | undefined): Promise<void>;
    acceptGroupInvite(event: GroupInviteEvent): Promise<void>;
    rejectGroupInvite(event: GroupInviteEvent): Promise<void>;
    unbanMembers(groupID: UUID | string, avatars: UUID | string | string[] | UUID[]): Promise<void>;
    banMembers(groupID: UUID | string, avatars: UUID | string | string[] | UUID[], groupAction?: GroupBanAction): Promise<void>;
    getBanList(groupID: UUID | string): Promise<GroupBan[]>;
    getMemberList(groupID: UUID | string): Promise<GroupMember[]>;
    getGroupRoles(groupID: UUID | string): Promise<GroupRole[]>;
    ejectFromGroupBulk(groupID: UUID | string, sendTo: UUID[] | string[]): Promise<void>;
    ejectFromGroup(groupID: UUID | string, ejecteeID: UUID | string): Promise<void>;
    getGroupProfile(groupID: UUID | string): Promise<GroupProfileReplyEvent>;
}
//# sourceMappingURL=GroupCommands.d.ts.map