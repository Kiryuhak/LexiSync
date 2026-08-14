export interface ChromeStoreRevision {
    state?: string;
    distributionChannels?: Array<{
        crxVersion?: string;
        deployPercentage?: number;
    }>;
}

export interface ChromeStoreStatus {
    lastAsyncUploadState?: string;
    submittedItemRevisionStatus?: ChromeStoreRevision;
    publishedItemRevisionStatus?: ChromeStoreRevision;
}

export interface ChromePublishOptions {
    extensionId: string;
    publisherId: string;
    clientEmail: string;
    privateKey: string;
    expectedVersion: string;
    zipPath?: string;
    zipBuffer?: Buffer;
    maxAttempts?: number | string;
    pollAttempts?: number | string;
    pollDelayMs?: number | string;
    retryDelayMs?: number | string;
}

export interface ChromePublishDependencies {
    accessToken?: string;
    fetch?: typeof fetch;
    wait?: (milliseconds: number) => Promise<void>;
    readFile?: (filename: string) => Promise<Buffer>;
    logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface AcceptedChromeVersion {
    source: 'submitted' | 'published';
    state: string;
    version: string;
}

export class ChromeStoreError extends Error {
    retryable: boolean;
}

export function normalizePrivateKey(value: unknown): string;
export function parseChromeVersion(value: unknown): number[];
export function compareChromeVersions(left: unknown, right: unknown): number;
export function getRevisionVersions(revision: ChromeStoreRevision | null | undefined): string[];
export function findAcceptedVersion(
    status: ChromeStoreStatus | null | undefined,
    expectedVersion: string,
): AcceptedChromeVersion | null;
export function publishChromeExtension(
    options: ChromePublishOptions,
    dependencies?: ChromePublishDependencies,
): Promise<AcceptedChromeVersion & { attempts: number }>;
