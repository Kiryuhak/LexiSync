import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Строго говорим роботу запускать только файлы с расширением .spec.ts
  // Это навсегда запретит ему лезть в папку dist за старыми .js файлами!
  testMatch: '**/*.spec.ts', 
  // Запускать тесты по очереди, чтобы не перегружать память
  workers: 1, 
});