import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'test-results/**', 'coverage/**'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts', '**/*.mjs'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                chrome: 'readonly',
                defineBackground: 'readonly',
                defineUnlistedScript: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            eqeqeq: ['error', 'always'],
            'no-undef': 'off',
        },
    },
    {
        files: ['src/**/*.ts'],
        rules: {
            'no-console': ['error', { allow: ['warn', 'error'] }],
        },
    },
);
