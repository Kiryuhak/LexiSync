import { defineConfig } from 'wxt';

const includeE2eHostAccess = process.env.LEXISYNC_E2E_HOST_ACCESS === '1';
const WEB_ORIGINS = ['http://*/*', 'https://*/*'];

export default defineConfig({
    manifestVersion: 3,
    targetBrowsers: ['chrome', 'firefox'],
    vite: () => ({
        build: {
            // Chrome помечает preload общих чанков extension-страницы как cross-world mismatch.
            // Модули остаются разбитыми на чанки и загружаются штатными import без ложных ошибок.
            modulePreload: false,
        },
    }),
    manifest: ({ browser }) => ({
        name: '__MSG_extName__',
        description: '__MSG_extDesc__',
        default_locale: 'ru',
        permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
        host_permissions: [
            'https://api.mistral.ai/*',
            'https://api.groq.com/*',
            ...(includeE2eHostAccess ? WEB_ORIGINS : []),
        ],
        optional_host_permissions: includeE2eHostAccess ? [] : WEB_ORIGINS,
        commands: {
            spellcheck: {
                suggested_key: { default: 'Alt+R', mac: 'Alt+R' },
                description: '__MSG_commandSpellcheck__',
            },
            style: {
                suggested_key: { default: 'Alt+Y', mac: 'Alt+Y' },
                description: '__MSG_commandStyle__',
            },
            emoji: {
                suggested_key: { default: 'Alt+T', mac: 'Alt+T' },
                description: '__MSG_commandEmoji__',
            },
            ocr: {
                suggested_key: { default: 'Alt+S', mac: 'Alt+S' },
                description: '__MSG_commandOcr__',
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
            default_title: '__MSG_extName__',
        },
        browser_specific_settings:
            browser === 'firefox'
                ? {
                      gecko: {
                          id: 'lexisync@kiryuhak.dev',
                          // Встроенное согласие на передачу данных доступно на desktop с Firefox 140.
                          strict_min_version: '140.0',
                          data_collection_permissions: {
                              required: ['websiteContent', 'browsingActivity'],
                          },
                      },
                      gecko_android: {
                          // Для Android встроенное согласие появилось в Firefox 142.
                          strict_min_version: '142.0',
                      },
                  }
                : undefined,
    }),
    zip: {
        artifactTemplate: 'LexiSync-v{{version}}-{{browser}}.zip',
    },
});
