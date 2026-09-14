import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const nspell = require('nspell');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(root, 'vendor', 'dictionary-ru');
const outputDirectory = path.join(root, 'public', 'dictionaries', 'ru');
const falsePositiveRate = 0.001;

function hashWord(value, seed) {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index++) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619) >>> 0;
    }
    return hash >>> 0;
}

const [aff, dic] = await Promise.all([
    fs.readFile(path.join(sourceDirectory, 'ru.aff'), 'utf8'),
    fs.readFile(path.join(sourceDirectory, 'ru.dic'), 'utf8'),
]);
const spell = nspell(aff, dic);
const words = new Set(Object.keys(spell.data).map((word) => word.toLocaleLowerCase('ru')));
const bitCount = Math.ceil((-words.size * Math.log(falsePositiveRate)) / Math.log(2) ** 2 / 8) * 8;
const hashCount = Math.max(1, Math.round((bitCount / words.size) * Math.log(2)));
const bytes = new Uint8Array(bitCount / 8);

for (const word of words) {
    const first = hashWord(word, 2_166_136_261);
    const second = (hashWord(word, 3_332_339_343) | 1) >>> 0;
    for (let index = 0; index < hashCount; index++) {
        const bit = (first + index * second + index * index) % bitCount;
        bytes[bit >>> 3] |= 1 << (bit & 7);
    }
}

await fs.mkdir(outputDirectory, { recursive: true });
await Promise.all([
    fs.writeFile(path.join(outputDirectory, 'ru.bloom'), bytes),
    fs.writeFile(
        path.join(outputDirectory, 'ru.bloom.json'),
        `${JSON.stringify(
            {
                format: 1,
                source: 'dictionary-ru@3.0.0',
                sourceLicense: 'BSD-3-Clause',
                wordCount: words.size,
                bitCount,
                hashCount,
                falsePositiveRate,
            },
            null,
            4,
        )}\n`,
    ),
]);

console.log(`Русский Bloom-словарь создан: ${words.size} словоформ, ${bytes.byteLength} байт, ${hashCount} хешей.`);
