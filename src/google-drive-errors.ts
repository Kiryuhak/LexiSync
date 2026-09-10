import { t } from './i18n';

export const GOOGLE_DRIVE_ERROR = {
    AUTH: 'AUTH_ERROR',
    API_NOT_ENABLED: 'DRIVE_API_NOT_ENABLED',
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    RATE_LIMIT: 'RATE_LIMIT',
    FORBIDDEN: 'DRIVE_FORBIDDEN',
    NETWORK: 'NETWORK_ERROR',
    TIMEOUT: 'TIMEOUT',
} as const;

export function describeGoogleDriveError(error: unknown): string {
    const code = error instanceof Error ? error.message : '';
    if (code === 'OAUTH_NOT_CONFIGURED') {
        return t('googleDriveUnavailable', 'Вход Google не настроен в этой сборке');
    }
    if (code === 'AUTH_CANCELLED') {
        return t('googleDriveAuthCancelled', 'Вход в Google Drive отменён. Попробуйте ещё раз.');
    }
    if (
        code === GOOGLE_DRIVE_ERROR.AUTH ||
        code === 'AUTH_STATE_MISMATCH' ||
        code === 'AUTH_FAILED' ||
        code === 'NO_TOKEN'
    ) {
        return t('googleDriveAuthError', 'Требуется повторный вход в Google Drive.');
    }
    if (code === GOOGLE_DRIVE_ERROR.API_NOT_ENABLED) {
        return t('googleDriveApiNotEnabled', 'Google Drive API не включён для проекта.');
    }
    if (code === GOOGLE_DRIVE_ERROR.INSUFFICIENT_PERMISSIONS) {
        return t('googleDriveInsufficientPermissions', 'Недостаточно разрешений для доступа к резервной копии.');
    }
    if (code === GOOGLE_DRIVE_ERROR.RATE_LIMIT) {
        return t('googleDriveRateLimit', 'Google Drive временно ограничил запросы. Попробуйте позже.');
    }
    if (code === GOOGLE_DRIVE_ERROR.FORBIDDEN) {
        return t('googleDriveForbidden', 'Google Drive отклонил запрос. Проверьте доступ к резервной копии.');
    }
    if (code === GOOGLE_DRIVE_ERROR.TIMEOUT) {
        return t('googleDriveTimeout', 'Google Drive не ответил вовремя. Попробуйте позже.');
    }
    if (code === GOOGLE_DRIVE_ERROR.NETWORK) {
        return t('backupNetworkError', 'Сетевая ошибка при обращении к Google Drive. Проверьте соединение.');
    }
    if (code.startsWith('DRIVE_API_ERROR:')) {
        return t('googleDriveApiError', 'Google Drive временно недоступен. Попробуйте позже.');
    }
    return t('backupCorrupted', 'Файл резервной копии повреждён или имеет неизвестный формат.');
}
