export interface ToolingException {
    package: string;
    advisoryId: number | string;
    maxSeverity: 'high' | 'critical';
    rationale: string;
    owner: string;
    expires: string;
}

export interface AuditIssue {
    package: string;
    sourcePackage?: string;
    severity?: string;
    title: string;
    url?: string;
    advisoryId?: number | string | null;
    range?: string;
    nodes?: string[];
    fixAvailable?: unknown;
    unapproved?: boolean;
    expired?: boolean;
    rationale?: string;
}

export interface AuditAnalysisResult {
    success: boolean;
    blockingCount: number;
    issues: AuditIssue[];
    expiredExceptions: unknown[];
}

export interface AuditAnalysisOptions {
    exceptions?: ToolingException[];
    now?: Date;
}

export const ALLOWED_EXCEPTIONS: ToolingException[];
export function analyzeAuditReport(report: unknown, options?: AuditAnalysisOptions): AuditAnalysisResult;
export function runToolingAudit(): void;
