const ALLOWED_INPUT_TYPES = new Set(['text', 'search']);

const SENSITIVE_FIELD_IDENTITY =
    /(?:^|[^\p{L}\p{N}])(?:address|api[\s_-]*key|auth(?:entication)?|bank[\s_-]*card|card[\s_-]*(?:number|holder)|credential|credit[\s_-]*card|cvv|cvc|e[\s_-]*mail|email|first[\s_-]*name|full[\s_-]*name|last[\s_-]*name|login|name|one[\s_-]*time|otp|pass(?:phrase|word|wd)|phone|pin(?:[\s_-]*code)?|secret|security[\s_-]*code|token|user[\s_-]*name|username|адрес\p{L}*|логин\p{L}*|номер\p{L}*[\s_-]*карт\p{L}*|парол\p{L}*|пин|почт\p{L}*|телефон\p{L}*)(?=$|[^\p{L}\p{N}])/iu;

const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
    'name',
    'honorific-prefix',
    'given-name',
    'additional-name',
    'family-name',
    'honorific-suffix',
    'nickname',
    'username',
    'new-password',
    'current-password',
    'one-time-code',
    'organization-title',
    'organization',
    'street-address',
    'address-line1',
    'address-line2',
    'address-line3',
    'address-level1',
    'address-level2',
    'address-level3',
    'address-level4',
    'country',
    'country-name',
    'postal-code',
    'cc-name',
    'cc-given-name',
    'cc-additional-name',
    'cc-family-name',
    'cc-number',
    'cc-exp',
    'cc-exp-month',
    'cc-exp-year',
    'cc-csc',
    'cc-type',
    'transaction-currency',
    'transaction-amount',
    'bday',
    'bday-day',
    'bday-month',
    'bday-year',
    'sex',
    'url',
    'photo',
    'tel',
    'tel-country-code',
    'tel-national',
    'tel-area-code',
    'tel-local',
    'tel-local-prefix',
    'tel-local-suffix',
    'tel-extension',
    'email',
    'impp',
]);

export function shouldUseAutomaticTextFeatures(
    inputType: string | null,
    autocomplete: string,
    fieldIdentity = '',
): boolean {
    if (inputType !== null && !ALLOWED_INPUT_TYPES.has(inputType.toLowerCase())) return false;
    if (
        autocomplete
            .toLowerCase()
            .split(/\s+/)
            .some((token) => SENSITIVE_AUTOCOMPLETE_TOKENS.has(token))
    )
        return false;
    const normalizedIdentity = fieldIdentity.replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2');
    return !SENSITIVE_FIELD_IDENTITY.test(normalizedIdentity);
}

export function shouldAutoProofreadField(inputType: string | null, autocomplete: string, fieldIdentity = ''): boolean {
    return shouldUseAutomaticTextFeatures(inputType, autocomplete, fieldIdentity);
}
