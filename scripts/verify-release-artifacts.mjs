import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, '.output', 'release');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));

function findEndOfCentralDirectory(buffer) {
    const minimumOffset = Math.max(0, buffer.length - 65_557);
    for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
    }
    throw new Error('ZIP: не найдена центральная директория');
}

function readZip(buffer) {
    const endOffset = findEndOfCentralDirectory(buffer);
    const entryCount = buffer.readUInt16LE(endOffset + 10);
    let offset = buffer.readUInt32LE(endOffset + 16);
    const entries = new Map();

    for (let index = 0; index < entryCount; index += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP: повреждена центральная директория');
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const filenameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const filename = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString('utf8');

        if ((flags & 1) !== 0) throw new Error(`${filename}: зашифрованные ZIP-файлы не поддерживаются`);
        if (buffer.readUInt32LE(localOffset) !== 0x04034b50)
            throw new Error(`${filename}: повреждён локальный заголовок`);
        const localFilenameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localFilenameLength + localExtraLength;
        const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
        const content = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
        if (!content) throw new Error(`${filename}: неподдерживаемый метод сжатия ${method}`);
        if (content.length !== uncompressedSize) throw new Error(`${filename}: неверный размер распакованного файла`);
        entries.set(filename.replaceAll('\\', '/'), content);
        offset += 46 + filenameLength + extraLength + commentLength;
    }
    return entries;
}

async function collectFiles(directory, prefix = '') {
    const files = new Map();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            for (const [name, content] of await collectFiles(fullPath, relativePath)) files.set(name, content);
        } else {
            files.set(relativePath, await fs.readFile(fullPath));
        }
    }
    return files;
}

function digest(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

for (const browser of ['chrome', 'firefox']) {
    const buildDirectory = path.join(releaseRoot, `${browser}-mv3`);
    const archivePath = path.join(releaseRoot, `LexiSync-v${packageJson.version}-${browser}.zip`);
    const [buildFiles, archive] = await Promise.all([collectFiles(buildDirectory), fs.readFile(archivePath)]);
    const archiveFiles = readZip(archive);
    const buildNames = [...buildFiles.keys()].sort();
    const archiveNames = [...archiveFiles.keys()].filter((name) => !name.endsWith('/')).sort();

    if (JSON.stringify(buildNames) !== JSON.stringify(archiveNames)) {
        throw new Error(`${browser}: состав ZIP не совпадает с финальной production-сборкой`);
    }
    for (const filename of buildNames) {
        if (digest(buildFiles.get(filename)) !== digest(archiveFiles.get(filename))) {
            throw new Error(`${browser}: файл ${filename} в ZIP отличается от production-сборки`);
        }
    }
    console.log(`${browser}: ZIP проверен (${buildNames.length} файлов, точное совпадение с production-сборкой).`);
}

const sourcesArchivePath = path.join(releaseRoot, `${packageJson.name}-${packageJson.version}-sources.zip`);
const sourceFiles = readZip(await fs.readFile(sourcesArchivePath));
const sourceNames = [...sourceFiles.keys()].filter((name) => !name.endsWith('/'));
const requiredSources = ['package.json', 'package-lock.json', 'wxt.config.ts', 'src/background.ts'];
const forbiddenSourcePath = /(^|\/)(?:node_modules|\.git|\.output|coverage|test-results|playwright-report)(?:\/|$)/;

for (const filename of requiredSources) {
    if (!sourceFiles.has(filename)) throw new Error(`sources ZIP: отсутствует обязательный файл ${filename}`);
}
const unsafeSources = sourceNames.filter(
    (filename) =>
        filename.startsWith('../') ||
        path.isAbsolute(filename) ||
        forbiddenSourcePath.test(filename) ||
        /(^|\/)\.env(?:\.|$)/.test(filename),
);
if (unsafeSources.length)
    throw new Error(`sources ZIP содержит служебные или секретные файлы: ${unsafeSources.join(', ')}`);

for (const filename of sourceNames) {
    const currentContent = await fs.readFile(path.join(root, filename));
    if (digest(currentContent) !== digest(sourceFiles.get(filename))) {
        throw new Error(`sources ZIP: файл ${filename} не совпадает с текущим исходным кодом`);
    }
}

const archivedPackage = JSON.parse(sourceFiles.get('package.json').toString('utf8'));
if (archivedPackage.version !== packageJson.version)
    throw new Error('sources ZIP: версия package.json не совпадает с релизом');
console.log(`sources: ZIP проверен (${sourceNames.length} файлов, служебные каталоги и .env исключены).`);
