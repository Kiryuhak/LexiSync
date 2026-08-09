import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDirectory = path.join(root, 'docs', 'assets');
const files = (await fs.readdir(assetsDirectory)).filter((filename) => filename.endsWith('.svg'));

if (files.length === 0) throw new Error('SVG assets were not found.');

for (const filename of files) {
    const source = await fs.readFile(path.join(assetsDirectory, filename), 'utf8');
    if (!/^<svg\b[^>]*>/u.test(source.trim()) || !/<\/svg>\s*$/u.test(source)) {
        throw new Error(`${filename}: invalid SVG root element.`);
    }
    if (/<(?:script|foreignObject)\b|\son[a-z]+\s*=/iu.test(source)) {
        throw new Error(`${filename}: executable SVG content is not allowed.`);
    }
    const stack = [];
    const tagPattern = /<\/?([a-z][\w:-]*)(?:\s+(?:[^'">]|"[^"]*"|'[^']*')*)?\s*\/?>/giu;
    let cursor = 0;
    for (const match of source.matchAll(tagPattern)) {
        if (source.slice(cursor, match.index).includes('<')) throw new Error(`${filename}: malformed XML markup.`);
        cursor = (match.index || 0) + match[0].length;
        const tag = match[1].toLowerCase();
        if (match[0].startsWith('</')) {
            if (stack.pop() !== tag) throw new Error(`${filename}: invalid closing tag </${tag}>.`);
        } else if (!match[0].endsWith('/>')) {
            stack.push(tag);
        }
    }
    if (source.slice(cursor).includes('<') || stack.length > 0) throw new Error(`${filename}: unclosed SVG markup.`);
}

console.log(`SVG assets validated: ${files.join(', ')}`);
