import { ICONS } from './icons';
import { t } from './i18n';
import { setIcon } from './dom-rendering';

export interface LanguagePickerOptions {
    currentLanguage: string;
    getLanguageName: (code: string) => string;
    onLanguageChange: (language: string) => void;
}

export const POPULAR_LANGUAGE_CODES = ['en', 'ru', 'de', 'fr', 'es', 'it', 'pl', 'zh', 'tr', 'ja'] as const;

export function createLanguagePicker({
    currentLanguage,
    getLanguageName,
    onLanguageChange,
}: LanguagePickerOptions): HTMLElement {
    let selectedLanguage = currentLanguage;

    const langWrap = document.createElement('div');
    langWrap.style.cssText =
        'display: flex; align-items: center; position: relative; user-select: none; margin-left: -10px;';

    const langTrigger = document.createElement('button');
    langTrigger.type = 'button';
    langTrigger.setAttribute('aria-haspopup', 'listbox');
    langTrigger.setAttribute('aria-expanded', 'false');
    langTrigger.setAttribute('aria-label', t('selectTranslationLanguage', 'Выбрать язык перевода'));
    langTrigger.style.cssText =
        'display:flex;align-items:center;gap:4px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--text-primary);font:inherit;font-weight:600;cursor:pointer;';

    const languageLabel = document.createElement('span');
    languageLabel.id = 'lexisync-lang-label';
    languageLabel.textContent = selectedLanguage;

    const chevron = document.createElement('span');
    chevron.style.marginTop = '2px';
    setIcon(chevron, ICONS.chevronDown);

    langTrigger.append(languageLabel, chevron);
    langWrap.append(langTrigger);

    const langDropdown = document.createElement('div');
    langDropdown.className = 'lexisync-scroll';
    langDropdown.setAttribute('role', 'listbox');
    langDropdown.setAttribute('aria-label', t('translationLanguages', 'Языки перевода'));
    langDropdown.style.cssText =
        'display: none; position: absolute; top: 100%; left: -4px; margin-top: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 12px 24px var(--shadow-color); flex-direction: column; min-width: 140px; z-index: 9999; padding: 8px 0; max-height: 220px; overflow-y: auto; font-weight: normal;';

    const popularLangs = POPULAR_LANGUAGE_CODES.map(getLanguageName);

    popularLangs.forEach((lang) => {
        const langItem = document.createElement('button');
        langItem.type = 'button';
        langItem.setAttribute('role', 'option');
        langItem.setAttribute('aria-selected', String(lang === selectedLanguage));
        langItem.textContent = lang;
        langItem.style.cssText =
            'width:100%;padding:10px 16px;border:0;background:transparent;text-align:left;font-size:13px;cursor:pointer;transition:background 0.1s;color:var(--text-primary);';

        if (lang === selectedLanguage) {
            langItem.style.background = 'var(--hover-bg)';
            langItem.style.fontWeight = '600';
        }

        langItem.onmouseover = () => {
            if (lang !== selectedLanguage) langItem.style.background = 'var(--hover-bg)';
        };
        langItem.onmouseout = () => {
            if (lang !== selectedLanguage) langItem.style.background = 'transparent';
        };

        langItem.onclick = (e) => {
            e.stopPropagation();
            langDropdown.style.display = 'none';
            langTrigger.setAttribute('aria-expanded', 'false');
            if (lang !== selectedLanguage) {
                selectedLanguage = lang;
                languageLabel.textContent = lang;
                onLanguageChange(lang);
            }
        };

        langDropdown.appendChild(langItem);
    });

    langWrap.appendChild(langDropdown);

    langTrigger.onclick = (e) => {
        e.stopPropagation();
        const open = langDropdown.style.display !== 'flex';
        langDropdown.style.display = open ? 'flex' : 'none';
        langTrigger.setAttribute('aria-expanded', String(open));
        if (open) langDropdown.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    };

    return langWrap;
}
