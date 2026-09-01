import { DEFAULT_BUDGET_SETTINGS } from './budget';
import { DEFAULT_THEME_CUSTOMIZATION, normalizeThemeCustomization } from './theme-customization';
import type { ThemeCustomization } from './types';
import { normalizeSiteEntries } from './privacy';

function byId<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

function clampInteger(value: unknown, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));
}

function renderThemePreview(theme: ThemeCustomization): void {
    const preview = byId<HTMLElement>('themeEditorPreview');
    preview.style.setProperty('--editor-accent', theme.accent);
    preview.style.setProperty('--editor-radius', `${theme.radius}px`);
    preview.style.setProperty('--editor-density', String(theme.density / 100));
    preview.style.setProperty('--editor-opacity', String(theme.transparency / 100));
    preview.style.setProperty('--editor-font-scale', String(theme.fontScale / 100));
    byId<HTMLOutputElement>('themeRadiusValue').textContent = `${theme.radius} px`;
    byId<HTMLOutputElement>('themeDensityValue').textContent = `${theme.density}%`;
    byId<HTMLOutputElement>('themeTransparencyValue').textContent = `${theme.transparency}%`;
    byId<HTMLOutputElement>('themeFontScaleValue').textContent = `${theme.fontScale}%`;
}

function readThemeEditor(): ThemeCustomization {
    return normalizeThemeCustomization({
        accent: byId<HTMLInputElement>('themeAccent').value,
        radius: byId<HTMLInputElement>('themeRadius').value,
        density: byId<HTMLInputElement>('themeDensity').value,
        transparency: byId<HTMLInputElement>('themeTransparency').value,
        fontScale: byId<HTMLInputElement>('themeFontScale').value,
    });
}

function fillThemeEditor(theme: ThemeCustomization): void {
    byId<HTMLInputElement>('themeAccent').value = theme.accent;
    byId<HTMLInputElement>('themeRadius').value = String(theme.radius);
    byId<HTMLInputElement>('themeDensity').value = String(theme.density);
    byId<HTMLInputElement>('themeTransparency').value = String(theme.transparency);
    byId<HTMLInputElement>('themeFontScale').value = String(theme.fontScale);
    renderThemePreview(theme);
}

export interface StoredV4Settings {
    themeCustomization?: unknown;
    liveProofreadEnabled?: unknown;
    liveProofreadDelay?: unknown;
    liveProofreadDisabledSites?: unknown;
    dailyRequestLimit?: unknown;
    monthlyTokenLimit?: unknown;
    warnLargeText?: unknown;
    autoFastMode?: unknown;
    enablePiiMasking?: unknown;
}

export async function restoreV4Settings(storedSettings?: StoredV4Settings): Promise<void> {
    const stored: StoredV4Settings =
        storedSettings ??
        (await chrome.storage.local.get({
            themeCustomization: DEFAULT_THEME_CUSTOMIZATION,
            liveProofreadEnabled: false,
            liveProofreadDelay: 900,
            liveProofreadDisabledSites: [],
            enablePiiMasking: false,
            ...DEFAULT_BUDGET_SETTINGS,
        }));
    byId<HTMLInputElement>('liveProofreadEnabled').checked = stored.liveProofreadEnabled === true;
    byId<HTMLSelectElement>('liveProofreadDelay').value = ['600', '900', '1500', '2500'].includes(
        String(stored.liveProofreadDelay),
    )
        ? String(stored.liveProofreadDelay)
        : '900';
    byId<HTMLTextAreaElement>('liveProofreadDisabledSites').value = Array.isArray(stored.liveProofreadDisabledSites)
        ? stored.liveProofreadDisabledSites.join('\n')
        : '';
    byId<HTMLInputElement>('dailyRequestLimit').value = String(clampInteger(stored.dailyRequestLimit, 0, 50_000));
    byId<HTMLInputElement>('monthlyTokenLimit').value = String(clampInteger(stored.monthlyTokenLimit, 0, 100_000_000));
    byId<HTMLInputElement>('warnLargeText').checked = stored.warnLargeText !== false;
    byId<HTMLInputElement>('autoFastMode').checked = stored.autoFastMode !== false;
    const piiEl = byId<HTMLInputElement>('enablePiiMasking');
    if (piiEl) piiEl.checked = stored.enablePiiMasking === true;
    fillThemeEditor(normalizeThemeCustomization(stored.themeCustomization));
    void updateBudgetProgressIndicators();
}

