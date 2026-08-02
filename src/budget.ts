import type { BudgetSettings, UsageStats } from './types';

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
    dailyRequestLimit: 0,
    monthlyTokenLimit: 0,
    warnLargeText: true,
    autoFastMode: true,
};

export function estimateTokens(text: string): number {
    if (!text) return 0;
    let ascii = 0;
    let nonAscii = 0;
    for (const char of text) {
        if (char.charCodeAt(0) < 128) ascii++;
        else nonAscii++;
    }
    // ASCII ~3.5 chars/token, кириллица и прочие non-ASCII ~1.7 chars/token
    return Math.max(1, Math.ceil(ascii / 3.5 + nonAscii / 1.7));
}

export function getLocalDayKey(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getMonthUsage(stats: UsageStats, date = new Date()): { requests: number; tokens: number } {
    const prefix = getLocalDayKey(date).slice(0, 7);
    return Object.entries(stats.daily || {}).reduce(
        (total, [day, value]) => {
            if (day.startsWith(prefix)) {
                total.requests += Math.max(0, Number(value.requests) || 0);
                total.tokens += Math.max(0, Number(value.tokens) || 0);
            }
            return total;
        },
        { requests: 0, tokens: 0 },
    );
}

export function getBudgetBlockReason(
    settings: BudgetSettings,
    stats: UsageStats,
    estimatedInputTokens: number,
    date = new Date(),
): 'daily' | 'monthly' | null {
    const today = stats.daily?.[getLocalDayKey(date)] || { requests: 0, tokens: 0 };
    if (settings.dailyRequestLimit > 0 && today.requests >= settings.dailyRequestLimit) return 'daily';
    const month = getMonthUsage(stats, date);
    if (settings.monthlyTokenLimit > 0 && month.tokens + estimatedInputTokens > settings.monthlyTokenLimit)
        return 'monthly';
    return null;
}
