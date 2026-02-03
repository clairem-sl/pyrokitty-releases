import type { Circuit } from './Circuit';
import type { ObjectUpdateMessage } from './messages/ObjectUpdate';
import type { ObjectUpdateCachedMessage } from './messages/ObjectUpdateCached';
import type { ObjectUpdateCompressedMessage } from './messages/ObjectUpdateCompressed';
import type { ImprovedTerseObjectUpdateMessage } from './messages/ImprovedTerseObjectUpdate';
import type { Agent } from './Agent';
import type { ClientEvents } from './ClientEvents';
import type { IObjectStore } from './interfaces/IObjectStore';
import { RBush3D } from 'rbush-3d/dist';
import { ObjectStoreLite } from './ObjectStoreLite';
import { BotOptionFlags } from '../enums/BotOptionFlags';
export declare class ObjectStoreFull extends ObjectStoreLite implements IObjectStore {
    rtree?: RBush3D;
    constructor(circuit: Circuit, agent: Agent, clientEvents: ClientEvents, options: BotOptionFlags);
    protected objectUpdate(objectUpdate: ObjectUpdateMessage): void;
    protected objectUpdateCached(objectUpdateCached: ObjectUpdateCachedMessage): void;
    protected objectUpdateCompressed(objectUpdateCompressed: ObjectUpdateCompressedMessage): void;
    protected objectUpdateTerse(objectUpdateTerse: ImprovedTerseObjectUpdateMessage): void;
}
//# sourceMappingURL=ObjectStoreFull.d.ts.map