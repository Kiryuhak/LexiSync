import { describe, expect, test } from 'vitest';
import { analyzeAuditReport, type ToolingException } from '../scripts/audit-tooling.mjs';

describe('audit-tooling: политика безопасности и fail-closed валидация', () => {
    test('чистый отчёт (0 high/critical, только moderate) возвращает success: true', () => {
        const fixture = {
            vulnerabilities: {
                minimatch: {
                    severity: 'moderate',
                    via: ['advisory-1'],
                },
            },
        };

        const result = analyzeAuditReport(fixture);
        expect(result.success).toBe(true);
        expect(result.blockingCount).toBe(0);
        expect(result.issues).toHaveLength(0);
    });

    test('fail-closed: сбой реестра npm audit (report.error) вызывает исключение', () => {
        const fixture = {
            error: {
                code: 'E503',
                summary: 'Service Unavailable',
            },
        };

        expect(() => analyzeAuditReport(fixture)).toThrowError(/ошибка реестра npm audit/);
    });

    test('fail-closed: невалидный или пустой объект отчёта вызывает исключение', () => {
        expect(() => analyzeAuditReport(null)).toThrowError(/fail-closed/);
        expect(() => analyzeAuditReport(undefined)).toThrowError(/fail-closed/);
        expect(() => analyzeAuditReport('не json')).toThrowError(/fail-closed/);
        expect(() => analyzeAuditReport({})).toThrowError(/отсутствует секция vulnerabilities/);
    });

    test('неожиданный high advisory блокирует проверку и возвращает unapproved issue', () => {
        const fixture = {
            vulnerabilities: {
                sharp: {
                    name: 'sharp',
                    severity: 'high',
                    range: '<0.35.5',
                    nodes: ['node_modules/sharp'],
                    via: [
                        {
                            source: 1241331,
                            name: 'sharp',
                            title: 'Vulnerability in librsvg dependency',
                            url: 'https://github.com/advisories/GHSA-wq5f-xc86-pv6w',
                            severity: 'high',
                            range: '<0.35.5',
                        },
                    ],
                },
            },
        };

        const result = analyzeAuditReport(fixture, { exceptions: [] });
        expect(result.success).toBe(false);
        expect(result.blockingCount).toBe(1);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].unapproved).toBe(true);
        expect(result.issues[0].advisoryId).toBe(1241331);
        expect(result.issues[0].package).toBe('sharp');
    });

    test('истёкшее исключение (expired) отклоняется и помечается как expired', () => {
        const fixture = {
            vulnerabilities: {
                sharp: {
                    name: 'sharp',
                    severity: 'high',
                    via: [
                        {
                            source: 1241331,
                            name: 'sharp',
                            title: 'Vulnerability in librsvg dependency',
                            url: 'https://github.com/advisories/GHSA-wq5f-xc86-pv6w',
                            severity: 'high',
                        },
                    ],
                },
            },
        };

        const expiredException: ToolingException = {
            package: 'sharp',
            advisoryId: 1241331,
            maxSeverity: 'high',
            rationale: 'Временное исключение для тестов',
            owner: 'SecTeam',
            expires: '2026-01-01', // дата в прошлом
        };

        const result = analyzeAuditReport(fixture, {
            exceptions: [expiredException],
            now: new Date('2026-11-21'),
        });

        expect(result.success).toBe(false);
        expect(result.expiredExceptions).toHaveLength(1);
        expect(result.issues[0].expired).toBe(true);
    });

    test('активное неистёкшее исключение пропускает уязвимость', () => {
        const fixture = {
            vulnerabilities: {
                sharp: {
                    name: 'sharp',
                    severity: 'high',
                    via: [
                        {
                            source: 1241331,
                            name: 'sharp',
                            title: 'Vulnerability in librsvg dependency',
                            url: 'https://github.com/advisories/GHSA-wq5f-xc86-pv6w',
                            severity: 'high',
                        },
                    ],
                },
            },
        };

        const validException: ToolingException = {
            package: 'sharp',
            advisoryId: 1241331,
            maxSeverity: 'high',
            rationale: 'Разрешено до релиза',
            owner: 'SecTeam',
            expires: '2027-01-01', // дата в будущем
        };

        const result = analyzeAuditReport(fixture, {
            exceptions: [validException],
            now: new Date('2026-11-21'),
        });

        expect(result.success).toBe(true);
        expect(result.issues).toHaveLength(0);
    });

    test('мета-уязвимость через via-цепочку пакетов разрешается до исходного advisory', () => {
        const fixture = {
            vulnerabilities: {
                'fx-runner': {
                    name: 'fx-runner',
                    severity: 'critical',
                    via: ['shell-quote'],
                },
                'shell-quote': {
                    name: 'shell-quote',
                    severity: 'critical',
                    via: [
                        {
                            source: 1241332,
                            name: 'shell-quote',
                            title: 'shell-quote command injection in quote()',
                            url: 'https://github.com/advisories/GHSA-pqg4-j6r4-53mv',
                            severity: 'critical',
                        },
                    ],
                },
            },
        };

        const result = analyzeAuditReport(fixture, { exceptions: [] });
        expect(result.success).toBe(false);
        expect(result.issues.length).toBeGreaterThanOrEqual(2);
        const fxIssue = result.issues.find((i: { package: string }) => i.package === 'fx-runner');
        expect(fxIssue).toBeDefined();
        expect(fxIssue?.sourcePackage).toBe('shell-quote');
        expect(fxIssue?.advisoryId).toBe(1241332);
    });
});
