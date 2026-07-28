import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesRoot = path.join(root, 'public', '_locales');
const localeNames = ['ru', 'en'];
const sourceRoots = ['entrypoints', 'src'];
const standaloneSources = ['wxt.config.ts'];
const sourceExtensions = new Set(['.html', '.ts', '.tsx', '.js', '.mjs']);

async function readMessages(locale) {
    const filename = path.join(localesRoot, locale, 'messages.json');
    const messages = JSON.parse(await fs.readFile(filename, 'utf8'));
    for (const [key, value] of Object.entries(messages)) {
        if (!value || typeof value.message !== 'string' || value.message.trim() === '') {
            throw new Error(`${locale}: ключ «${key}» не содержит непустого поля message`);
        }
    }
    return messages;
}

async function collectFiles(directory) {
    const files = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await collectFiles(fullPath)));
        else if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
    }
    return files;
}

function difference(left, right) {
    return [...left].filter((key) => !right.has(key)).sort();
}

const localeEntries = await Promise.all(localeNames.map(async (locale) => [locale, await readMessages(locale)]));
const locales = Object.fromEntries(localeEntries);
const referenceKeys = new Set(Object.keys(locales.ru));
const errors = [];

for (const locale of localeNames.slice(1)) {
    const localeKeys = new Set(Object.keys(locales[locale]));
    const missing = difference(referenceKeys, localeKeys);
    const extra = difference(localeKeys, referenceKeys);
    if (missing.length) errors.push(`${locale}: отсутствуют ключи: ${missing.join(', ')}`);
    if (extra.length) errors.push(`${locale}: лишние ключи: ${extra.join(', ')}`);
}

const referencedKeys = new Map();
const sourceFiles = [
    ...(await Promise.all(sourceRoots.map((sourceRoot) => collectFiles(path.join(root, sourceRoot))))).flat(),
    ...standaloneSources.map((filename) => path.join(root, filename)),
];
for (const filename of sourceFiles) {
    const source = await fs.readFile(filename, 'utf8');
    const relativeFilename = path.relative(root, filename).replaceAll('\\', '/');
    const patterns = [
        /data-i18n(?:-[a-z-]+)?\s*=\s*["']([^"']+)["']/g,
        /__MSG_([A-Za-z0-9_@]+)__/g,
        /\bt\(\s*["']([^"']+)["']/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const locations = referencedKeys.get(match[1]) ?? [];
            locations.push(relativeFilename);
            referencedKeys.set(match[1], locations);
        }
    }
}

for (const [key, locations] of referencedKeys) {
    if (!referenceKeys.has(key)) {
        errors.push(`ключ «${key}» используется в ${[...new Set(locations)].join(', ')}, но отсутствует в локалях`);
    }
}

if (errors.length) throw new Error(`Проверка локализации не пройдена:\n- ${errors.join('\n- ')}`);

console.log(
    `Локализация проверена: ${referenceKeys.size} общих ключей, ${referencedKeys.size} пользовательских ссылок.`,
);
