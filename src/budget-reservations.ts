import { getBudgetBlockReason, getLocalDayKey } from './budget';
import { enqueueStorageMutation } from './storage-queue';
import type { BudgetSettings } from './types';
import { applyUsageMutationNow, getUsageStats, USAGE_MUTATION_QUEUE, type UsageMutationPayload } from './usage-stats';

interface Reservation {
    day: string;
    inputTokens: number;
}

export interface BudgetReservationResult {
    id?: string;
    reason?: 'daily' | 'monthly';
}

const reservations = new Map<string, Reservation>();

function withReservations(stats: Awaited<ReturnType<typeof getUsageStats>>) {
    const daily = Object.fromEntries(Object.entries(stats.daily || {}).map(([day, value]) => [day, { ...value }]));
    for (const reservation of reservations.values()) {
        const value = daily[reservation.day] || { requests: 0, tokens: 0 };
        daily[reservation.day] = {
            requests: value.requests + 1,
            tokens: value.tokens + reservation.inputTokens,
        };
    }
    return { ...stats, daily };
}

export function reserveBudget(
    settings: BudgetSettings,
    estimatedInputTokens: number,
    date = new Date(),
): Promise<BudgetReservationResult> {
    return enqueueStorageMutation(async () => {
        const reason = getBudgetBlockReason(
            settings,
            withReservations(await getUsageStats()),
            estimatedInputTokens,
            date,
        );
        if (reason) return { reason };
        const id = crypto.randomUUID();
        reservations.set(id, {
            day: getLocalDayKey(date),
            inputTokens: Math.max(0, Math.trunc(estimatedInputTokens)),
        });
        return { id };
    }, USAGE_MUTATION_QUEUE);
}

export async function reserveBudgetIfActive(
    settings: BudgetSettings,
    estimatedInputTokens: number,
    signal: AbortSignal,
    date = new Date(),
): Promise<BudgetReservationResult | { cancelled: true }> {
    if (signal.aborted) return { cancelled: true };
    const reservation = await reserveBudget(settings, estimatedInputTokens, date);
    if (!signal.aborted) return reservation;
    if (reservation.id) await releaseBudgetReservation(reservation.id);
    return { cancelled: true };
}

export function releaseBudgetReservation(id: string): Promise<void> {
    return enqueueStorageMutation(async () => {
        reservations.delete(id);
    }, USAGE_MUTATION_QUEUE);
}

export function finalizeBudgetReservation(id: string, payload: UsageMutationPayload): Promise<void> {
    return enqueueStorageMutation(async () => {
        try {
            await applyUsageMutationNow('request', payload);
        } finally {
            reservations.delete(id);
        }
    }, USAGE_MUTATION_QUEUE);
}

export function getActiveBudgetReservationCount(): number {
    return reservations.size;
}
