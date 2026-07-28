export type OptionalContentFeature = 'adaptive' | 'ocr';

export const OCR_START_EVENT = 'lexisync:ocr-start';
export const OCR_IMAGE_EVENT = 'lexisync:ocr-image';

export async function ensureOptionalContentFeature(feature: OptionalContentFeature): Promise<void> {
    const response = await chrome.runtime.sendMessage({ action: 'ensureOptionalContentFeature', feature });
    if (response?.ok !== true) throw new Error(response?.error || 'OPTIONAL_CONTENT_FEATURE_FAILED');
}
