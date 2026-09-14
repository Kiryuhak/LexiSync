export type LocalConfidence = 'high' | 'medium' | 'low';

export interface LocalTextFinding {
    kind: 'spelling' | 'spacing' | 'punctuation' | 'typography';
    original: string;
    replacement?: string;
    suggestions: string[];
    start: number;
    end: number;
    confidence: LocalConfidence;
    applied: boolean;
}

export interface LocalRuleResult {
    correctedText: string;
    findings: LocalTextFinding[];
}

interface Rule {
    kind: LocalTextFinding['kind'];
    pattern: RegExp;
    replacement: string | ((match: string, ...groups: string[]) => string);
    confidence?: LocalConfidence;
}

const RULES: Rule[] = [
    { kind: 'spacing', pattern: /[\t ]{2,}/gu, replacement: ' ' },
    { kind: 'spacing', pattern: /[ \t]+([,.;:!?])/gu, replacement: '$1' },
    { kind: 'spacing', pattern: /([,;:!?])(?=[А-Яа-яЁёA-Za-z])/gu, replacement: '$1 ' },
    { kind: 'spacing', pattern: /\(\s+([^\r\n()]*)\s+\)/gu, replacement: '($1)' },
    { kind: 'punctuation', pattern: /\.{2,}/gu, replacement: '…' },
    { kind: 'typography', pattern: /\s+-\s+/gu, replacement: ' — ' },
    {
        kind: 'spelling',
        pattern: /(?<![А-Яа-яЁё])какой[ -]нибудь(?![А-Яа-яЁё])/giu,
        replacement: 'какой-нибудь',
    },
    {
        kind: 'spelling',
        pattern: /(?<![А-Яа-яЁё])когда[ -]нибудь(?![А-Яа-яЁё])/giu,
        replacement: 'когда-нибудь',
    },
    {
        kind: 'spelling',
        pattern: /(?<![А-Яа-яЁё])что[ -]нибудь(?![А-Яа-яЁё])/giu,
        replacement: 'что-нибудь',
    },
    {
        kind: 'typography',
        pattern: /"([^"\r\n]{1,200})"/gu,
        replacement: '«$1»',
        confidence: 'medium',
    },
];

function expandReplacement(match: RegExpExecArray, replacement: Rule['replacement']): string {
    if (typeof replacement === 'function') return replacement(match[0], ...match.slice(1));
    return replacement.replace(/\$(\d+)/gu, (_, index: string) => match[Number(index)] ?? '');
}

function applyRule(text: string, rule: Rule, findings: LocalTextFinding[]): string {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    let result = '';
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        const replacement = expandReplacement(match, rule.replacement);
        if (replacement === match[0]) continue;
        result += text.slice(cursor, index) + replacement;
        const start = result.length - replacement.length;
        findings.push({
            kind: rule.kind,
            original: match[0],
            replacement,
            suggestions: [replacement],
            start,
            end: start + replacement.length,
            confidence: rule.confidence ?? 'high',
            applied: (rule.confidence ?? 'high') === 'high',
        });
        if ((rule.confidence ?? 'high') === 'high') cursor = index + match[0].length;
        else {
            result = result.slice(0, -replacement.length) + match[0];
            cursor = index + match[0].length;
        }
    }
    return result + text.slice(cursor);
}

/** Консервативные правила: применяются только однозначные опечатки и типографика. */
export function applyLocalTextRules(text: string): LocalRuleResult {
    const findings: LocalTextFinding[] = [];
    let correctedText = text;
    for (const rule of RULES) correctedText = applyRule(correctedText, rule, findings);
    return { correctedText, findings };
}