export async function updateBudgetProgressIndicators(): Promise<void> {
    const dailyInput = document.getElementById('dailyRequestLimit') as HTMLInputElement | null;
    const monthlyInput = document.getElementById('monthlyTokenLimit') as HTMLInputElement | null;
    const dailyFill = document.getElementById('dailyProgressFill');
    const dailyText = document.getElementById('dailyProgressText');
    const monthlyFill = document.getElementById('monthlyProgressFill');
    const monthlyText = document.getElementById('monthlyProgressText');

    if (!dailyInput && !monthlyInput) return;

    const stored = await chrome.storage.local.get({ usageStats: { daily: {} } });
    const stats = (stored.usageStats || { daily: {} }) as {
        daily?: Record<string, { requests?: number; tokens?: number }>;
    };
    const todayKey = new Date().toISOString().slice(0, 10);
    const monthKey = todayKey.slice(0, 7);
    const todayRequests = stats.daily?.[todayKey]?.requests || 0;

    let monthTokens = 0;
    for (const [day, dayStats] of Object.entries(stats.daily || {})) {
        if (day.startsWith(monthKey)) {
            monthTokens += dayStats.tokens || 0;
        }
    }

    const dailyLimit = clampInteger(dailyInput?.value, 0, 50_000);
    if (dailyFill && dailyText) {
        if (dailyLimit === 0) {
            dailyFill.style.width = '0%';
            dailyFill.classList.remove('is-high');
            dailyText.textContent = `Сегодня: ${todayRequests} запр. (без ограничений)`;
        } else {
            const pct = Math.min(100, Math.round((todayRequests / dailyLimit) * 100));
            dailyFill.style.width = `${pct}%`;
            dailyFill.classList.toggle('is-high', pct >= 85);
            dailyText.textContent = `Сегодня: ${todayRequests} из ${dailyLimit.toLocaleString('ru-RU')} (${pct}%)`;
        }
    }

    const monthlyLimit = clampInteger(monthlyInput?.value, 0, 100_000_000);
    if (monthlyFill && monthlyText) {
        if (monthlyLimit === 0) {
            monthlyFill.style.width = '0%';
            monthlyFill.classList.remove('is-high');
            monthlyText.textContent = `В этом месяце: ${monthTokens.toLocaleString('ru-RU')} токенов (без ограничений)`;
        } else {
            const pct = Math.min(100, Math.round((monthTokens / monthlyLimit) * 100));
            monthlyFill.style.width = `${pct}%`;
            monthlyFill.classList.toggle('is-high', pct >= 85);
            monthlyText.textContent = `В этом месяце: ${monthTokens.toLocaleString('ru-RU')} из ${monthlyLimit.toLocaleString('ru-RU')} (${pct}%)`;
        }
    }
}

export function setupV4Settings(): void {
    byId<HTMLInputElement>('liveProofreadEnabled').addEventListener('change', (event) => {
        void chrome.storage.local.set({ liveProofreadEnabled: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLSelectElement>('liveProofreadDelay').addEventListener('change', (event) => {
        void chrome.storage.local.set({ liveProofreadDelay: Number((event.target as HTMLSelectElement).value) });
    });
    byId<HTMLTextAreaElement>('liveProofreadDisabledSites').addEventListener('change', (event) => {
        const input = event.target as HTMLTextAreaElement;
        const normalized = normalizeSiteEntries(input.value);
        input.value = normalized.valid.join('\n');
        void chrome.storage.local.set({ liveProofreadDisabledSites: normalized.valid });
    });
    byId<HTMLInputElement>('dailyRequestLimit').addEventListener('change', (event) => {
        const value = clampInteger((event.target as HTMLInputElement).value, 0, 50_000);
        (event.target as HTMLInputElement).value = String(value);
        void chrome.storage.local.set({ dailyRequestLimit: value });
        void updateBudgetProgressIndicators();
    });
    byId<HTMLInputElement>('monthlyTokenLimit').addEventListener('change', (event) => {
        const value = clampInteger((event.target as HTMLInputElement).value, 0, 100_000_000);
        (event.target as HTMLInputElement).value = String(value);
        void chrome.storage.local.set({ monthlyTokenLimit: value });
        void updateBudgetProgressIndicators();
    });
    for (const id of ['warnLargeText', 'autoFastMode', 'enablePiiMasking'] as const) {
        const el = byId<HTMLInputElement>(id);
        if (el) {
            el.addEventListener('change', (event) => {
                void chrome.storage.local.set({ [id]: (event.target as HTMLInputElement).checked });
            });
        }
    }

    const applyBudgetPreset = (daily: number, monthly: number) => {
        const dailyInput = document.getElementById('dailyRequestLimit') as HTMLInputElement | null;
        const monthlyInput = document.getElementById('monthlyTokenLimit') as HTMLInputElement | null;
        if (dailyInput) {
            dailyInput.value = String(daily);
            dailyInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (monthlyInput) {
            monthlyInput.value = String(monthly);
            monthlyInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    document.getElementById('presetGroqQuotaBtn')?.addEventListener('click', () => {
        applyBudgetPreset(14400, 1000000);
    });
    document.getElementById('presetMistralQuotaBtn')?.addEventListener('click', () => {
        applyBudgetPreset(1000, 500000);
    });
    document.getElementById('presetSafeDailyBtn')?.addEventListener('click', () => {
        applyBudgetPreset(100, 100000);
    });
    document.getElementById('presetSyncActiveProviderBtn')?.addEventListener('click', async () => {
        const stored = await chrome.storage.local.get({ primaryAiProvider: 'auto' });
        const provider = stored.primaryAiProvider as string;
        if (provider === 'mistral') {
            applyBudgetPreset(1000, 500000);
        } else {
            applyBudgetPreset(14400, 1000000);
        }
    });
    document.getElementById('presetUnlimitedBtn')?.addEventListener('click', () => {
        applyBudgetPreset(0, 0);
    });

    for (const id of ['themeAccent', 'themeRadius', 'themeDensity', 'themeTransparency', 'themeFontScale']) {
        byId<HTMLInputElement>(id).addEventListener('input', () => {
            const theme = readThemeEditor();
            renderThemePreview(theme);
            void chrome.storage.local.set({ themeCustomization: theme });
        });
    }
    byId<HTMLButtonElement>('resetThemeEditor').addEventListener('click', () => {
        fillThemeEditor(DEFAULT_THEME_CUSTOMIZATION);
        void chrome.storage.local.set({ themeCustomization: DEFAULT_THEME_CUSTOMIZATION });
    });
}
