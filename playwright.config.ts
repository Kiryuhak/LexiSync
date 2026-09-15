import { defineConfig } from '@playwright/test';

const headed = process.env.PW_HEADED === '1' || process.env.PLAYWRIGHT_HEADED === '1';

export default defineConfig({
    testDir: './tests',
    // Не подхватывать случайные скомпилированные тесты из других каталогов.
    testMatch: '**/*.spec.ts',
    // Расширение использует service worker и отдельный persistent-профиль Chromium.
    // Последовательный запуск исключает гонки между профилями в CI, а одна повторная
    // попытка защищает от кратковременных сбоев запуска браузера на GitHub Actions.
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['list']] : 'list',
    use: {
        headless: !headed,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});
