export type OptionalContentFeature = 'adaptive' | 'liveProofread' | 'ocr';

export const OCR_START_EVENT = 'lexisync:ocr-start';
export const OCR_IMAGE_EVENT = 'lexisync:ocr-image';

// Приватная шина событий внутри изолированного мира расширения (недоступна скриптам страницы)
const internalRuntime = globalThis as typeof globalThis & { __lexisyncIsolatedBus?: EventTarget };
export const isolatedContentBus: EventTarget = (internalRuntime.__lexisyncIsolatedBus ??= new EventTarget());

export async function ensureOptionalContentFeature(feature: OptionalContentFeature): Promise<void> {
    const response = await chrome.runtime.sendMessage({ action: 'ensureOptionalContentFeature', feature });
    if (response?.ok !== true) throw new Error(response?.error || 'OPTIONAL_CONTENT_FEATURE_FAILED');
}
