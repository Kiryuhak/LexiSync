import { browser } from 'wxt/browser';

export interface ErrorLogEntry {
    id: string;
    timestamp: string;
    level: 'error' | 'warn';
    source: string;
    message: string;
    provider?: 'mistral' | 'groq';
    errorCode?: string;
    status?: number;
    details?: Record<string, unknown>;
}

export const MAX_ERROR_LOGS = 50;
const LOG_STORAGE_KEY = 'appErrorLogs';

/**
 * Строго очищает любые API-ключи, заголовки авторизации, токены и персональные данные из строк лога.
 */
export function sanitizeLogMessage(input: string, knownKeys: string[] = []): string {
    if (!input || typeof input !== 'string') return '';
    let sanitized = input;

    // Очищаем известные сохранённые ключи
    for (const key of knownKeys) {
        if (key && key.trim().length >= 8) {
            sanitized = sanitized.replaceAll(key.trim(), '[REDACTED_KEY]');
        }
    }

    // Регулярные выражения для типичных токенов и ключей
    sanitized = sanitized
        // Groq API ключи вида gsk_...
        .replace(/gsk_[a-zA-Z0-9_-]{20,}/gi, 'gsk_[REDACTED_GROQ_KEY]')
        // 32-64 символьные шестнадцатеричные хеши/ключи (Mistral и др.)
        .replace(/\b[a-fA-F0-9]{32,64}\b/g, '[REDACTED_HEX_KEY]')
        // Bearer токены
        .replace(/Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]')
        // Авторизационные параметры в URL
        .replace(/([?&](?:api[_-]?key|key|token|auth|secret)=)[^&\s]+/gi, '[REDACTED_PARAM]')
        // Email адреса
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, '[REDACTED_EMAIL]')
        // Номера телефонов с кодом или разделителями
        .replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b\+7\d{10}\b/g, '[REDACTED_PHONE]');

    return sanitized;
}

function sanitizeDetails(
    details?: Record<string, unknown>,
    knownKeys: string[] = [],
): Record<string, unknown> | undefined {
    if (!details || typeof details !== 'object') return undefined;
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
        if (typeof value === 'string') {
            clean[key] = sanitizeLogMessage(value, knownKeys);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            clean[key] = value;
        } else if (value && typeof value === 'object') {
            try {
                clean[key] = JSON.parse(sanitizeLogMessage(JSON.stringify(value), knownKeys));
            } catch {
                clean[key] = '[COMPLEX_OBJECT]';
            }
        }
    }
    return clean;
}

function getStorageApi() {
    return typeof chrome !== 'undefined' && chrome.storage ? chrome : browser;
}

export async function getErrorLogs(): Promise<ErrorLogEntry[]> {
    const api = getStorageApi();
    try {
        const stored = await api.storage.local.get({ [LOG_STORAGE_KEY]: [] });
        const list = Array.isArray(stored[LOG_STORAGE_KEY]) ? stored[LOG_STORAGE_KEY] : [];
        return list as ErrorLogEntry[];
    } catch {
        return [];
    }
}

export async function recordErrorLog(entry: {
    level?: 'error' | 'warn';
    source: string;
    message: string;
    provider?: 'mistral' | 'groq';
    errorCode?: string;
    status?: number;
    details?: Record<string, unknown>;
    knownKeys?: string[];
}): Promise<void> {
    const api = getStorageApi();
    try {
        const knownKeys = entry.knownKeys || [];
        const sanitizedMsg = sanitizeLogMessage(entry.message, knownKeys);
        if (!sanitizedMsg.trim()) return;

        const newLog: ErrorLogEntry = {
            id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
            timestamp: new Date().toISOString(),
            level: entry.level || 'error',
            source: entry.source || 'app',
            message: sanitizedMsg,
            provider: entry.provider,
            errorCode: entry.errorCode,
            status: entry.status,
            details: sanitizeDetails(entry.details, knownKeys),
        };

        const existing = await getErrorLogs();
        const updated = [newLog, ...existing].slice(0, MAX_ERROR_LOGS);
        await api.storage.local.set({ [LOG_STORAGE_KEY]: updated });
    } catch (error) {
        console.error('[LexiSync ErrorLog] Failed to record error log:', error);
    }
}

export async function clearErrorLogs(): Promise<void> {
    const api = getStorageApi();
    try {
        await api.storage.local.set({ [LOG_STORAGE_KEY]: [] });
    } catch (error) {
        console.error('[LexiSync ErrorLog] Failed to clear error logs:', error);
    }
}

export function formatErrorLogsAsText(logs: ErrorLogEntry[]): string {
    const header = [
        '========================================',
        ` LEXISYNC ERROR LOG (Записей: ${logs.length})`,
        ` Экспортировано: ${new Date().toLocaleString()}`,
        ' Защита: все API-ключи и личные данные удалены',
        '========================================\n',
    ].join('\n');

    if (logs.length === 0) {
        return `${header}Ошибок не зафиксировано. Все сервисы работают в штатном режиме.\n`;
    }

    const lines = logs.map((log, index) => {
        const parts = [
            `#${index + 1} [${log.timestamp}] [${log.level.toUpperCase()}] [${log.source}]`,
            log.provider ? `  Провайдер: ${log.provider}` : null,
            log.errorCode ? `  Код ошибки: ${log.errorCode}` : null,
            log.status ? `  HTTP статус: ${log.status}` : null,
            `  Сообщение: ${log.message}`,
            log.details ? `  Детали: ${JSON.stringify(log.details)}` : null,
            '----------------------------------------',
        ].filter(Boolean);
        return parts.join('\n');
    });

    return `${header}${lines.join('\n')}\n`;
}

export function formatErrorLogsAsJson(logs: ErrorLogEntry[]): string {
    return JSON.stringify(
        {
            format: 'lexisync-error-log',
            exportedAt: new Date().toISOString(),
            count: logs.length,
            logs,
        },
        null,
        2,
    );
}

export async function downloadErrorLogsText(): Promise<void> {
    const logs = await getErrorLogs();
    const content = formatErrorLogsAsText(logs);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lexisync-error-log-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
