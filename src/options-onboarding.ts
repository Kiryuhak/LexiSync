import { t } from './i18n';
import { validateApiKey, validateCloudflareCredentials } from './ai-settings-client';
import { logger } from './logger';
import { restoreEncryptedBackup } from './crypto-backup';
import { downloadBackupFromGoogleDrive } from './google-drive-sync';
import { isGoogleDriveAuthConfigured, withGoogleDriveAuth } from './google-drive-auth';
import { getStoredApiKey, getStoredCloudflareCredentials } from './secret-store';

export interface OnboardingOptions {
    getApiKey: () => string;
    getCloudflareCredentials?: () => { accountId: string; apiToken: string };
    onApiKeySaved: (key: string) => Promise<void>;
    onCloudflareCredentialsSaved?: (creds: { accountId: string; apiToken: string }) => Promise<void>;
}

export async function setupOnboarding(options: OnboardingOptions): Promise<void> {
    const onboarding = document.getElementById('onboarding');
    const nextButton = document.getElementById('onboardingNext') as HTMLButtonElement | null;
    const skipButton = document.getElementById('onboardingSkip') as HTMLButtonElement | null;
    const openButton = document.getElementById('openOnboarding') as HTMLButtonElement | null;

    // Step 1 elements (Cloud sync and restore)
    const masterPasswordInput = document.getElementById('onboardingMasterPassword') as HTMLInputElement | null;
    const restoreDriveButton = document.getElementById('onboardingRestoreDrive') as HTMLButtonElement | null;
    const restoreFileButton = document.getElementById('onboardingRestoreFile') as HTMLButtonElement | null;
    const fileInput = document.getElementById('onboardingFileInput') as HTMLInputElement | null;
    const manualSkipButton = document.getElementById('onboardingManualSkip') as HTMLButtonElement | null;
    const syncStatus = document.getElementById('onboardingSyncStatus');

    // Step 2 elements (Mistral)
    const keyInput = document.getElementById('onboardingApiKey') as HTMLInputElement | null;
    const saveKeyButton = document.getElementById('onboardingSaveKey') as HTMLButtonElement | null;
    const keyStatus = document.getElementById('onboardingKeyStatus');

    // Step 3 elements (Cloudflare)
    const cloudflareAccountIdInput = document.getElementById(
        'onboardingCloudflareAccountId',
    ) as HTMLInputElement | null;
    const cloudflareApiTokenInput = document.getElementById('onboardingCloudflareApiToken') as HTMLInputElement | null;
    const saveCloudflareKeyButton = document.getElementById('onboardingSaveCloudflareKey') as HTMLButtonElement | null;
    const cloudflareKeyStatus = document.getElementById('onboardingCloudflareKeyStatus');

    const progress = document.getElementById('onboardingProgress');
    const progressBar = document.getElementById('onboardingProgressBar') as HTMLElement | null;
    const steps = [...document.querySelectorAll<HTMLElement>('[data-onboarding-step]')];
    if (!onboarding || !nextButton || !skipButton || !progress || steps.length === 0) return;
    const stored = await chrome.storage.local.get({ onboardingCompleted: false });
    const googleDriveConfigured = isGoogleDriveAuthConfigured();

    let activeStep = 0;
    let previousFocus: HTMLElement | null = null;
    const render = () => {
        steps.forEach((step, index) => step.classList.toggle('is-active', index === activeStep));
        onboarding.dataset.provider = activeStep === 2 ? 'mistral' : activeStep === 3 ? 'cloudflare' : 'neutral';
        progress.textContent = `${activeStep + 1} ${t('of', 'из')} ${steps.length}`;
        if (progressBar) progressBar.style.width = `${((activeStep + 1) / steps.length) * 100}%`;
        nextButton.textContent = activeStep === steps.length - 1 ? t('start', 'Начать работу') : t('next', 'Далее');
    };
    const open = () => {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        activeStep = 0;
        if (masterPasswordInput) masterPasswordInput.value = '';
        if (syncStatus) {
            if (googleDriveConfigured) {
                syncStatus.textContent = '';
                delete syncStatus.dataset.kind;
            } else {
                syncStatus.textContent = t('googleDriveUnavailable', 'Вход Google не настроен в этой сборке');
                syncStatus.dataset.kind = 'error';
            }
        }
        if (restoreDriveButton) restoreDriveButton.disabled = !googleDriveConfigured;
        if (keyInput) keyInput.value = options.getApiKey() || '';
        const creds = options.getCloudflareCredentials?.();
        if (cloudflareAccountIdInput) cloudflareAccountIdInput.value = creds?.accountId || '';
        if (cloudflareApiTokenInput) cloudflareApiTokenInput.value = creds?.apiToken || '';
        if (keyStatus) {
            keyStatus.textContent = '';
            delete keyStatus.dataset.kind;
        }
        if (cloudflareKeyStatus) {
            cloudflareKeyStatus.textContent = '';
            delete cloudflareKeyStatus.dataset.kind;
        }
        onboarding.hidden = false;
        render();
        nextButton.focus();
    };
    const complete = async () => {
        onboarding.hidden = true;
        await chrome.storage.local.set({ onboardingCompleted: true });
        previousFocus?.focus();
    };
    nextButton.addEventListener('click', () => {
        if (activeStep >= steps.length - 1) void complete();
        else {
            activeStep++;
            render();
        }
    });
    skipButton.addEventListener('click', () => void complete());
    openButton?.addEventListener('click', open);

    const handleRestoreData = async (encryptedJson: string, masterPassword: string) => {
        const result = await restoreEncryptedBackup(encryptedJson, masterPassword);
        if (result.hasMistralKey) {
            const restoredKey = await getStoredApiKey();
            if (keyInput) keyInput.value = restoredKey;
            await options.onApiKeySaved(restoredKey);
        }
        if (result.hasCloudflareCreds) {
            const creds = await getStoredCloudflareCredentials();
            if (cloudflareAccountIdInput) cloudflareAccountIdInput.value = creds.accountId || '';
            if (cloudflareApiTokenInput) cloudflareApiTokenInput.value = creds.apiToken || '';
            if (options.onCloudflareCredentialsSaved) {
                await options.onCloudflareCredentialsSaved(creds);
            }
        }
        return result;
    };

    manualSkipButton?.addEventListener('click', () => {
        activeStep = 2;
        render();
        keyInput?.focus();
    });

    restoreDriveButton?.addEventListener('click', async () => {
        if (!syncStatus) return;
        const masterPassword = masterPasswordInput?.value.trim() || '';
        if (!masterPassword) {
            syncStatus.textContent = t(
                'masterPasswordRequired',
                'Введите мастер-пароль для расшифровки или создания резервной копии.',
            );
            syncStatus.dataset.kind = 'error';
            masterPasswordInput?.focus();
            return;
        }
        const originalText = restoreDriveButton.textContent;
        restoreDriveButton.disabled = true;
        restoreDriveButton.textContent = t('backupDownloading', 'Загрузка резервной копии из Google Drive…');
        syncStatus.textContent = '';
        delete syncStatus.dataset.kind;

        try {
            const { content } = await withGoogleDriveAuth((token) => downloadBackupFromGoogleDrive(token));
            await handleRestoreData(content, masterPassword);
            syncStatus.textContent = t('backupRestoredSuccess', 'Настройки и ключи успешно восстановлены!');
            syncStatus.dataset.kind = 'success';
        } catch (error) {
            logger.error('Ошибка восстановления из Google Drive в онбординге:', error);
            const msg = error instanceof Error ? error.message : '';
            if (msg === 'INVALID_PASSWORD') {
                syncStatus.textContent = t(
                    'backupInvalidPassword',
                    'Неверный мастер-пароль. Не удалось расшифровать данные.',
                );
            } else if (msg === 'FILE_NOT_FOUND') {
                syncStatus.textContent = t(
                    'backupFileNotFound',
                    'Резервная копия не найдена в Google Drive (папка приложения пуста).',
                );
            } else if (
                msg === 'UNAUTHORIZED' ||
                msg === 'NO_TOKEN' ||
                msg === 'AUTH_FAILED' ||
                msg === 'AUTH_STATE_MISMATCH'
            ) {
                syncStatus.textContent = t(
                    'backupUnauthorized',
                    'Не удалось войти в Google Drive. Повторите подключение.',
                );
            } else if (msg === 'OAUTH_NOT_CONFIGURED') {
                syncStatus.textContent = t('googleDriveUnavailable', 'Вход Google не настроен в этой сборке');
            } else if (msg === 'AUTH_CANCELLED') {
                syncStatus.textContent = t(
                    'googleDriveAuthCancelled',
                    'Вход в Google Drive отменён. Попробуйте ещё раз.',
                );
            } else if (msg === 'NETWORK_ERROR') {
                syncStatus.textContent = t(
                    'backupNetworkError',
                    'Сетевая ошибка при обращении к Google Drive. Проверьте соединение.',
                );
            } else {
                syncStatus.textContent = t(
                    'backupCorrupted',
                    'Файл резервной копии повреждён или имеет неизвестный формат.',
                );
            }
            syncStatus.dataset.kind = 'error';
        } finally {
            restoreDriveButton.disabled = !googleDriveConfigured;
            restoreDriveButton.textContent = originalText;
        }
    });

    restoreFileButton?.addEventListener('click', () => {
        fileInput?.click();
    });

    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file || !syncStatus) return;
        const masterPassword = masterPasswordInput?.value.trim() || '';
        if (!masterPassword) {
            syncStatus.textContent = t(
                'masterPasswordRequired',
                'Введите мастер-пароль для расшифровки или создания резервной копии.',
            );
            syncStatus.dataset.kind = 'error';
            masterPasswordInput?.focus();
            fileInput.value = '';
            return;
        }
        try {
            const text = await file.text();
            await handleRestoreData(text, masterPassword);
            syncStatus.textContent = t('backupRestoredSuccess', 'Настройки и ключи успешно восстановлены!');
            syncStatus.dataset.kind = 'success';
        } catch (error) {
            logger.error('Ошибка восстановления из файла в онбординге:', error);
            const msg = error instanceof Error ? error.message : '';
            if (msg === 'INVALID_PASSWORD') {
                syncStatus.textContent = t(
                    'backupInvalidPassword',
                    'Неверный мастер-пароль. Не удалось расшифровать данные.',
                );
            } else {
                syncStatus.textContent = t(
                    'backupCorrupted',
                    'Файл резервной копии повреждён или имеет неизвестный формат.',
                );
            }
            syncStatus.dataset.kind = 'error';
        } finally {
            fileInput.value = '';
        }
    });

    saveKeyButton?.addEventListener('click', async () => {
        if (!keyInput || !keyStatus) return;
        const apiKey = keyInput.value.trim();
        if (!apiKey) {
            keyStatus.textContent = t('tutorialKeyRequired', 'Сначала вставьте API-ключ.');
            keyStatus.dataset.kind = 'error';
            keyInput.focus();
            return;
        }
        const originalText = saveKeyButton.textContent;
        saveKeyButton.disabled = true;
        saveKeyButton.textContent = t('checkingKey', 'Проверка…');
        keyStatus.textContent = '';
        delete keyStatus.dataset.kind;
        try {
            const validation = await validateApiKey(apiKey);
            if (validation.ok) {
                await options.onApiKeySaved(apiKey);
                keyStatus.textContent = validation.message;
                keyStatus.dataset.kind = 'success';
                return;
            }
            keyStatus.textContent = validation.message;
            keyStatus.dataset.kind = 'error';
        } catch (error) {
            logger.error('Ошибка проверки API-ключа Mistral в обучении', error);
            keyStatus.textContent = t('keyCheckUnavailable', 'Сейчас не удалось проверить ключ. Попробуйте ещё раз.');
            keyStatus.dataset.kind = 'error';
        } finally {
            saveKeyButton.disabled = false;
            saveKeyButton.textContent = originalText;
        }
    });

    saveCloudflareKeyButton?.addEventListener('click', async () => {
        if (!cloudflareAccountIdInput || !cloudflareApiTokenInput || !cloudflareKeyStatus) return;
        const accountId = cloudflareAccountIdInput.value.trim();
        const apiToken = cloudflareApiTokenInput.value.trim();
        if (!accountId || !apiToken) {
            cloudflareKeyStatus.textContent = t(
                'tutorialCloudflareKeyRequired',
                'Введите Cloudflare Account ID и API Token.',
            );
            cloudflareKeyStatus.dataset.kind = 'error';
            if (!accountId) cloudflareAccountIdInput.focus();
            else cloudflareApiTokenInput.focus();
            return;
        }
        const originalText = saveCloudflareKeyButton.textContent;
        saveCloudflareKeyButton.disabled = true;
        saveCloudflareKeyButton.textContent = t('checkingKey', 'Проверка…');
        cloudflareKeyStatus.textContent = '';
        delete cloudflareKeyStatus.dataset.kind;
        try {
            const validation = await validateCloudflareCredentials({ accountId, apiToken });
            if (validation.ok) {
                if (options.onCloudflareCredentialsSaved) {
                    await options.onCloudflareCredentialsSaved({ accountId, apiToken });
                }
                cloudflareKeyStatus.textContent = validation.message;
                cloudflareKeyStatus.dataset.kind = 'success';
                return;
            }
            cloudflareKeyStatus.textContent = validation.message;
            cloudflareKeyStatus.dataset.kind = 'error';
        } catch (error) {
            logger.error('Ошибка проверки ключей Cloudflare Workers AI в обучении', error);
            cloudflareKeyStatus.textContent = t(
                'keyCheckUnavailable',
                'Сейчас не удалось проверить ключ. Попробуйте ещё раз.',
            );
            cloudflareKeyStatus.dataset.kind = 'error';
        } finally {
            saveCloudflareKeyButton.disabled = false;
            saveCloudflareKeyButton.textContent = originalText;
        }
    });

    onboarding.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            void complete();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [
            ...onboarding.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'),
        ].filter((element) => element.offsetParent !== null && !element.hasAttribute('disabled'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first && last) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last && first) {
            event.preventDefault();
            first.focus();
        }
    });

    const forcedByUrl = new URLSearchParams(window.location.search).get('tutorial') === '1';
    if (stored.onboardingCompleted !== true || forcedByUrl) open();
}
