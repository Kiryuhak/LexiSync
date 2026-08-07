export interface PopupPositionInput {
    anchorX: number;
    anchorY: number;
    anchorTop?: number;
    popupWidth: number;
    popupHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    gap?: number;
    margin?: number;
}

export function calculatePopupPosition({
    anchorX,
    anchorY,
    anchorTop = anchorY,
    popupWidth,
    popupHeight,
    viewportWidth,
    viewportHeight,
    gap = 6,
    margin = 20,
}: PopupPositionInput): { x: number; y: number } {
    const maxX = Math.max(margin, viewportWidth - popupWidth - margin);
    const x = Math.min(Math.max(anchorX, margin), maxX);
    const below = anchorY + gap;
    const above = anchorTop - popupHeight - gap;
    const maxY = Math.max(margin, viewportHeight - popupHeight - margin);

    if (below + popupHeight <= viewportHeight - margin) return { x, y: below };
    if (above >= margin) return { x, y: above };
    return { x, y: Math.min(Math.max(below, margin), maxY) };
}
