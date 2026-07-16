import { defineConfig } from 'wxt';

export default defineConfig({
    manifestVersion: 3,
    targetBrowsers: ['chrome', 'firefox'],
    manifest: ({ browser }) => ({
        name: '__MSG_extName__',
        description: '__MSG_extDesc__',
        default_locale: 'ru',
        permissions: [
            'storage',
            'activeTab',
            'contextMenus',
            'clipboardRead',
            'clipboardWrite',
        ],
        host_permissions: ['https://api.mistral.ai/*'],
        commands: {
            spellcheck: {
                suggested_key: { default: 'Alt+R', mac: 'Alt+R' },
                description: 'Исправить ошибки',
            },
            style: {
                suggested_key: { default: 'Alt+Y', mac: 'Alt+Y' },
                description: 'Переписать текст',
            },
            emoji: {
                suggested_key: { default: 'Alt+T', mac: 'Alt+T' },
                description: 'Подобрать эмодзи',
            },
            ocr: {
                suggested_key: { default: 'Alt+S', mac: 'Alt+S' },
                description: 'Распознать текст на экране',
            },
        },
        icons: {
            16: 'icons/icon-16.png',
            48: 'icons/icon-48.png',
            128: 'icons/icon-128.png',
        },
        action: {
            default_icon: {
                16: 'icons/icon-16.png',
                48: 'icons/icon-48.png',
                128: 'icons/icon-128.png',
            },
            default_title: 'LexiSync',
        },
        browser_specific_settings: browser === 'firefox' ? {
            gecko: {
                id: 'lexisync@kiryuhak.dev',
                strict_min_version: '142.0',
                data_collection_permissions: {
                    required: ['websiteContent', 'browsingActivity'],
                },
            },
        } : undefined,
    }),
    zip: {
        artifactTemplate: 'LexiSync-v{{version}}-{{browser}}.zip',
    },
});
