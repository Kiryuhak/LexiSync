export function formatRequestDuration(durationMs: number): string {
    const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
    return seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds));
}
