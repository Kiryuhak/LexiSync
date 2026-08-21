import { isSiteDisabled, normalizeDisabledSites } from './privacy';

/** Проверяет глобальное отключение LexiSync для URL, не затрагивая страницы расширения. */
export function isExtensionAllowedForUrl(sourceUrl: string, blockedSites: unknown): boolean {
    if (!/^https?:/i.test(sourceUrl)) return true;
    try {
        return !isSiteDisabled(new URL(sourceUrl).hostname, normalizeDisabledSites(blockedSites));
    } catch {
        return false;
    }
}
