import { initializeOcrOverlay } from '../src/ocr-overlay';
import { OCR_IMAGE_EVENT, OCR_START_EVENT } from '../src/optional-content-features';

export default defineUnlistedScript(() => {
    const runtime = globalThis as typeof globalThis & { __lexisyncOcrInitialized?: boolean };
    if (runtime.__lexisyncOcrInitialized) return;
    runtime.__lexisyncOcrInitialized = true;

    const controller = initializeOcrOverlay({
        isEnabled: () => true,
        onImage: (imageUrl, rect) => {
            document.dispatchEvent(
                new CustomEvent(OCR_IMAGE_EVENT, {
                    detail: {
                        imageUrl,
                        rect: { left: rect.left, bottom: rect.bottom, width: rect.width, height: rect.height },
                    },
                }),
            );
        },
    });
    document.addEventListener(OCR_START_EVENT, (event) => {
        const screenshotUrl = (event as CustomEvent<{ screenshotUrl?: unknown }>).detail?.screenshotUrl;
        if (typeof screenshotUrl === 'string' && screenshotUrl) controller.open(screenshotUrl);
    });
});
