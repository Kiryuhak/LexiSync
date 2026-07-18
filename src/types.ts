export type TextMode = 'spellcheck' | 'style' | 'emoji' | 'layout' | 'translate';
export type RequestMode = TextMode | 'ocr' | 'custom';

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
}
