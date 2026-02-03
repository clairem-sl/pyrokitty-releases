import type { UUID } from "../UUID";
import type { Vector3 } from "../Vector3";
import { CommandsBase } from "./CommandsBase";
export declare class MovementCommands extends CommandsBase {
    sitOnObject(targetID: UUID, offset: Vector3): Promise<void>;
    sitOnGround(): void;
    stand(): void;
    private requestSitOnObject;
    private sitOn;
}
//# sourceMappingURL=MovementCommands.d.ts.map