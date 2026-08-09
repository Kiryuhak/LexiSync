import { defineConfig } from 'wxt';
import baseConfig from '../wxt.config';

export default defineConfig({
    ...baseConfig,
    outDir: '.output/release',
    zip: {
        ...baseConfig.zip,
        dotSources: true,
        excludeSources: [
            '.agents/**',
            '.codex/**',
            '.git/**',
            '.idea/**',
            '.output/**',
            '.vscode/**',
            '.wxt/**',
            '.env*',
            '*.xpi',
            '*.zip',
            'coverage/**',
            'test-results/**',
            'playwright-report/**',
        ],
    },
});
