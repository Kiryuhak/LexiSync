import type { HistoryItem } from './types';

export const HISTORY_SORT_OPTIONS = ['newest', 'oldest', 'favorites'] as const;
export type HistorySortOption = (typeof HISTORY_SORT_OPTIONS)[number];

function timestamp(item: HistoryItem): number {
    const value = Date.parse(item.date);
    return Number.isFinite(value) ? value : item.id;
}

export function sortHistoryItems(items: HistoryItem[], option: HistorySortOption): HistoryItem[] {
    return [...items].sort((left, right) => {
        if (option === 'favorites' && Boolean(left.favorite) !== Boolean(right.favorite)) return left.favorite ? -1 : 1;
        const difference = timestamp(right) - timestamp(left);
        return option === 'oldest' ? -difference : difference;
    });
}
