import { t } from './i18n';
import { logger } from './logger';

export interface OcrOverlayOptions {
    isEnabled: () => boolean;
    onImage: (imageUrl: string, rect: DOMRect) => void;
}

export interface OcrOverlayController {
    open: (screenshotUrl: string) => void;
}

export function initializeOcrOverlay(options: OcrOverlayOptions): OcrOverlayController {
    let overlay: HTMLDivElement | null = null;
    let selection: HTMLDivElement | null = null;
    let startX = 0;
    let startY = 0;
    let selecting = false;
    let screenshotDataUrl = '';

    const close = () => {
        overlay?.remove();
        overlay = null;
        selection = null;
        selecting = false;
        screenshotDataUrl = '';
    };

    const crop = (rect: DOMRect, dataUrl: string) => {
        const image = new Image();
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) {
                    return;
                }
                const dpr = window.devicePixelRatio || 1;
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                context.drawImage(
                    image,
                    rect.left * dpr,
                    rect.top * dpr,
                    rect.width * dpr,
                    rect.height * dpr,
                    0,
                    0,
                    canvas.width,
                    canvas.height,
                );
                options.onImage(canvas.toDataURL('image/jpeg', 0.9), rect);
            } catch (err) {
                logger.error('Ошибка обрезки изображения OCR:', err);
            }
        };
        image.onerror = () => {
            logger.error('Ошибка загрузки скриншота для OCR');
        };
        image.src = dataUrl;
    };

    const open = () => {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'lexisync-ocr-overlay';
        overlay.setAttribute('role', 'application');
        overlay.setAttribute('aria-label', t('selectOcrArea', 'Выберите область экрана для распознавания текста'));
        overlay.style.cssText =
            'position:fixed;top:0;left:0;width:100vw;height:100vh;background:transparent;z-index:2147483646;cursor:crosshair;';

        selection = document.createElement('div');
        selection.id = 'lexisync-ocr-selection';
        selection.style.cssText =
            'position:fixed;border:2px dashed #fff;background:rgba(255,255,255,.1);display:none;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,.4);';
        overlay.appendChild(selection);
        document.body.appendChild(overlay);

        overlay.addEventListener('mousedown', (event) => {
            selecting = true;
            startX = event.clientX;
            startY = event.clientY;
            if (!selection) return;
            selection.style.display = 'block';
            selection.style.left = `${startX}px`;
            selection.style.top = `${startY}px`;
            selection.style.width = '0';
            selection.style.height = '0';
        });
        overlay.addEventListener('mousemove', (event) => {
            if (!selecting || !selection) return;
            selection.style.left = `${Math.min(startX, event.clientX)}px`;
            selection.style.top = `${Math.min(startY, event.clientY)}px`;
            selection.style.width = `${Math.abs(event.clientX - startX)}px`;
            selection.style.height = `${Math.abs(event.clientY - startY)}px`;
        });
        overlay.addEventListener('mouseup', () => {
            selecting = false;
            if (!selection) return;
            const rect = selection.getBoundingClientRect();
            const dataUrl = screenshotDataUrl;
            close();
            if (rect.width > 10 && rect.height > 10 && dataUrl) crop(rect, dataUrl);
        });
    };

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && overlay) close();
    });
    return {
        open: (screenshotUrl) => {
            if (!options.isEnabled()) return;
            screenshotDataUrl = screenshotUrl;
            if (screenshotDataUrl) open();
        },
    };
}
