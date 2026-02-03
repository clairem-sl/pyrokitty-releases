"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetMap = void 0;
const UUID_1 = require("./UUID");
class AssetMap {
    map = new Map();
    pending = new Map();
    get(uuid) {
        if (uuid instanceof UUID_1.UUID) {
            uuid = uuid.toString();
        }
        return this.map.get(uuid);
    }
    request(uuid, metadata) {
        if (uuid instanceof UUID_1.UUID) {
            uuid = uuid.toString();
        }
        const mapItem = this.map.get(uuid);
        if (mapItem === undefined) {
            if (metadata === undefined) {
                metadata = {};
            }
            this.map.set(uuid, metadata);
        }
        let pending = this.pending.get(uuid);
        if (pending === undefined) {
            pending = 0;
        }
        this.pending.set(uuid, ++pending);
    }
    delete(uuid) {
        if (uuid instanceof UUID_1.UUID) {
            uuid = uuid.toString();
        }
        this.map.delete(uuid);
        this.pending.delete(uuid);
    }
    getFetchList() {
        const list = [];
        for (const k of this.map.keys()) {
            let p = this.pending.get(k);
            if (p === undefined) {
                continue;
            }
            if (p > 0) {
                const data = this.map.get(k);
                if (data === undefined) {
                    continue;
                }
                if (data.item === undefined) {
                    this.pending.set(k, --p);
                    list.push(k);
                }
            }
        }
        return list;
    }
    setItem(uuid, item) {
        if (uuid instanceof UUID_1.UUID) {
            uuid = uuid.toString();
        }
        let entry = this.map.get(uuid);
        if (entry === undefined) {
            entry = {
                item: item
            };
        }
        else {
            entry.item = item;
        }
        this.map.set(uuid, entry);
    }
    doneFetch(list) {
        for (const item of list) {
            const i = this.map.get(item);
            if (i === undefined) {
                continue;
            }
            if (i.item === undefined) {
                let pending = this.pending.get(item);
                if (pending === undefined) {
                    pending = 0;
                }
                this.pending.set(item, ++pending);
            }
            else {
                this.pending.delete(item);
            }
        }
    }
}
exports.AssetMap = AssetMap;
//# sourceMappingURL=AssetMap.js.map