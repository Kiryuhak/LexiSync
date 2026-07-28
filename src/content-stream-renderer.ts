export interface BatchedUiUpdater {
    request: () => void;
    flush: () => void;
    cancel: () => void;
}

export function createBatchedUiUpdater(render: () => void, delayMs = 32): BatchedUiUpdater {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let animationFrame: number | null = null;

    const cancel = () => {
        if (timeout !== null) clearTimeout(timeout);
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        timeout = null;
        animationFrame = null;
    };

    const flush = () => {
        cancel();
        render();
    };

    const request = () => {
        if (timeout !== null || animationFrame !== null) return;
        timeout = setTimeout(() => {
            timeout = null;
            animationFrame = requestAnimationFrame(() => {
                animationFrame = null;
                render();
            });
        }, delayMs);
    };

    return { request, flush, cancel };
}
