import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/unit.spec.ts', 'tests/storage.spec.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary'],
            include: [
                'src/keyboard-layout.ts',
                'src/prompt-builder.ts',
                'src/markdown.ts',
                'src/mistral-client.ts',
                'src/site-profiles.ts',
                'src/site-access.ts',
                'src/spellcheck.ts',
                'src/request-cache.ts',
                'src/history-store.ts',
                'src/usage-stats.ts',
            ],
            thresholds: { lines: 35, functions: 40, statements: 35, branches: 30 },
        },
    },
});
