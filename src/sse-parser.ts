export interface SseEvent {
    data: string;
    event?: string;
    id?: string;
    retry?: number;
}

/**
 * Incremental SSE parser. It preserves event boundaries across network chunks,
 * supports multi-line data fields and ignores comments/unknown fields.
 */
export class SseParser {
    private buffer = '';
    private dataLines: string[] = [];
    private eventType: string | undefined;
    private eventId: string | undefined;
    private retryMs: number | undefined;

    push(chunk: string): SseEvent[] {
        this.buffer += chunk;
        const events: SseEvent[] = [];
        let newlineIndex = this.buffer.search(/[\r\n]/);

        while (newlineIndex >= 0) {
            if (this.buffer[newlineIndex] === '\r' && newlineIndex + 1 === this.buffer.length) break;
            const line = this.buffer.slice(0, newlineIndex);
            const newlineLength = this.buffer[newlineIndex] === '\r' && this.buffer[newlineIndex + 1] === '\n' ? 2 : 1;
            this.buffer = this.buffer.slice(newlineIndex + newlineLength);
            const event = this.processLine(line);
            if (event) events.push(event);
            newlineIndex = this.buffer.search(/[\r\n]/);
        }

        return events;
    }

    finish(): SseEvent[] {
        const events = this.buffer ? this.push('\n') : [];
        const finalEvent = this.dispatch();
        if (finalEvent) events.push(finalEvent);
        return events;
    }

    private processLine(line: string): SseEvent | null {
        if (line === '') return this.dispatch();
        if (line.startsWith(':')) return null;

        const separator = line.indexOf(':');
        const field = separator >= 0 ? line.slice(0, separator) : line;
        let value = separator >= 0 ? line.slice(separator + 1) : '';
        if (value.startsWith(' ')) value = value.slice(1);

        switch (field) {
            case 'data':
                this.dataLines.push(value);
                break;
            case 'event':
                this.eventType = value;
                break;
            case 'id':
                if (!value.includes('\0')) this.eventId = value;
                break;
            case 'retry': {
                const parsed = Number(value);
                if (/^\d+$/.test(value) && Number.isSafeInteger(parsed)) this.retryMs = parsed;
                break;
            }
        }
        return null;
    }

    private dispatch(): SseEvent | null {
        if (this.dataLines.length === 0) {
            this.eventType = undefined;
            this.retryMs = undefined;
            return null;
        }
        const event: SseEvent = {
            data: this.dataLines.join('\n'),
            event: this.eventType,
            id: this.eventId,
            retry: this.retryMs,
        };
        this.dataLines = [];
        this.eventType = undefined;
        this.retryMs = undefined;
        return event;
    }
}
