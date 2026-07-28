import type { RequestMode } from './types';

export type ResultDisplayMode = 'auto' | 'compact' | 'detailed';

const AUTO_COMPACT_MODES = new Set<RequestMode>(['spellcheck', 'layout', 'translate', 'ocr']);

export function normalizeResultDisplayMode(value: unknown, legacyCompactMode?: unknown): ResultDisplayMode {
    if (value === 'auto' || value === 'compact' || value === 'detailed') return value;
    if (legacyCompactMode === true) return 'compact';
    if (legacyCompactMode === false) return 'detailed';
    return 'compact';
}

export function shouldUseCompactResult(displayMode: ResultDisplayMode, requestMode: RequestMode): boolean {
    if (displayMode === 'compact') return true;
    if (displayMode === 'detailed') return false;
    return AUTO_COMPACT_MODES.has(requestMode);
}
