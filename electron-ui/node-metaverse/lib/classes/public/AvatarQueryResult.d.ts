import type { UUID } from '../UUID';
export declare class AvatarQueryResult {
    private readonly avatarKey;
    private readonly firstName;
    private readonly lastName;
    constructor(avatarKey: UUID, firstName: string, lastName: string);
    getName(): string;
    getFirstName(): string;
    getLastName(): string;
    getKey(): UUID;
}
//# sourceMappingURL=AvatarQueryResult.d.ts.map