export const APPEARANCE_STYLES = ['liquid-glass', 'material-3', 'flutter', 'bento'] as const;

export type AppearanceStyle = (typeof APPEARANCE_STYLES)[number];

export function normalizeAppearanceStyle(value: unknown): AppearanceStyle {
    return APPEARANCE_STYLES.includes(value as AppearanceStyle) ? (value as AppearanceStyle) : 'liquid-glass';
}

export function applyAppearanceStyle(element: HTMLElement, value: unknown): AppearanceStyle {
    const style = normalizeAppearanceStyle(value);
    element.dataset.uiStyle = style;
    return style;
}
