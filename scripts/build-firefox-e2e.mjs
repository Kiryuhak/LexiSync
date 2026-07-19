import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['run', 'build:firefox'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, LEXISYNC_E2E_HOST_ACCESS: '1' },
});

process.exit(result.status ?? 1);
