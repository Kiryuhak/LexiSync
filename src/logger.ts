import { recordErrorLog } from './error-log';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function formatLogArgument(value: unknown): string {
    if (value instanceof Error) return value.message || value.name;
    if (value && typeof value === 'object' && 'message' in value) {
        const message = (value as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
    }
    if (typeof value !== 'object') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function appendLogArguments(message: string, args: unknown[]): string {
    return args.length > 0 ? `${message} ${args.map(formatLogArgument).join(' ')}` : message;
}

class Logger {
    private readonly prefix = '[LexiSync]';

    debug(_message: string, ..._args: unknown[]): void {
        // Debug logs disabled in production
    }

    info(_message: string, ..._args: unknown[]): void {
        // Info logs disabled in production
    }

    warn(message: string, ...args: unknown[]): void {
        console.warn(`${this.prefix} ${message}`, ...args);
        void recordErrorLog({
            level: 'warn',
            source: 'logger',
            message: appendLogArguments(message, args),
        });
    }

    error(message: string, ...args: unknown[]): void {
        console.error(`${this.prefix} ${message}`, ...args);
        void recordErrorLog({
            level: 'error',
            source: 'logger',
            message: appendLogArguments(message, args),
        });
    }
}

export const logger = new Logger();
