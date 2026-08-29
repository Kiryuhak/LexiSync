import { recordErrorLog } from './error-log';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
            message: `${message}${args.length > 0 ? ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') : ''}`,
        });
    }

    error(message: string, ...args: unknown[]): void {
        console.error(`${this.prefix} ${message}`, ...args);
        void recordErrorLog({
            level: 'error',
            source: 'logger',
            message: `${message}${args.length > 0 ? ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') : ''}`,
        });
    }
}

export const logger = new Logger();
