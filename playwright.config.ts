import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    // Не подхватывать случайные скомпилированные тесты из других каталогов.
    testMatch: '**/*.spec.ts',
    // Локально бережём память, в CI ускоряем независимые браузерные контексты.
    workers: process.env.CI ? 2 : 1,
});
