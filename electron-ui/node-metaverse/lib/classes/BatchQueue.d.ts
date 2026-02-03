export declare class BatchQueue<T> {
    private readonly batchSize;
    private readonly func;
    private running;
    private readonly pending;
    private readonly onResult;
    constructor(batchSize: number, func: (items: Set<T>) => Promise<Set<T>>);
    add(ids: T[]): Promise<T[]>;
    private processBatch;
}
//# sourceMappingURL=BatchQueue.d.ts.map