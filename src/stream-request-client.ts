import { browser } from 'wxt/browser';
import type { RequestMode, StreamResponse } from './types';

export interface StreamRequestInput {
    text: string;
    mode: RequestMode;
    customPrompt?: string;
    targetLang?: string;
    allowPageContext?: boolean;
}

export interface CancellableTextRequest {
    promise: Promise<string>;
    cancel: () => void;
}

export function startTextRequest(input: StreamRequestInput): CancellableTextRequest {
    const port = browser.runtime.connect({ name: 'mistralStream' });
    let settled = false;
    let result = '';
    let resolvePromise!: (value: string) => void;
    let rejectPromise!: (reason: Error) => void;
    const promise = new Promise<string>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    const finish = (value?: string, error?: Error) => {
        if (settled) return;
        settled = true;
        try {
            port.disconnect();
        } catch {
            // Порт уже мог быть закрыт фоновым процессом.
        }
        if (error) rejectPromise(error);
        else resolvePromise((value || '').trim());
    };

    port.onMessage.addListener((message: StreamResponse) => {
        if (message.status === 'chunk') result += message.text || '';
        else if (message.status === 'reset') result = '';
        else if (message.status === 'done') finish(result);
        else if (message.status === 'error' || message.status === 'cancelled') {
            finish(undefined, new Error(message.error || 'Запрос не выполнен.'));
        }
    });
    port.onDisconnect.addListener(() => {
        if (!settled) finish(undefined, new Error('Соединение с обработчиком запроса прервано.'));
    });
    port.postMessage({
        action: 'callMistral',
        mode: input.mode,
        text: input.text,
        customPrompt: input.customPrompt,
        targetLang: input.targetLang || 'English',
        allowPageContext: input.allowPageContext === true,
    });

    return {
        promise,
        cancel: () => {
            if (settled) return;
            try {
                port.postMessage({ action: 'cancelMistral' });
            } catch {
                // Закрытие порта ниже всё равно завершит локальную задачу.
            }
            finish(undefined, new DOMException('Запрос отменён.', 'AbortError'));
        },
    };
}
