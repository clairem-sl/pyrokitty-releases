"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectResolver = void 0;
const __1 = require("..");
const timers_1 = require("timers");
const BatchQueue_1 = require("./BatchQueue");
class ObjectResolver {
    resolveQueue = new BatchQueue_1.BatchQueue(256, this.resolveInternal.bind(this));
    getCostsQueue = new BatchQueue_1.BatchQueue(64, this.getCostsInternal.bind(this));
    region;
    constructor(region) {
        this.region = region;
    }
    async resolveObjects(objects, options) {
        if (!this.region) {
            throw new Error('Region is going away');
        }
        // First, create a map of all object IDs
        const objs = new Map();
        const failed = [];
        for (const obj of objects) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            if (!obj.IsAttachment && !options.includeTempObjects && ((obj.Flags ?? 0) & __1.PrimFlags.TemporaryOnRez) === __1.PrimFlags.TemporaryOnRez) {
                continue;
            }
            if (!options.includeAvatars && obj.PCode === __1.PCode.Avatar) {
                continue;
            }
            this.region.objects.populateChildren(obj);
            let fullyResolved = obj.resolvedAt !== undefined;
            if (fullyResolved && obj.children) {
                for (const o of obj.children) {
                    if (o.resolvedAt === undefined) {
                        fullyResolved = false;
                        break;
                    }
                }
            }
            if (fullyResolved && !options.forceReResolve) {
                continue;
            }
            this.scanObject(obj, objs);
        }
        if (objs.size === 0) {
            return failed;
        }
        return this.resolveQueue.add(Array.from(objs.values()));
    }
    async getInventory(object) {
        await this.getInventories([object]);
    }
    async getInventories(objects) {
        for (const obj of objects) {
            if (!obj.resolvedInventory) {
                await obj.updateInventory();
            }
        }
    }
    async getCosts(objects) {
        await this.getCostsQueue.add(objects);
    }
    shutdown() {
        delete this.region;
    }
    scanObject(obj, map) {
        const localID = obj.ID;
        if (!map.has(localID)) {
            map.set(localID, obj);
            if (obj.children) {
                for (const child of obj.children) {
                    this.scanObject(child, map);
                }
            }
        }
    }
    async resolveInternal(objs) {
        if (!this.region) {
            throw new Error('Region went away');
        }
        const objArray = Array.from(objs.values());
        for (const obj of objArray) {
            obj.resolveAttempts = (obj.resolveAttempts ?? 0) + 1;
        }
        try {
            await this.region.clientCommands.region.selectObjects(objArray);
        }
        finally {
            await this.region.clientCommands.region.deselectObjects(objArray);
        }
        if (!this.region) {
            throw new Error('Region went away');
        }
        const objects = new Map();
        for (const obj of objs.values()) {
            objects.set(obj.ID, obj);
        }
        for (let x = 0; x < 3; x++) {
            try {
                await this.waitForResolve(objects, 10000);
            }
            catch (_e) {
                // Ignore
            }
        }
        const failed = new Set();
        for (const o of objects.values()) {
            failed.add(o);
        }
        return failed;
    }
    async getCostsInternal(objs) {
        const failed = new Set();
        if (objs.size === 0) {
            return failed;
        }
        const submitted = new Map();
        for (const obj of objs.values()) {
            submitted.set(obj.FullID.toString(), obj);
        }
        try {
            if (!this.region) {
                return objs;
            }
            const result = await this.region.caps.capsPostXML('GetObjectCost', {
                'object_ids': Array.from(submitted.keys())
            });
            const uuids = Object.keys(result);
            for (const key of uuids) {
                const costs = result[key];
                try {
                    if (!this.region) {
                        continue;
                    }
                    const obj = this.region.objects.getObjectByUUID(new __1.UUID(key));
                    obj.linkPhysicsImpact = parseFloat(costs.linked_set_physics_cost);
                    obj.linkResourceImpact = parseFloat(costs.linked_set_resource_cost);
                    obj.physicaImpact = parseFloat(costs.physics_cost);
                    obj.resourceImpact = parseFloat(costs.resource_cost);
                    obj.limitingType = costs.resource_limiting_type;
                    obj.landImpact = Math.round(obj.linkPhysicsImpact);
                    if (obj.linkResourceImpact > obj.linkPhysicsImpact) {
                        obj.landImpact = Math.round(obj.linkResourceImpact);
                    }
                    obj.calculatedLandImpact = obj.landImpact;
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
                    if (obj.Flags !== undefined && ((obj.Flags & __1.PrimFlags.TemporaryOnRez) === __1.PrimFlags.TemporaryOnRez) && obj.limitingType === 'legacy') {
                        obj.calculatedLandImpact = 0;
                    }
                    submitted.delete(key);
                }
                catch (_error) {
                    // Nothing
                }
            }
        }
        catch (_error) {
            // Nothing
        }
        for (const go of submitted.values()) {
            failed.add(go);
        }
        return failed;
    }
    async waitForResolve(objs, timeout = 10000) {
        const entries = objs.entries();
        for (const [localID, entry] of entries) {
            if (entry.resolvedAt !== undefined) {
                objs.delete(localID);
            }
        }
        if (objs.size === 0) {
            return;
        }
        return new Promise((resolve, reject) => {
            if (!this.region) {
                reject(new Error('Region went away'));
                return;
            }
            let subs = undefined;
            let timer = undefined;
            subs = this.region.clientEvents.onObjectResolvedEvent.subscribe((obj) => {
                objs.delete(obj.object.ID);
                if (objs.size === 0) {
                    if (timer !== undefined) {
                        (0, timers_1.clearTimeout)(timer);
                        timer = undefined;
                    }
                    if (subs !== undefined) {
                        subs.unsubscribe();
                        subs = undefined;
                    }
                    resolve();
                }
            });
            timer = setTimeout(() => {
                if (subs !== undefined) {
                    subs.unsubscribe();
                    subs = undefined;
                }
                reject(new Error('Timeout'));
            }, timeout);
        });
    }
}
exports.ObjectResolver = ObjectResolver;
//# sourceMappingURL=ObjectResolver.js.map