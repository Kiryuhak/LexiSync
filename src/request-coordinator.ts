import { startTextRequest, type CancellableTextRequest, type StreamRequestInput } from './stream-request-client';

export class RequestCoordinator {
    private readonly active = new Set<CancellableTextRequest>();

    run(input: StreamRequestInput): Promise<string> {
        const request = startTextRequest(input);
        this.active.add(request);
        return request.promise.finally(() => this.active.delete(request));
    }

    cancelAll(): void {
        for (const request of [...this.active]) request.cancel();
        this.active.clear();
    }

    get size(): number {
        return this.active.size;
    }
}
