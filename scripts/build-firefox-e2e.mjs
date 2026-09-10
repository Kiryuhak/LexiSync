import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const wxtCli = fileURLToPath(new URL('../node_modules/wxt/bin/wxt.mjs', import.meta.url));
const result = spawnSync(process.execPath, [wxtCli, 'build', '-b', 'firefox'], {
    stdio: 'inherit',
    env: {
        ...process.env,
        LEXISYNC_E2E_HOST_ACCESS: '1',
        LEXISYNC_GOOGLE_DRIVE_CHROME_CLIENT_ID: 'chrome-e2e-client.apps.googleusercontent.com',
        LEXISYNC_GOOGLE_DRIVE_FIREFOX_CLIENT_ID: 'firefox-e2e-client.apps.googleusercontent.com',
    },
});

process.exit(result.status ?? 1);
