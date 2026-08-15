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
    }

    error(message: string, ...args: unknown[]): void {
        console.error(`${this.prefix} ${message}`, ...args);
    }
}

export const logger = new Logger();
