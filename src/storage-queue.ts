const mutationQueues = new Map<string, Promise<void>>();

export function enqueueStorageMutation<T>(mutation: () => Promise<T>, queueKey = 'default'): Promise<T> {
    const previous = mutationQueues.get(queueKey) || Promise.resolve();
    const result = previous.then(mutation, mutation);
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
