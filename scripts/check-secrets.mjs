import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const patterns = [
    /gsk_[A-Za-z0-9_-]{24,}/u,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /AIza[0-9A-Za-z_-]{35}/u,
];
const findings = [];
for (const file of files) {
    let contents;
    try {
        contents = readFileSync(file, 'utf8');
    } catch {
        continue;
    }
    if (contents.includes('\0')) continue;
    if (file === 'tests/unit.spec.ts') {
        contents = contents.replaceAll('gsk_' + '1234567890abcdef1234567890abcdef', '');
    }
    if (patterns.some((pattern) => pattern.test(contents))) findings.push(file);
}
if (findings.length) {
    for (const file of findings) console.error('::error file=' + file + '::Обнаружена строка, похожая на секрет.');
    process.exitCode = 1;
} else {
    console.log('Проверка секретов пройдена: ' + files.length + ' отслеживаемых файлов.');
}
