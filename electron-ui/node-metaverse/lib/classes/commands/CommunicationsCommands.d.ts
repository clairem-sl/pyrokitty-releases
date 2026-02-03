import { ChatType } from '../../enums/ChatType';
import type { ScriptDialogEvent } from '../../events/ScriptDialogEvent';
import type { InventoryFolder } from '../InventoryFolder';
import { InventoryItem } from '../InventoryItem';
import { UUID } from '../UUID';
import { CommandsBase } from './CommandsBase';
export declare class CommunicationsCommands extends CommandsBase {
    giveInventory(to: UUID | string, itemOrFolder: InventoryItem | InventoryFolder): Promise<void>;
    sendInstantMessage(to: UUID | string, message: string): Promise<void>;
    nearbyChat(message: string, type: ChatType, channel?: number): Promise<void>;
    say(message: string, channel?: number): Promise<void>;
    whisper(message: string, channel?: number): Promise<void>;
    shout(message: string, channel?: number): Promise<void>;
    startTypingLocal(): Promise<void>;
    sendTeleport(target: UUID | string, message?: string): Promise<void>;
    stopTypingLocal(): Promise<void>;
    startTypingIM(to: UUID | string): Promise<void>;
    stopTypingIM(to: UUID | string): Promise<void>;
    typeInstantMessage(to: UUID | string, message: string, thinkingTime?: number, charactersPerSecond?: number): Promise<void>;
    typeLocalMessage(message: string, thinkingTime?: number, charactersPerSecond?: number): Promise<void>;
    endGroupChatSession(groupID: UUID | string): Promise<void>;
    startGroupChatSession(groupID: UUID | string, message: string): Promise<void>;
    moderateGroupChat(groupID: UUID | string, memberID: UUID | string, muteText: boolean, muteVoice: boolean): Promise<any>;
    sendGroupMessage(groupID: UUID | string, message: string): Promise<number>;
    respondToScriptDialog(event: ScriptDialogEvent, buttonIndex: number): Promise<void>;
}
//# sourceMappingURL=CommunicationsCommands.d.ts.map