import type { AiErrorCode, AiProviderError, AiProviderType } from './ai-provider-types';
import { enqueueStorageMutation } from './storage-queue';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProviderAvailabilityState {
    state: CircuitState;
    consecutiveFailures: number;
    cooldownUntil: number;
    lastErrorCode?: AiErrorCode;
    lastStatus?: number;
    updatedAt: number;
}

export interface ProviderAttemptPermission extends ProviderAvailabilityState {
    allowed: boolean;
    cooldownRemainingMs: number;
}

const STORAGE_KEY = 'lexisync_provider_availability_v1';
const STORAGE_QUEUE = 'provider-availability';
const TRANSIENT_FAILURE_THRESHOLD = 2;
const MAX_EXPLICIT_RETRY_AFTER_MS = 24 * 60 * 60_000;

const emptyState = (): ProviderAvailabilityState => ({
    state: 'CLOSED',
    consecutiveFailures: 0,
    cooldownUntil: 0,
    updatedAt: 0,
});

const states: Record<AiProviderType, ProviderAvailabilityState> = {
    mistral: emptyState(),
    cloudflare: emptyState(),
};

const halfOpenProbes = new Set<AiProviderType>();
let loadPromise: Promise<void> | null = null;

function storageApi(): typeof chrome.storage.local | null {
    return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

function normalizeStoredState(value: unknown): ProviderAvailabilityState {
    const candidate = value && typeof value === 'object' ? (value as Partial<ProviderAvailabilityState>) : {};
    const state = candidate.state === 'OPEN' || candidate.state === 'HALF_OPEN' ? 'OPEN' : 'CLOSED';
    return {
        state,
        consecutiveFailures: Math.max(0, Math.trunc(Number(candidate.consecutiveFailures) || 0)),
        cooldownUntil: Math.max(0, Number(candidate.cooldownUntil) || 0),
        lastErrorCode: candidate.lastErrorCode,
        lastStatus: Number.isFinite(candidate.lastStatus) ? Number(candidate.lastStatus) : undefined,
        updatedAt: Math.max(0, Number(candidate.updatedAt) || 0),
    };
}

async function ensureLoaded(): Promise<void> {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const storage = storageApi();
        if (!storage) return;
        try {
            const stored = await storage.get(STORAGE_KEY);
            const record = stored[STORAGE_KEY] as Partial<Record<AiProviderType, unknown>> | undefined;
            if (record?.mistral) states.mistral = normalizeStoredState(record.mistral);
            if (record?.cloudflare) states.cloudflare = normalizeStoredState(record.cloudflare);
        } catch {
            // Недоступное хранилище не должно блокировать AI-запрос.
        }
    })();
    return loadPromise;
}

async function persist(): Promise<void> {
    const storage = storageApi();
    if (!storage) return;
    const snapshot = {
        mistral: { ...states.mistral, state: states.mistral.state === 'HALF_OPEN' ? 'OPEN' : states.mistral.state },
        cloudflare: {
            ...states.cloudflare,
            state: states.cloudflare.state === 'HALF_OPEN' ? 'OPEN' : states.cloudflare.state,
        },
    };
    await enqueueStorageMutation(() => storage.set({ [STORAGE_KEY]: snapshot }), STORAGE_QUEUE);
}

function cooldownFor(error: AiProviderError, failureCount: number): number {
    if (typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs)) {
        return Math.min(MAX_EXPLICIT_RETRY_AFTER_MS, Math.max(1_000, error.retryAfterMs));
    }
    const exponent = Math.max(0, Math.min(5, failureCount - 1));
    if (error.code === 'RATE_LIMIT' || error.code === 'QUOTA_EXCEEDED') {
        return Math.min(10 * 60_000, 30_000 * 2 ** exponent);
    }
    if (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') {
        return Math.min(2 * 60_000, 10_000 * 2 ** exponent);
    }
    return Math.min(2 * 60_000, 15_000 * 2 ** exponent);
}

