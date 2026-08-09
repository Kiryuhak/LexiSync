import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const currentVersion = packageJson.version;
const releaseDirectory = path.join(root, '.output', 'release');
const oldReleasePattern = /^(?:LexiSync-v.+-(?:chrome|firefox)|lexisync-extension-.+-sources)\.zip$/;
const oldXpiPattern = /^LexiSync-v.+-firefox\.xpi$/;

async function removeOldArtifacts(directory, pattern) {
    let entries;
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
        throw error;
    }
    const removed = [];
    for (const entry of entries) {
        if (!entry.isFile() || !pattern.test(entry.name) || entry.name.includes(currentVersion)) continue;
        const target = path.join(directory, entry.name);
        await fs.unlink(target);
        removed.push(target);
    }
    return removed;
}

const removed = [
    ...(await removeOldArtifacts(releaseDirectory, oldReleasePattern)),
    ...(await removeOldArtifacts(root, oldXpiPattern)),
];

console.log(
    removed.length
        ? `Removed ${removed.length} obsolete LexiSync artifact(s):\n${removed.join('\n')}`
        : `No obsolete LexiSync artifacts found; preserving v${currentVersion}.`,
);
