import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, '.output', 'release');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const amoMetadataPath = path.join(root, 'scripts', 'firefox-amo-metadata.json');
const amoMetadata = JSON.parse(await fs.readFile(amoMetadataPath, 'utf8'));
const licenseText = await fs.readFile(path.join(root, 'LICENSE'), 'utf8');
const MAX_ZIP_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_INITIAL_SCRIPT_BYTES = {
    'background.js': 64 * 1024,
    'inject.js': 140 * 1024,
};

const licenseOwner = licenseText.match(/^Copyright \(c\) \d{4}(?:-\d{4})? (.+)$/m)?.[1];
if (!packageJson.author || licenseOwner !== packageJson.author) {
    throw new Error('LICENSE: владелец авторских прав не совпадает с автором в package.json');
}
if (amoMetadata.version?.license !== packageJson.license) {
    throw new Error('Mozilla Add-ons: лицензия версии не совпадает с package.json');
}
const firefoxCategories = amoMetadata.categories?.firefox;
if (!Array.isArray(firefoxCategories) || !firefoxCategories.includes('language-support')) {
    throw new Error('Mozilla Add-ons: для Firefox не задана категория language-support');
}
if (
    typeof amoMetadata.summary?.ru !== 'string' ||
    !amoMetadata.summary.ru.trim() ||
    typeof amoMetadata.summary?.['en-US'] !== 'string' ||
    !amoMetadata.summary['en-US'].trim()
) {
    throw new Error('Mozilla Add-ons: отсутствует русское или английское краткое описание');
}

function assertSafeArchivePath(filename) {
    const normalized = filename.replaceAll('\\', '/');
    const parts = normalized.split('/');
    if (
        !normalized ||
        normalized.startsWith('/') ||
        /^[a-z]:/i.test(normalized) ||
        parts.some((part) => part === '..' || part === '.' || part.includes('\0'))
    ) {
        throw new Error(`ZIP: небезопасный путь ${JSON.stringify(filename)}`);
    }
    return normalized;
}

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
    if (entryCount > MAX_ZIP_ENTRIES) throw new Error(`ZIP: слишком много файлов (${entryCount})`);
    let offset = buffer.readUInt32LE(endOffset + 16);
    const entries = new Map();
    let totalUncompressedBytes = 0;

    for (let index = 0; index < entryCount; index += 1) {
        if (offset < 0 || offset + 46 > endOffset) throw new Error('ZIP: центральная директория выходит за границы');
        if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP: повреждена центральная директория');
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const expectedCrc = buffer.readUInt32LE(offset + 16);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const filenameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const filename = assertSafeArchivePath(
            buffer.subarray(offset + 46, offset + 46 + filenameLength).toString('utf8'),
        );
        totalUncompressedBytes += uncompressedSize;
        if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw new Error('ZIP: превышен допустимый размер');
        if (entries.has(filename)) throw new Error(`${filename}: повторяющееся имя файла в ZIP`);

        if ((flags & 1) !== 0) throw new Error(`${filename}: зашифрованные ZIP-файлы не поддерживаются`);
        if (localOffset < 0 || localOffset + 30 > buffer.length)
            throw new Error(`${filename}: локальный заголовок выходит за границы`);
        if (buffer.readUInt32LE(localOffset) !== 0x04034b50)
            throw new Error(`${filename}: повреждён локальный заголовок`);
        const localFilenameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const localFilename = assertSafeArchivePath(
            buffer.subarray(localOffset + 30, localOffset + 30 + localFilenameLength).toString('utf8'),
        );
        if (localFilename !== filename) throw new Error(`${filename}: имена в заголовках ZIP не совпадают`);
        const dataOffset = localOffset + 30 + localFilenameLength + localExtraLength;
        if (dataOffset < 0 || dataOffset + compressedSize > buffer.length)
            throw new Error(`${filename}: сжатые данные выходят за границы ZIP`);
        const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
        const content = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
        if (!content) throw new Error(`${filename}: неподдерживаемый метод сжатия ${method}`);
        if (content.length !== uncompressedSize) throw new Error(`${filename}: неверный размер распакованного файла`);
        if (zlib.crc32(content) !== expectedCrc) throw new Error(`${filename}: контрольная сумма CRC32 не совпадает`);
        entries.set(filename, content);
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

    for (const [filename, limit] of Object.entries(MAX_INITIAL_SCRIPT_BYTES)) {
        const file = buildFiles.get(filename);
        if (!file) throw new Error(`${browser}: отсутствует стартовый скрипт ${filename}`);
        if (file.length > limit) {
            throw new Error(
                `${browser}: ${filename} превышает бюджет размера (${file.length} байт вместо не более ${limit})`,
            );
        }
    }

    if (JSON.stringify(buildNames) !== JSON.stringify(archiveNames)) {
        throw new Error(`${browser}: состав ZIP не совпадает с финальной production-сборкой`);
    }
    for (const filename of buildNames) {
        if (digest(buildFiles.get(filename)) !== digest(archiveFiles.get(filename))) {
            throw new Error(`${browser}: файл ${filename} в ZIP отличается от production-сборки`);
        }
        if (/\.(?:html|js)$/i.test(filename)) {
            const source = buildFiles.get(filename).toString('utf8');
            if (/\.html$/i.test(filename) && /<link\b[^>]*\brel\s*=\s*['"]modulepreload['"]/iu.test(source)) {
                throw new Error(`${browser}: ${filename} содержит несовместимый с extension-страницей modulepreload`);
            }
            if (
                /\beval\s*\(/u.test(source) ||
                /\bnew\s+Function\s*\(/u.test(source) ||
                /\bimportScripts\s*\(\s*['"]https?:/iu.test(source) ||
                /\bimport\s*\(\s*['"]https?:/iu.test(source) ||
                /<script\b[^>]*\bsrc\s*=\s*['"]https?:/iu.test(source)
            ) {
                throw new Error(`${browser}: ${filename} содержит удалённый или строковый исполняемый код`);
            }
        }
    }
    console.log(`${browser}: ZIP проверен (${buildNames.length} файлов, точное совпадение с production-сборкой).`);
}

const sourcesArchivePath = path.join(releaseRoot, `${packageJson.name}-${packageJson.version}-sources.zip`);
const sourceFiles = readZip(await fs.readFile(sourcesArchivePath));
const sourceNames = [...sourceFiles.keys()].filter((name) => !name.endsWith('/'));
const requiredSources = [
    '.github/workflows/ci.yml',
    '.npmrc',
    '.nvmrc',
    'LICENSE',
    'package.json',
    'package-lock.json',
    'scripts/firefox-amo-metadata.json',
    'wxt.config.ts',
    'src/background.ts',
];
const forbiddenSourcePath = /(^|\/)(?:node_modules|\.git|\.output|coverage|test-results|playwright-report)(?:\/|$)/;
const releaseArtifactPath = /(^|\/)[^/]+\.(?:xpi|zip)$/iu;

for (const filename of requiredSources) {
    if (!sourceFiles.has(filename)) throw new Error(`sources ZIP: отсутствует обязательный файл ${filename}`);
}
const unsafeSources = sourceNames.filter(
    (filename) =>
        filename.startsWith('../') ||
        path.isAbsolute(filename) ||
        forbiddenSourcePath.test(filename) ||
        releaseArtifactPath.test(filename) ||
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
