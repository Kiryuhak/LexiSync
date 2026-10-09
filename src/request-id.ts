let globalRequestIdSequence = 0;

/**
 * Генерирует глобально уникальный идентификатор запроса,
 * сочетающий префикс, временную метку, порядковый номер и криптографическую/псевдослучайную энтропию.
 */
export function generateRequestId(prefix = 'req'): string {
    return `${prefix}-${Date.now().toString(36)}-${(++globalRequestIdSequence).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
