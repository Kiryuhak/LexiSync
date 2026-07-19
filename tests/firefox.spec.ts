import { expect, firefox, test } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

function waitForTemporaryInstall(process: ChildProcessWithoutNullStreams): Promise<string> {
    return new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error(`Firefox не подтвердил установку расширения.\n${output}`)), 30_000);
        const collect = (chunk: Buffer) => {
            output += chunk.toString();
            if (/Installed .* as a temporary add-on/i.test(output)) {
                clearTimeout(timeout);
                resolve(output);
            }
        };
        process.stdout.on('data', collect);
        process.stderr.on('data', collect);
        process.once('exit', (code) => {
            if (!/Installed .* as a temporary add-on/i.test(output)) {
                clearTimeout(timeout);
                reject(new Error(`web-ext завершился с кодом ${code}.\n${output}`));
            }
        });
    });
}

test('Firefox временно устанавливает собранное расширение', async () => {
    const webExtCli = path.resolve(__dirname, '../node_modules/web-ext/bin/web-ext.js');
    const runner = spawn(process.execPath, [
        webExtCli,
        'run',
        '--source-dir', path.resolve(__dirname, '../.output/firefox-mv3'),
        '--firefox', firefox.executablePath(),
        '--no-input',
        '--no-reload',
        '--arg=-headless',
        '--start-url=https://example.com',
        '--verbose',
    ], {
        cwd: path.resolve(__dirname, '..'),
        windowsHide: true,
    });

    try {
        const output = await waitForTemporaryInstall(runner);
        expect(output).toMatch(/Installed .* as a temporary add-on/i);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        expect(runner.exitCode).toBeNull();
    } finally {
        runner.kill();
    }
});
