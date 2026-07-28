import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const wxtCli = fileURLToPath(new URL('../node_modules/wxt/bin/wxt.mjs', import.meta.url));
for (const browser of ['chrome', 'firefox']) {
    const result = spawnSync(process.execPath, [wxtCli, 'build', '-b', browser], {
        stdio: 'inherit',
        env: { ...process.env, LEXISYNC_E2E_HOST_ACCESS: '1' },
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
}
