import { t } from './i18n';
import { POPUP_STYLE_TEXT } from './content-ui-style';
import { applyAppearanceStyle } from './appearance-style';
import { normalizeResultDisplayMode } from './result-display-mode';
import { renderCompactResultPreview } from './result-dialog-view';

export type AppearanceTheme = 'auto' | 'light' | 'dark';

export const systemDarkTheme =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : ({
              matches: false,
              addEventListener: () => {},
              removeEventListener: () => {},
          } as unknown as MediaQueryList);

export function clampInterfaceScale(value: number): number {
    return Math.min(110, Math.max(75, Math.round(value / 5) * 5));
}

export function installResultPreviewStyles(): void {
    if (document.getElementById('lexisync-result-preview-styles')) return;
    const style = document.createElement('style');
    style.id = 'lexisync-result-preview-styles';
    style.textContent = POPUP_STYLE_TEXT.replaceAll('#lexisync-extension-ui', '#compactResultPreview');
    document.head.appendChild(style);
}

export function updateAppearancePreview(): void {
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement | null;
    const visualStyleSelect = document.getElementById('visualStyleSelect') as HTMLSelectElement | null;
    const scaleInput = document.getElementById('interfaceScale') as HTMLInputElement | null;
    const scaleValue = document.getElementById('interfaceScaleValue') as HTMLOutputElement | null;
    const previewStage = document.getElementById('interfacePreview');
    const previewToolbar = document.getElementById('previewToolbar');
    const resultDisplayModeSelect = document.getElementById('resultDisplayMode') as HTMLSelectElement | null;
    const compactPreviewStage = document.getElementById('compactResultPreviewStage');
    const compactResultPreview = document.getElementById('compactResultPreview');
    if (
        !themeSelect ||
        !visualStyleSelect ||
        !scaleInput ||
        !scaleValue ||
        !previewStage ||
        !previewToolbar ||
        !resultDisplayModeSelect ||
        !compactPreviewStage ||
        !compactResultPreview
    )
        return;

    const scale = clampInterfaceScale(Number(scaleInput.value) || 90);
    const theme = themeSelect.value as AppearanceTheme;
    const isDark = theme === 'dark' || (theme === 'auto' && systemDarkTheme.matches);

    scaleInput.value = String(scale);
    scaleValue.value = `${scale}%`;
    scaleValue.textContent = `${scale}%`;
    previewToolbar.style.transform = `scale(${scale / 100})`;
    compactResultPreview.style.transform = `scale(${scale / 100})`;
    previewStage.dataset.theme = isDark ? 'dark' : 'light';
    compactPreviewStage.dataset.theme = isDark ? 'dark' : 'light';
    const resultDisplayMode = normalizeResultDisplayMode(resultDisplayModeSelect.value);
    compactPreviewStage.dataset.mode = resultDisplayMode;
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    const visualStyle = applyAppearanceStyle(document.documentElement, visualStyleSelect.value);
    previewStage.dataset.uiStyle = visualStyle;
    compactPreviewStage.dataset.uiStyle = visualStyle;
    compactResultPreview.dataset.surface = 'result';
    compactResultPreview.dataset.uiStyle = visualStyle;
    compactResultPreview.style.width = 'min(360px, calc(100% - 24px))';
    compactResultPreview.style.boxSizing = 'border-box';
    if (isDark) compactResultPreview.dataset.theme = 'dark';
    else delete compactResultPreview.dataset.theme;
    if (resultDisplayMode === 'detailed') delete compactResultPreview.dataset.compactResult;
    else compactResultPreview.dataset.compactResult = 'true';
    renderCompactResultPreview(
        compactResultPreview,
        {
            title: t('spellcheckDone', 'Ошибки исправлены'),
            before: t('compactResultPreviewBefore', 'Готовый текст без '),
            correction: t('compactResultPreviewCorrection', 'ошибок'),
            after: t('compactResultPreviewAfter', '.'),
            replace: t('replaceText', 'Заменить текст'),
            beforeAfter: t('beforeAfter', 'До / После'),
            repeat: t('repeat', 'Повторить'),
            shorter: t('shorter', 'Короче'),
        },
        resultDisplayMode === 'detailed',
    );
}
