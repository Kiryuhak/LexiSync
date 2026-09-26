import { spawnSync } from 'node:child_process';

const audit =
    process.platform === 'win32'
        ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm audit --json --audit-level=high'], {
              encoding: 'utf8',
          })
        : spawnSync('npm', ['audit', '--json', '--audit-level=high'], { encoding: 'utf8' });

if (audit.error) throw audit.error;

let report;
try {
    report = JSON.parse(audit.stdout);
} catch {
    throw new Error(`npm audit did not return valid JSON:\n${audit.stderr || audit.stdout}`);
}

const vulnerabilities = report.vulnerabilities || {};
const blocking = Object.entries(vulnerabilities).filter(([, vulnerability]) =>
    ['high', 'critical'].includes(vulnerability.severity),
);

if (blocking.length === 0) {
    console.log('Tooling audit: no high or critical vulnerabilities.');
    process.exit(0);
}

const allowedPackages = new Set(['addons-linter', 'adm-zip', 'firefox-profile', 'image-size', 'web-ext', 'wxt']);
const unexpected = blocking.filter(([name]) => !allowedPackages.has(name));
const allowedAdvisories = new Set([1138808, 1138809, 1193734, 1239030, 1239765, 1239766]);
const advisorySources = new Set(
    blocking.flatMap(([, vulnerability]) =>
        (vulnerability.via || [])
            .filter((entry) => typeof entry === 'object' && entry !== null)
            .map((entry) => entry.source),
    ),
);
const unexpectedSources = [...advisorySources].filter((source) => !allowedAdvisories.has(source));

if (unexpected.length > 0 || unexpectedSources.length > 0) {
    const names = blocking.map(([name]) => name).join(', ') || 'none';
    throw new Error(`Tooling audit contains new high/critical vulnerabilities: ${names}`);
}

console.log('Tooling audit: only the accepted tooling advisories are present.');
