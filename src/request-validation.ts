import { t } from './i18n';
import type { MistralRequest } from './mistral-client';
import type { RequestMode } from './types';

const ALLOWED_MODES = new Set<RequestMode>([
    'spellcheck',
    'style',
    'emoji',
    'layout',
    'translate',
    'summary',
    'reply',
    'explain',
    'format',
    'ocr',
    'custom',
]);
const MAX_TEXT_LENGTH = 50_000;
const MAX_CONTEXT_LENGTH = 12_000;
const MAX_CUSTOM_PROMPT_LENGTH = 2_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const OCR_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,([a-z\d+/]+={0,2})$/i;

type ValidationLengthError =
    'requestTextTooLong' | 'requestContextTooLong' | 'requestCustomPromptTooLong' | 'requestPageDataTooLong';

function getLengthError(key: ValidationLengthError): string {
    if (key === 'requestTextTooLong') return t('requestTextTooLong', 'Выбранный текст слишком длинный.');
    if (key === 'requestContextTooLong') return t('requestContextTooLong', 'Контекст страницы слишком длинный.');
    if (key === 'requestCustomPromptTooLong')
        return t('requestCustomPromptTooLong', 'Инструкция пользовательской команды слишком длинная.');
    return t('requestPageDataTooLong', 'Данные страницы слишком длинные.');
}

function assertOptionalString(value: unknown, maxLength: number, errorKey: ValidationLengthError): void {
    if (value === undefined) return;
    if (typeof value !== 'string' || value.length > maxLength) throw new Error(getLengthError(errorKey));
}

export function validateMistralRequest(value: unknown): asserts value is MistralRequest {
    if (!value || typeof value !== 'object') throw new Error(t('requestInvalid', 'Некорректный запрос.'));
    const request = value as Partial<MistralRequest>;
    if (request.action !== 'callMistral') throw new Error(t('requestInvalid', 'Некорректный запрос.'));
    if (!request.mode || !ALLOWED_MODES.has(request.mode))
        throw new Error(t('requestModeInvalid', 'Указан недопустимый режим обработки.'));

    assertOptionalString(request.text, MAX_TEXT_LENGTH, 'requestTextTooLong');
    assertOptionalString(request.context, MAX_CONTEXT_LENGTH, 'requestContextTooLong');
    assertOptionalString(request.customPrompt, MAX_CUSTOM_PROMPT_LENGTH, 'requestCustomPromptTooLong');
    assertOptionalString(request.pageTitle, 500, 'requestPageDataTooLong');
    assertOptionalString(request.pageUrl, 2_048, 'requestPageDataTooLong');
    if (request.targetLang !== undefined && (typeof request.targetLang !== 'string' || request.targetLang.length > 50))
        throw new Error(t('requestInvalid', 'Некорректный запрос.'));

    if (request.mode !== 'ocr' && (typeof request.text !== 'string' || !request.text.trim()))
        throw new Error(t('requestTextMissing', 'Текст для обработки не получен.'));
    if (request.mode === 'custom' && (typeof request.customPrompt !== 'string' || !request.customPrompt.trim()))
        throw new Error(t('requestCustomPromptMissing', 'Инструкция пользовательской команды пуста.'));
    if (request.mode === 'ocr') {
        if (typeof request.imageUrl !== 'string')
            throw new Error(t('ocrImageInvalid', 'Некорректное изображение для распознавания.'));
        const match = OCR_DATA_URL.exec(request.imageUrl);
        if (!match) throw new Error(t('ocrImageInvalid', 'Некорректное изображение для распознавания.'));
        const padding = match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0;
        const byteLength = Math.floor((match[1].length * 3) / 4) - padding;
        if (byteLength > MAX_IMAGE_BYTES)
            throw new Error(t('ocrImageTooLarge', 'Изображение для распознавания слишком большое.'));
    } else if (request.imageUrl !== undefined) {
        throw new Error(t('ocrImageInvalid', 'Некорректное изображение для распознавания.'));
    }
}
