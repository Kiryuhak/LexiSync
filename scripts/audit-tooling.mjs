import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Схема явного исключения для уязвимости в dev-инструментах:
 * Каждое исключение строго привязано к конкретному пакету и ID advisory,
 * содержит обоснование (rationale), владельца и дату истечения.
 */
export const ALLOWED_EXCEPTIONS = [];

/**
 * Анализирует разобранный JSON-отчёт npm audit с политикой fail-closed.
 * @param {object} report - Результат JSON.parse(auditStdout)
 * @param {object} [options]
 * @param {Array} [options.exceptions] - Список активных исключений
 * @param {Date} [options.now] - Текущая дата для проверки истечения исключений
 * @returns {{ success: boolean, blockingCount: number, issues: Array<object>, expiredExceptions: Array<object> }}
 */
export function analyzeAuditReport(report, options = {}) {
    if (!report || typeof report !== 'object') {
        throw new Error('Аудит инструментов: невалидный объект отчёта npm audit (fail-closed).');
    }

    if (report.error) {
        const details = typeof report.error === 'object' ? JSON.stringify(report.error) : String(report.error);
        throw new Error(`Аудит инструментов: ошибка реестра npm audit (${details}) (fail-closed).`);
    }

    if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
        throw new Error('Аудит инструментов: в отчёте отсутствует секция vulnerabilities (fail-closed).');
    }

    const exceptions = options.exceptions || ALLOWED_EXCEPTIONS;
    const now = options.now || new Date();

    const vulnerabilities = report.vulnerabilities;
    const blockingEntries = Object.entries(vulnerabilities).filter(([, v]) =>
        ['high', 'critical'].includes(v.severity),
    );

    if (blockingEntries.length === 0) {
        return {
            success: true,
            blockingCount: 0,
            issues: [],
            expiredExceptions: [],
        };
    }

    const issues = [];
    const expiredExceptions = [];

    // Вспомогательная функция разрешения advisory через цепочку via
    function resolveAdvisories(vulnName, visited = new Set()) {
        if (visited.has(vulnName)) return [];
        visited.add(vulnName);

        const v = vulnerabilities[vulnName];
        if (!v || !Array.isArray(v.via)) return [];

        const advisories = [];
        for (const item of v.via) {
            if (typeof item === 'object' && item !== null) {
                advisories.push({ package: vulnName, advisory: item });
            } else if (typeof item === 'string') {
                advisories.push(...resolveAdvisories(item, visited));
            }
        }
        return advisories;
    }

    for (const [pkgName, vuln] of blockingEntries) {
        const directAndTransitiveAdvisories = resolveAdvisories(pkgName);

        // Если via не содержит объектов вообще
        if (directAndTransitiveAdvisories.length === 0) {
            issues.push({
                package: pkgName,
                severity: vuln.severity,
                title: 'Неизвестная уязвимость без advisory metadata',
                url: '',
                advisoryId: null,
                range: vuln.range,
                nodes: vuln.nodes || [],
                fixAvailable: vuln.fixAvailable,
                unapproved: true,
            });
            continue;
        }

        for (const { package: sourcePkg, advisory } of directAndTransitiveAdvisories) {
            const advId = advisory.source;
            const matchingException = exceptions.find(
                (ex) =>
                    ex.package === sourcePkg &&
                    (String(ex.advisoryId) === String(advId) || String(ex.advisoryId) === String(advisory.url)),
            );

            if (matchingException) {
                const expiresDate = new Date(matchingException.expires);
                if (expiresDate < now) {
                    expiredExceptions.push({
                        exception: matchingException,
                        advisory,
                        package: pkgName,
                    });
                    issues.push({
                        package: pkgName,
                        sourcePackage: sourcePkg,
                        severity: advisory.severity || vuln.severity,
                        title: advisory.title,
                        url: advisory.url,
                        advisoryId: advId,
                        range: advisory.range || vuln.range,
                        nodes: vuln.nodes || [],
                        fixAvailable: vuln.fixAvailable,
                        expired: true,
                        rationale: matchingException.rationale,
                    });
                }
            } else {
                issues.push({
                    package: pkgName,
                    sourcePackage: sourcePkg,
                    severity: advisory.severity || vuln.severity,
                    title: advisory.title,
                    url: advisory.url,
                    advisoryId: advId,
                    range: advisory.range || vuln.range,
                    nodes: vuln.nodes || [],
                    fixAvailable: vuln.fixAvailable,
                    unapproved: true,
                });
            }
        }
    }

    return {
        success: issues.length === 0,
        blockingCount: blockingEntries.length,
        issues,
        expiredExceptions,
    };
}