export async function acquireProviderAttempt(
    provider: AiProviderType,
    now = Date.now(),
): Promise<ProviderAttemptPermission> {
    await ensureLoaded();
    const current = states[provider];
    if (current.state === 'OPEN') {
        if (current.cooldownUntil > now) {
            return { ...current, allowed: false, cooldownRemainingMs: current.cooldownUntil - now };
        }
        if (halfOpenProbes.has(provider)) {
            return { ...current, state: 'HALF_OPEN', allowed: false, cooldownRemainingMs: 0 };
        }
        current.state = 'HALF_OPEN';
        halfOpenProbes.add(provider);
        return { ...current, allowed: true, cooldownRemainingMs: 0 };
    }
    if (current.state === 'HALF_OPEN' && halfOpenProbes.has(provider)) {
        return { ...current, allowed: false, cooldownRemainingMs: 0 };
    }
    return { ...current, allowed: true, cooldownRemainingMs: 0 };
}

export async function recordProviderSuccess(provider: AiProviderType, now = Date.now()): Promise<void> {
    await ensureLoaded();
    states[provider] = { ...emptyState(), updatedAt: now };
    halfOpenProbes.delete(provider);
    await persist().catch(() => undefined);
}

/** Освобождает единственный HALF_OPEN probe, если пользователь отменил запрос. */
export async function releaseProviderAttempt(provider: AiProviderType): Promise<void> {
    await ensureLoaded();
    if (states[provider].state !== 'HALF_OPEN') return;
    states[provider].state = 'OPEN';
    halfOpenProbes.delete(provider);
}

export async function recordProviderFailure(error: AiProviderError, now = Date.now()): Promise<void> {
    await ensureLoaded();
    const current = states[error.provider];
    const circuitEligible = [
        'RATE_LIMIT',
        'QUOTA_EXCEEDED',
        'TIMEOUT',
        'NETWORK_ERROR',
        'SERVER_ERROR',
        'INVALID_RESPONSE',
    ].includes(error.code);
    const consecutiveFailures = circuitEligible ? current.consecutiveFailures + 1 : current.consecutiveFailures;
    const opensImmediately = error.code === 'RATE_LIMIT' || error.code === 'QUOTA_EXCEEDED';
    const shouldOpen = circuitEligible && (opensImmediately || consecutiveFailures >= TRANSIENT_FAILURE_THRESHOLD);
    states[error.provider] = {
        state: shouldOpen ? 'OPEN' : 'CLOSED',
        consecutiveFailures,
        cooldownUntil: shouldOpen ? now + cooldownFor(error, consecutiveFailures) : 0,
        lastErrorCode: error.code,
        lastStatus: error.status,
        updatedAt: now,
    };
    halfOpenProbes.delete(error.provider);
    await persist().catch(() => undefined);
}

export async function getProviderAvailability(
    provider: AiProviderType,
    now = Date.now(),
): Promise<ProviderAttemptPermission> {
    await ensureLoaded();
    const current = states[provider];
    return {
        ...current,
        allowed: current.state === 'CLOSED' || (current.state === 'OPEN' && current.cooldownUntil <= now),
        cooldownRemainingMs: Math.max(0, current.cooldownUntil - now),
    };
}

export function peekProviderAvailability(provider: AiProviderType, now = Date.now()): ProviderAttemptPermission {
    const current = states[provider];
    return {
        ...current,
        allowed: current.state === 'CLOSED' || (current.state === 'OPEN' && current.cooldownUntil <= now),
        cooldownRemainingMs: Math.max(0, current.cooldownUntil - now),
    };
}

export function resetProviderAvailability(): void {
    states.mistral = emptyState();
    states.cloudflare = emptyState();
    halfOpenProbes.clear();
    loadPromise = Promise.resolve();
    void persist().catch(() => undefined);
}
