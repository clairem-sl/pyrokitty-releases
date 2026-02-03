import type { InventoryFolder } from '../InventoryFolder';
import { UUID } from '../UUID';
import { CommandsBase } from './CommandsBase';
import type { Vector3 } from '../Vector3';
import type { AvatarPropertiesReplyEvent } from '../../events/AvatarPropertiesReplyEvent';
import type { Avatar } from '../public/Avatar';
import type { GameObject } from '../public/GameObject';
export declare class AgentCommands extends CommandsBase {
    startAnimations(anim: UUID[]): Promise<void>;
    stopAnimations(anim: UUID[]): Promise<void>;
    setCamera(position: Vector3, lookAt: Vector3, viewDistance?: number, leftAxis?: Vector3, upAxis?: Vector3): void;
    setViewDistance(viewDistance: number): void;
    getGameObject(): GameObject;
    getWearables(): Promise<InventoryFolder>;
    waitForAppearanceComplete(timeout?: number): Promise<void>;
    getAvatar(avatarID?: UUID | string): Avatar | undefined;
    getAvatarProperties(avatarID: UUID | string): Promise<AvatarPropertiesReplyEvent>;
    private animate;
}
//# sourceMappingURL=AgentCommands.d.ts.map