/**
 * Запускает аудит npm с повторами при сетевых сбоях и fail-closed валидацией.
 */
export function runToolingAudit() {
    let audit;
    const maxRetries = 2;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            audit =
                process.platform === 'win32'
                    ? spawnSync(
                          process.env.ComSpec || 'cmd.exe',
                          ['/d', '/s', '/c', 'npm.cmd audit --json --audit-level=high'],
                          { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 },
                      )
                    : spawnSync('npm', ['audit', '--json', '--audit-level=high'], {
                          encoding: 'utf8',
                          maxBuffer: 15 * 1024 * 1024,
                      });
            if (!audit.error && audit.stdout && audit.stdout.trim().startsWith('{')) {
                break;
            }
            if (audit.error) lastError = audit.error;
        } catch (e) {
            lastError = e;
        }
    }

    if (audit?.error) throw audit.error;
    if (!audit?.stdout || !audit.stdout.trim()) {
        throw new Error(
            `Аудит инструментов: npm audit не вернул данных:\n${audit?.stderr || lastError || 'нет вывода'}`,
        );
    }

    let report;
    try {
        report = JSON.parse(audit.stdout);
    } catch {
        throw new Error(`Аудит инструментов: npm audit вернул невалидный JSON:\n${audit.stderr || audit.stdout}`);
    }

    const result = analyzeAuditReport(report);

    if (result.success) {
        console.log('Аудит инструментов: уязвимостей высокого и критического уровня нет (0 findings).');
        process.exit(0);
    }

    console.error(`\n❌ Аудит инструментов обнаружил ${result.issues.length} блокирующих проблем безопасности:`);

    for (const issue of result.issues) {
        const severityUpper = (issue.severity || 'HIGH').toUpperCase();
        const pkgInfo =
            issue.sourcePackage && issue.sourcePackage !== issue.package
                ? `${issue.package} (через ${issue.sourcePackage})`
                : issue.package;

        const pathInfo = issue.nodes && issue.nodes.length > 0 ? issue.nodes.join(', ') : 'root';
        const fixInfo = issue.fixAvailable ? JSON.stringify(issue.fixAvailable) : 'нет автоматического исправления';

        console.error(
            `\n::error title=Security Vulnerability::[${severityUpper}] ${pkgInfo}: ${issue.title} (ID: ${issue.advisoryId || 'N/A'}). Ссылка: ${issue.url || 'N/A'}. Путь: ${pathInfo}. Fix: ${fixInfo}`,
        );
        console.error(`  - Пакет: ${pkgInfo}`);
        console.error(`  - Уровень: ${severityUpper}`);
        console.error(`  - Уязвимость: ${issue.title}`);
        console.error(`  - Advisory: ${issue.url || issue.advisoryId || 'N/A'}`);
        console.error(`  - Диапазон: ${issue.range || 'N/A'}`);
        console.error(`  - Пути: ${pathInfo}`);
        console.error(`  - Статус: ${issue.expired ? 'ИСТЁКШЕЕ ИСКЛЮЧЕНИЕ' : 'НЕРАЗРЕШЁННАЯ УЯЗВИМОСТЬ'}`);
    }

    process.exit(1);
}

// Запуск при прямом вызове
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    runToolingAudit();
}
