import { runStorageGarbageCollection } from './storage-gc';

const mutationQueues = new Map<string, Promise<void>>();

function isQuotaError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return /quota.*exceeded|QUOTA_BYTES/i.test(msg);
}

export function enqueueStorageMutation<T>(mutation: () => Promise<T>, queueKey = 'default'): Promise<T> {
    const runWithQuotaRecovery = async (): Promise<T> => {
        try {
            return await mutation();
        } catch (error) {
            if (isQuotaError(error)) {
                try {
                    await runStorageGarbageCollection();
                    return await mutation();
                } catch {
                    throw error;
                }
            }
            throw error;
        }
    };

    const previous = mutationQueues.get(queueKey) || Promise.resolve();
    const result = previous.then(runWithQuotaRecovery, runWithQuotaRecovery);
    const settled = result.then(
        () => undefined,
        () => undefined,
    );
    mutationQueues.set(queueKey, settled);
    void settled.finally(() => {
        if (mutationQueues.get(queueKey) === settled) mutationQueues.delete(queueKey);
    });
    return result;
}
