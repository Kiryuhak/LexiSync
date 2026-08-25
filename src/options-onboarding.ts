import { t } from './i18n';
import { validateApiKey } from './mistral-client';
import { validateGroqApiKey } from './groq-client';
import { logger } from './logger';

export interface OnboardingOptions {
    getApiKey: () => string;
    getGroqApiKey?: () => string;
    onApiKeySaved: (key: string) => Promise<void>;
    onGroqApiKeySaved?: (key: string) => Promise<void>;
}

export async function setupOnboarding(options: OnboardingOptions): Promise<void> {
    const onboarding = document.getElementById('onboarding');
    const nextButton = document.getElementById('onboardingNext') as HTMLButtonElement | null;
    const skipButton = document.getElementById('onboardingSkip') as HTMLButtonElement | null;
    const openButton = document.getElementById('openOnboarding') as HTMLButtonElement | null;
    const keyInput = document.getElementById('onboardingApiKey') as HTMLInputElement | null;
    const saveKeyButton = document.getElementById('onboardingSaveKey') as HTMLButtonElement | null;
    const keyStatus = document.getElementById('onboardingKeyStatus');
    const groqKeyInput = document.getElementById('onboardingGroqApiKey') as HTMLInputElement | null;
    const saveGroqKeyButton = document.getElementById('onboardingSaveGroqKey') as HTMLButtonElement | null;
    const groqKeyStatus = document.getElementById('onboardingGroqKeyStatus');
    const progress = document.getElementById('onboardingProgress');
    const progressBar = document.getElementById('onboardingProgressBar') as HTMLElement | null;
    const steps = [...document.querySelectorAll<HTMLElement>('[data-onboarding-step]')];
    if (!onboarding || !nextButton || !skipButton || !progress || steps.length === 0) return;
    const stored = await chrome.storage.local.get({ onboardingCompleted: false });

    let activeStep = 0;
    let previousFocus: HTMLElement | null = null;
    const render = () => {
        steps.forEach((step, index) => step.classList.toggle('is-active', index === activeStep));
        onboarding.dataset.provider = activeStep === 1 ? 'mistral' : activeStep === 2 ? 'groq' : 'neutral';
        progress.textContent = `${activeStep + 1} ${t('of', 'из')} ${steps.length}`;
        if (progressBar) progressBar.style.width = `${((activeStep + 1) / steps.length) * 100}%`;
        nextButton.textContent = activeStep === steps.length - 1 ? t('start', 'Начать работу') : t('next', 'Далее');
    };
    const open = () => {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        activeStep = 0;
        if (keyInput) keyInput.value = options.getApiKey() || '';
        if (groqKeyInput) groqKeyInput.value = options.getGroqApiKey?.() || '';
        if (keyStatus) {
            keyStatus.textContent = '';
            delete keyStatus.dataset.kind;
        }
        if (groqKeyStatus) {
            groqKeyStatus.textContent = '';
            delete groqKeyStatus.dataset.kind;
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
    saveGroqKeyButton?.addEventListener('click', async () => {
        if (!groqKeyInput || !groqKeyStatus) return;
        const apiKey = groqKeyInput.value.trim();
        if (!apiKey) {
            groqKeyStatus.textContent = t('tutorialGroqKeyRequired', 'Сначала вставьте API-ключ Groq.');
            groqKeyStatus.dataset.kind = 'error';
            groqKeyInput.focus();
            return;
        }
        const originalText = saveGroqKeyButton.textContent;
        saveGroqKeyButton.disabled = true;
        saveGroqKeyButton.textContent = t('checkingKey', 'Проверка…');
        groqKeyStatus.textContent = '';
        delete groqKeyStatus.dataset.kind;
        try {
            const validation = await validateGroqApiKey(apiKey);
            if (validation.ok) {
                if (options.onGroqApiKeySaved) {
                    await options.onGroqApiKeySaved(apiKey);
                }
                groqKeyStatus.textContent = validation.message;
                groqKeyStatus.dataset.kind = 'success';
                return;
            }
            groqKeyStatus.textContent = validation.message;
            groqKeyStatus.dataset.kind = 'error';
        } catch (error) {
            logger.error('Ошибка проверки API-ключа Groq в обучении', error);
            groqKeyStatus.textContent = t(
                'keyCheckUnavailable',
                'Сейчас не удалось проверить ключ. Попробуйте ещё раз.',
            );
            groqKeyStatus.dataset.kind = 'error';
        } finally {
            saveGroqKeyButton.disabled = false;
            saveGroqKeyButton.textContent = originalText;
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
