import { deletePrivateRecord, readPrivateRecord, writePrivateRecord } from './extension-db';
import { splitTextIntoChunks } from './text-chunker';
import type { RequestMode } from './types';

const ACTIVE_JOB_KEY = 'active';

export type BatchFileStatus = 'pending' | 'processing' | 'completed' | 'error';
export type BatchJobStatus = 'paused' | 'running' | 'completed';

export interface BatchSourceFile {
    name: string;
    type: string;
    source: string;
}

export interface BatchJobFile extends BatchSourceFile {
    id: string;
    chunks: string[];
    processedChunks: string[];
    status: BatchFileStatus;
    error?: string;
}

export interface BatchJob {
    id: string;
    createdAt: string;
    updatedAt: string;
    mode: RequestMode;
    prompt?: string;
    status: BatchJobStatus;
    files: BatchJobFile[];
}

export function createBatchJob(files: BatchSourceFile[], mode: RequestMode, prompt?: string): BatchJob {
    const now = new Date().toISOString();
    return {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        mode,
        prompt,
        status: 'paused',
        files: files.map((file) => ({
            ...file,
            id: crypto.randomUUID(),
            chunks: splitTextIntoChunks(file.source),
            processedChunks: [],
            status: 'pending',
        })),
    };
}

export function normalizeBatchJob(value: unknown): BatchJob | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<BatchJob>;
    if (!candidate.id || !Array.isArray(candidate.files)) return null;
    const files = candidate.files
        .filter((file): file is BatchJobFile => Boolean(file && typeof file === 'object'))
        .slice(0, 10)
        .map((file) => ({
            id: String(file.id || crypto.randomUUID()),
            name: String(file.name || 'document.txt').slice(0, 255),
            type: String(file.type || 'text/plain').slice(0, 100),
            source: String(file.source || ''),
            chunks: Array.isArray(file.chunks)
                ? file.chunks.map(String)
                : splitTextIntoChunks(String(file.source || '')),
            processedChunks: Array.isArray(file.processedChunks) ? file.processedChunks.map(String) : [],
            status: ['pending', 'processing', 'completed', 'error'].includes(file.status)
                ? file.status
                : ('pending' as const),
            error: file.error ? String(file.error).slice(0, 500) : undefined,
        }));
    return {
        id: String(candidate.id),
        createdAt: String(candidate.createdAt || new Date().toISOString()),
        updatedAt: String(candidate.updatedAt || new Date().toISOString()),
        mode: ['spellcheck', 'style', 'custom'].includes(String(candidate.mode))
            ? (candidate.mode as RequestMode)
            : 'spellcheck',
        prompt: candidate.prompt ? String(candidate.prompt).slice(0, 2_000) : undefined,
        status: candidate.status === 'completed' ? 'completed' : 'paused',
        files,
    };
}

export async function saveBatchJob(job: BatchJob): Promise<void> {
    job.updatedAt = new Date().toISOString();
    await writePrivateRecord('batchJobs', ACTIVE_JOB_KEY, job);
}

export async function loadBatchJob(): Promise<BatchJob | null> {
    return normalizeBatchJob(await readPrivateRecord<BatchJob>('batchJobs', ACTIVE_JOB_KEY));
}

export async function clearBatchJob(): Promise<void> {
    await deletePrivateRecord('batchJobs', ACTIVE_JOB_KEY);
}

export function getBatchFileResult(file: BatchJobFile): string {
    return file.processedChunks.join('');
}
