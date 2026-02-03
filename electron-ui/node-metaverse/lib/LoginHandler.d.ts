import type { LoginParameters } from './classes/LoginParameters';
import { LoginResponse } from './classes/LoginResponse';
import type { ClientEvents } from './classes/ClientEvents';
import type { BotOptionFlags } from './enums/BotOptionFlags';
export declare class LoginHandler {
    private readonly clientEvents;
    private readonly options;
    constructor(ce: ClientEvents, options: BotOptionFlags);
    Login(params: LoginParameters): Promise<LoginResponse>;
}
//# sourceMappingURL=LoginHandler.d.ts.map