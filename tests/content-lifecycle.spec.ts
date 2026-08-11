import { afterEach, expect, test, vi } from 'vitest';
import { createPortDisconnectGuard, createRequestLifecycle } from '../src/request-lifecycle';
import { createBatchedUiUpdater } from '../src/content-stream-renderer';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

test('объединяет частые обновления потокового ответа в один кадр', () => {
    vi.useFakeTimers();
    const render = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const updater = createBatchedUiUpdater(render, 32);

    updater.request();
    updater.request();
    updater.request();
    vi.advanceTimersByTime(31);
    expect(render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(render).toHaveBeenCalledOnce();

    updater.request();
    updater.flush();
    expect(render).toHaveBeenCalledTimes(2);
});

test('останавливает запрос и все таймеры при закрытии панели', () => {
    vi.useFakeTimers();
    const onDispose = vi.fn();
    const intervalCallback = vi.fn();
    const timeoutCallback = vi.fn();
    const lifecycle = createRequestLifecycle(onDispose);
    lifecycle.setInterval(intervalCallback, 100);
    lifecycle.setTimeout(timeoutCallback, 200);

    vi.advanceTimersByTime(100);
    expect(intervalCallback).toHaveBeenCalledOnce();
    lifecycle.dispose();
    lifecycle.dispose();
    vi.advanceTimersByTime(1_000);

    expect(onDispose).toHaveBeenCalledOnce();
    expect(intervalCallback).toHaveBeenCalledOnce();
    expect(timeoutCallback).not.toHaveBeenCalled();
    expect(lifecycle.disposed).toBe(true);
});

test('отличает аварийное отключение порта от ожидаемого', () => {
    const onUnexpectedDisconnect = vi.fn();
    const unexpected = createPortDisconnectGuard(onUnexpectedDisconnect);

    expect(unexpected.handleDisconnect()).toBe(true);
    expect(unexpected.handleDisconnect()).toBe(false);
    expect(onUnexpectedDisconnect).toHaveBeenCalledOnce();

    const expected = createPortDisconnectGuard(onUnexpectedDisconnect);
    expected.expectDisconnect();
    expect(expected.handleDisconnect()).toBe(false);
    expect(onUnexpectedDisconnect).toHaveBeenCalledOnce();
});
