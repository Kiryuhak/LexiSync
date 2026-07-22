export const REQUEST_CACHE_VERSION = 2;

export function createSettingsFingerprint(value: unknown): string {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

export function serializeCacheSource(value: Record<string, unknown>): string {
    return JSON.stringify(value);
}
