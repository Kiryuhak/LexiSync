import { t } from './i18n';

export const SETTINGS_TAB_GUIDES = {
    main: {
        icon: '✦',
        titleKey: 'tabGuideMainTitle',
        title: 'Начните с основных параметров',
        descriptionKey: 'tabGuideMainDescription',
        description: 'Подключите Mistral или Groq, выберите основной сервис и стиль ответа.',
    },
    ai: {
        icon: '◆',
        titleKey: 'tabGuideAiTitle',
        title: 'Управляйте качеством и расходом',
        descriptionKey: 'tabGuideAiDescription',
        description: 'Выберите экономный или сбалансированный режим и при необходимости задайте защитные лимиты.',
    },
    appearance: {
        icon: '◐',
        titleKey: 'tabGuideAppearanceTitle',
        title: 'Настройте LexiSync под себя',
        descriptionKey: 'tabGuideAppearanceDescription',
        description: 'Меняйте тему, стиль окон, размер интерфейса, плотность и прозрачность.',
    },
    suggestions: {
        icon: '✧',
        titleKey: 'tabGuideSuggestionsTitle',
        title: 'Помощь прямо во время ввода',
        descriptionKey: 'tabGuideSuggestionsDescription',
        description: 'Управляйте локальными подсказками и автоматической проверкой текста.',
    },
    privacy: {
        icon: '◈',
        titleKey: 'tabGuidePrivacyTitle',
        title: 'Ваши данные под контролем',
        descriptionKey: 'tabGuidePrivacyDescription',
        description: 'Решите, что сохранять, какие сайты исключить и когда передавать контекст страницы.',
    },
    commands: {
        icon: '⌘',
        titleKey: 'tabGuideCommandsTitle',
        title: 'Соберите свои быстрые действия',
        descriptionKey: 'tabGuideCommandsDescription',
        description: 'Создавайте понятные команды для повторяющихся задач с текстом.',
    },
    guide: {
        icon: '▶',
        titleKey: 'tabGuideInteractiveTitle',
        title: 'Интерактивное руководство по возможностям',
        descriptionKey: 'tabGuideInteractiveDescription',
        description: 'Нажмите на любую кнопку или действие, чтобы увидеть живую анимацию и сочетания клавиш.',
    },
} as const;

export type SettingsTabName = keyof typeof SETTINGS_TAB_GUIDES;

export function updateSettingsTabGuide(tabName: string): void {
    const selectedTab = tabName in SETTINGS_TAB_GUIDES ? (tabName as SettingsTabName) : 'main';
    const guide = SETTINGS_TAB_GUIDES[selectedTab];
    const panel = document.getElementById('settingsSectionGuide');
    const icon = document.getElementById('settingsSectionGuideIcon');
    const title = document.getElementById('settingsSectionGuideTitle');
    const description = document.getElementById('settingsSectionGuideDescription');
    if (!panel || !icon || !title || !description) return;
    panel.dataset.section = selectedTab;
    document.querySelector<HTMLElement>('.container')?.setAttribute('data-active-tab', selectedTab);
    icon.textContent = guide.icon;
    title.textContent = t(guide.titleKey, guide.title);
    description.textContent = t(guide.descriptionKey, guide.description);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        panel.animate(
            [
                { opacity: 0.72, transform: 'translateY(4px)' },
                { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        );
    }
}

export function activateSettingsTab(tabName: string): void {
    document.querySelectorAll<HTMLElement>('[data-settings-group]').forEach((element) => {
        element.hidden = element.dataset.settingsGroup !== tabName;
    });
    const saveActions = document.getElementById('saveActions');
    if (saveActions) saveActions.hidden = tabName === 'commands' || tabName === 'guide';
    document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
        const active = button.dataset.tab === tabName;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
    });
    updateSettingsTabGuide(tabName);
}

export function setupSettingsSearch(): void {
    const searchInput = document.getElementById('settingsSearchInput') as HTMLInputElement | null;
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        const activeTabButton = document.querySelector<HTMLButtonElement>('.settings-tab.is-active');
        const activeTab = activeTabButton?.dataset.tab || 'main';

        if (!query) {
            activateSettingsTab(activeTab);
            return;
        }

        document.querySelectorAll<HTMLElement>('[data-settings-group]').forEach((element) => {
            const text = element.textContent?.toLowerCase() || '';
            element.hidden = !text.includes(query);
        });
    });
}

export function setupSettingsTabs(): void {
    document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
        button.addEventListener('click', () => {
            const searchInput = document.getElementById('settingsSearchInput') as HTMLInputElement | null;
            if (searchInput && searchInput.value) {
                searchInput.value = '';
            }
            activateSettingsTab(button.dataset.tab || 'main');
        });
        button.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const tabs = [...document.querySelectorAll<HTMLButtonElement>('.settings-tab')];
            const currentIndex = tabs.indexOf(button);
            const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
            const next = tabs[(currentIndex + offset + tabs.length) % tabs.length];
            if (next) {
                const searchInput = document.getElementById('settingsSearchInput') as HTMLInputElement | null;
                if (searchInput && searchInput.value) {
                    searchInput.value = '';
                }
                activateSettingsTab(next.dataset.tab || 'main');
                next.focus();
            }
        });
    });
    setupSettingsSearch();
    activateSettingsTab('main');
}
