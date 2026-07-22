let mutationQueue: Promise<void> = Promise.resolve();

export function enqueueStorageMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(mutation, mutation);
    mutationQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}
