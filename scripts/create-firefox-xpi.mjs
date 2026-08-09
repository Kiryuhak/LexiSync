import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const source = path.join(root, '.output', 'release', `LexiSync-v${packageJson.version}-firefox.zip`);
const destination = path.join(root, `LexiSync-v${packageJson.version}-firefox.xpi`);
const archive = await fs.readFile(source);

if (archive.length < 4 || archive.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`Firefox ZIP повреждён или имеет неверный формат: ${source}`);
}

await fs.copyFile(source, destination);
const copiedArchive = await fs.readFile(destination);
const sourceDigest = crypto.createHash('sha256').update(archive).digest('hex');
const copiedDigest = crypto.createHash('sha256').update(copiedArchive).digest('hex');
if (sourceDigest !== copiedDigest) throw new Error(`Firefox XPI differs from the verified ZIP: ${destination}`);
console.log(`Создан XPI для временной установки: ${destination}`);
