"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchQueue = void 0;
const rxjs_1 = require("rxjs");
class BatchQueue {
    batchSize;
    func;
    running = false;
    pending = new Set();
    onResult = new rxjs_1.Subject();
    constructor(batchSize, func) {
        this.batchSize = batchSize;
        this.func = func;
    }
    async add(ids) {
        const waiting = new Set();
        for (const id of ids) {
            waiting.add(id);
            this.pending.add(id);
        }
        if (!this.running) {
            this.processBatch().catch((_e) => {
                // ignore
            });
        }
        return new Promise((resolve, reject) => {
            const failed = [];
            const subs = this.onResult.subscribe((results) => {
                let included = false;
                for (const v of results.batch.values()) {
                    if (waiting.has(v)) {
                        included = true;
                        if (results.failed?.has(v)) {
                            failed.push(v);
                        }
                        waiting.delete(v);
                    }
                }
                if (!included) {
                    return;
                }
                if (results.exception !== undefined) {
                    subs.unsubscribe();
                    reject(new Error(String(results.exception)));
                    return;
                }
                if (waiting.size === 0) {
                    subs.unsubscribe();
                    resolve(failed);
                    return;
                }
            });
        });
    }
    async processBatch() {
        if (this.running) {
            return;
        }
        try {
            this.running = true;
            const thisBatch = new Set();
            const values = this.pending.values();
            for (const v of values) {
                thisBatch.add(v);
                this.pending.delete(v);
                if (thisBatch.size >= this.batchSize) {
                    break;
                }
            }
            try {
                const failedItems = await this.func(thisBatch);
                this.onResult.next({
                    batch: thisBatch,
                    failed: failedItems
                });
            }
            catch (e) {
                this.onResult.next({
                    batch: thisBatch,
                    exception: e
                });
            }
        }
        finally {
            this.running = false;
            if (this.pending.size > 0) {
                this.processBatch().catch((_e) => {
                    // ignore
                });
            }
        }
    }
}
exports.BatchQueue = BatchQueue;
//# sourceMappingURL=BatchQueue.js.map