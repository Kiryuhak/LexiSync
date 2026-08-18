import type { ThemeCustomization } from './types';

export const DEFAULT_THEME_CUSTOMIZATION: ThemeCustomization = {
    accent: '#6750a4',
    radius: 16,
    density: 100,
    transparency: 96,
    fontScale: 100,
};

export function normalizeThemeCustomization(value: unknown): ThemeCustomization {
    const source = value && typeof value === 'object' ? (value as Partial<ThemeCustomization>) : {};
    const accent = /^#[0-9a-f]{6}$/i.test(String(source.accent)) ? String(source.accent) : '#6750a4';
    const clamp = (input: unknown, min: number, max: number, fallback: number) =>
        Math.min(max, Math.max(min, Number(input) || fallback));
    return {
        accent,
        radius: clamp(source.radius, 4, 28, 16),
        density: clamp(source.density, 80, 115, 100),
        transparency: clamp(source.transparency, 70, 100, 96),
        fontScale: clamp(source.fontScale, 85, 120, 100),
    };
}

export function applyThemeCustomization(element: HTMLElement, value: unknown): ThemeCustomization {
    const theme = normalizeThemeCustomization(value);
    element.style.setProperty('--lexisync-accent', theme.accent);
    element.style.setProperty('--primary', theme.accent);
    element.style.setProperty('--lexisync-radius', `${theme.radius}px`);
    element.style.setProperty('--lexisync-density', String(theme.density / 100));
    element.style.setProperty('--lexisync-surface-opacity', String(theme.transparency / 100));
    element.style.setProperty('--lexisync-font-scale', String(theme.fontScale / 100));
    return theme;
}
