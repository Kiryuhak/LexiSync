import { expect, firefox, test } from '@playwright/test';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { platform } from 'node:process';

function waitForTemporaryInstall(runner: ChildProcessWithoutNullStreams): Promise<string> {
    return new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(
            () => reject(new Error(`Firefox не подтвердил установку расширения.\n${output}`)),
            30_000,
        );
        const collect = (chunk: Buffer) => {
            output += chunk.toString();
            if (/Installed .* as a temporary add-on/i.test(output)) {
                clearTimeout(timeout);
                resolve(output);
            }
        };
        runner.stdout.on('data', collect);
        runner.stderr.on('data', collect);
        runner.once('exit', (code) => {
            if (!/Installed .* as a temporary add-on/i.test(output)) {
                clearTimeout(timeout);
                reject(new Error(`web-ext завершился с кодом ${code}.\n${output}`));
            }
        });
    });
}

function waitForExit(runner: ChildProcessWithoutNullStreams, timeoutMs = 5_000): Promise<void> {
    if (runner.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        const timeout = setTimeout(resolve, timeoutMs);
        runner.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });
}

async function stopWebExt(runner: ChildProcessWithoutNullStreams): Promise<void> {
    if (runner.exitCode !== null) return;
    if (platform === 'win32' && runner.pid) {
        spawnSync('taskkill.exe', ['/pid', String(runner.pid), '/t', '/f'], { windowsHide: true });
    } else {
        runner.kill('SIGTERM');
    }
    await waitForExit(runner);
    if (runner.exitCode === null) runner.kill('SIGKILL');
}

test('Firefox временно устанавливает собранное расширение', async () => {
    const root = path.resolve(__dirname, '..');
    const sourceDirectory = path.join(root, '.output', 'firefox-mv3');
    const [manifestSource, packageSource] = await Promise.all([
        fs.readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8'),
        fs.readFile(path.join(root, 'package.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestSource);
    const packageJson = JSON.parse(packageSource);
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.background.scripts).toEqual(['background.js']);
    expect(manifest.browser_specific_settings.gecko.id).toBe('lexisync@kiryuhak.dev');
    await expect(fs.access(path.join(sourceDirectory, 'inject.js'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(sourceDirectory, 'options.html'))).resolves.toBeUndefined();

    const webExtCli = path.resolve(__dirname, '../node_modules/web-ext/bin/web-ext.js');
    const runner = spawn(
        process.execPath,
        [
            webExtCli,
            'run',
            '--source-dir',
            sourceDirectory,
            '--firefox',
            firefox.executablePath(),
            '--no-input',
            '--no-reload',
            '--arg=-headless',
            '--start-url=https://example.com',
            '--verbose',
        ],
        {
            cwd: root,
            windowsHide: true,
        },
    );

    try {
        const output = await waitForTemporaryInstall(runner);
        expect(output).toMatch(/Installed .* as a temporary add-on/i);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        expect(runner.exitCode).toBeNull();
    } finally {
        await stopWebExt(runner);
    }
});
