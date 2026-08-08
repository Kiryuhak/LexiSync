import fs from 'node:fs/promises';

const BASE_PERMISSIONS = ['storage', 'activeTab', 'scripting', 'contextMenus'];
const REQUIRED_ORIGINS = ['https://api.mistral.ai/*'];
const OPTIONAL_WEB_ORIGINS = ['http://*/*', 'https://*/*'];
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));

function sameValues(actual, expected) {
    return (
        actual.length === expected.length &&
        [...actual].sort().every((value, index) => value === [...expected].sort()[index])
    );
}

for (const browser of ['chrome', 'firefox']) {
    const manifest = JSON.parse(
        await fs.readFile(new URL(`../.output/release/${browser}-mv3/manifest.json`, import.meta.url), 'utf8'),
    );
    const permissions = manifest.permissions || [];
    const requiredOrigins = manifest.host_permissions || [];
    const optionalOrigins = manifest.optional_host_permissions || [];
    if (manifest.manifest_version !== 3) throw new Error(`${browser}: требуется Manifest V3`);
    if (manifest.version !== packageJson.version)
        throw new Error(`${browser}: версия манифеста не совпадает с package.json`);
    if (!sameValues(permissions, BASE_PERMISSIONS))
        throw new Error(`${browser}: набор обязательных разрешений изменён`);
    if (manifest.side_panel || manifest.sidebar_action)
        throw new Error(`${browser}: удалённая рабочая панель не должна присутствовать в манифесте`);
    if (manifest.action?.default_popup !== 'popup.html') throw new Error(`${browser}: toolbar popup is not configured`);
    if (!sameValues(requiredOrigins, REQUIRED_ORIGINS))
        throw new Error(`${browser}: обязательный доступ разрешён только для Mistral API`);
    if (manifest.content_scripts) throw new Error(`${browser}: content script не должен быть статическим`);
    if (!sameValues(optionalOrigins, OPTIONAL_WEB_ORIGINS))
        throw new Error(`${browser}: изменён опциональный доступ к веб-сайтам`);
    if (browser === 'chrome' && typeof manifest.background?.service_worker !== 'string')
        throw new Error('chrome: фоновая логика MV3 должна запускаться в service worker');
    if (browser === 'firefox' && !Array.isArray(manifest.background?.scripts))
        throw new Error('firefox: отсутствует фоновый сценарий MV3');
    const csp = String(manifest.content_security_policy?.extension_pages || '');
    if (/\bunsafe-eval\b/i.test(csp)) throw new Error(`${browser}: CSP разрешает unsafe-eval`);
    if (browser === 'firefox') {
        if (manifest.browser_specific_settings?.gecko?.strict_min_version !== '140.0')
            throw new Error('firefox: минимальная desktop-версия должна быть Firefox 140');
        if (manifest.browser_specific_settings?.gecko_android?.strict_min_version !== '142.0')
            throw new Error('firefox: минимальная Android-версия должна быть Firefox 142');
        const collected = manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required || [];
        if (!sameValues(collected, ['websiteContent', 'browsingActivity']))
            throw new Error('firefox: декларация собираемых данных изменилась');
    }
}

console.log('Production-манифесты Chrome и Firefox соответствуют MV3 и политике минимальных разрешений.');
