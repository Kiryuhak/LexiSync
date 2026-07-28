import fs from 'node:fs/promises';

const REQUIRED_PERMISSIONS = ['storage', 'activeTab', 'scripting', 'contextMenus'];
const OPTIONAL_WEB_ORIGINS = ['http://*/*', 'https://*/*'];

for (const browser of ['chrome', 'firefox']) {
    const manifest = JSON.parse(
        await fs.readFile(new URL(`../.output/release/${browser}-mv3/manifest.json`, import.meta.url), 'utf8'),
    );
    const permissions = manifest.permissions || [];
    const requiredOrigins = manifest.host_permissions || [];
    const optionalOrigins = manifest.optional_host_permissions || [];
    if (!REQUIRED_PERMISSIONS.every((permission) => permissions.includes(permission))) {
        throw new Error(`${browser}: отсутствует обязательное разрешение`);
    }
    if (permissions.includes('clipboardRead') || permissions.includes('clipboardWrite')) {
        throw new Error(`${browser}: обнаружено лишнее разрешение буфера обмена`);
    }
    if (manifest.content_scripts) throw new Error(`${browser}: content script не должен быть статическим`);
    if (requiredOrigins.some((origin) => OPTIONAL_WEB_ORIGINS.includes(origin))) {
        throw new Error(`${browser}: доступ ко всем сайтам не должен быть обязательным`);
    }
    if (!OPTIONAL_WEB_ORIGINS.every((origin) => optionalOrigins.includes(origin))) {
        throw new Error(`${browser}: отсутствует опциональный доступ к веб-сайтам`);
    }
}

console.log('Production-манифесты Chrome и Firefox соответствуют политике разрешений.');
