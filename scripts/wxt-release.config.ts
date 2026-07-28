import { defineConfig } from 'wxt';
import baseConfig from '../wxt.config';

export default defineConfig({
    ...baseConfig,
    outDir: '.output/release',
    zip: {
        ...baseConfig.zip,
        excludeSources: ['coverage/**', 'test-results/**', 'playwright-report/**'],
    },
});
