export type TextMode =
    'spellcheck' | 'style' | 'emoji' | 'layout' | 'translate' | 'summary' | 'reply' | 'explain' | 'format';
export type RequestMode = TextMode | 'ocr' | 'custom';
export type AiMode = 'fast' | 'quality';

export interface CustomCommand {
    id: string;
    name: string;
    prompt: string;
}

export interface HistoryItem {
    id: number;
    mode: RequestMode;
    original: string;
    result: string;
    date: string;
    customName?: string;
    favorite?: boolean;
}

export interface StyleProfile {
    id: string;
    name: string;
    tone: string;
    instruction: string;
    sites?: string[];
}

export interface UsageStats {
    requests: number;
    cacheHits: number;
    failures: number;
    totalLatencyMs: number;
    byMode: Partial<Record<RequestMode, number>>;
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
    daily?: Record<string, { requests: number; tokens: number }>;
}

export interface BudgetSettings {
    dailyRequestLimit: number;
    monthlyTokenLimit: number;
    warnLargeText: boolean;
    autoFastMode: boolean;
}

export interface ThemeCustomization {
    accent: string;
    radius: number;
    density: number;
    transparency: number;
    fontScale: number;
}

export interface PrivacySettings {
    historyEnabled: boolean;
    historyRetentionDays: number;
    disabledSites: string[];
}

export interface SelectionData {
    text: string;
    context: string;
    range: Range | null;
    activeElement: HTMLInputElement | HTMLTextAreaElement | null;
    start: number | null;
    end: number | null;
    isInput: boolean;
    imageUrl?: string;
}

export interface StreamResponse {
    status: 'chunk' | 'done' | 'error' | 'cancelled';
    text?: string;
    error?: string;
    retryable?: boolean;
}
