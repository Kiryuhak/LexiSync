export interface RequestLifecycle {
    readonly disposed: boolean;
    setInterval: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
    clearInterval: (interval: ReturnType<typeof setInterval>) => void;
    setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    dispose: () => void;
}

export interface PortDisconnectGuard {
    expectDisconnect: () => void;
    handleDisconnect: () => boolean;
}

export function createPortDisconnectGuard(onUnexpectedDisconnect: () => void): PortDisconnectGuard {
    let expected = false;
    let handled = false;
    return {
        expectDisconnect() {
            expected = true;
        },
        handleDisconnect() {
            if (expected || handled) return false;
            handled = true;
            onUnexpectedDisconnect();
            return true;
        },
    };
}

export function createRequestLifecycle(onDispose: () => void): RequestLifecycle {
    let disposed = false;
    const intervals = new Set<ReturnType<typeof setInterval>>();
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    return {
        get disposed() {
            return disposed;
        },
        setInterval(callback, delay) {
            const interval = setInterval(() => {
                if (!disposed) callback();
            }, delay);
            intervals.add(interval);
            return interval;
        },
        clearInterval(interval) {
            clearInterval(interval);
            intervals.delete(interval);
        },
        setTimeout(callback, delay) {
            const timeout = setTimeout(() => {
                timeouts.delete(timeout);
                if (!disposed) callback();
            }, delay);
            timeouts.add(timeout);
            return timeout;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            onDispose();
            intervals.forEach(clearInterval);
            intervals.clear();
            timeouts.forEach(clearTimeout);
            timeouts.clear();
        },
    };
}
