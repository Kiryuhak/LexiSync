import {
    clearBatchJob,
    createBatchJob,
    getBatchFileResult,
    loadBatchJob,
    saveBatchJob,
    type BatchJob,
    type BatchJobFile,
} from './batch-jobs';
import type { RequestCoordinator } from './request-coordinator';
import type { RequestMode } from './types';

interface BatchControllerOptions {
    coordinator: RequestCoordinator;
    setBusy: (value: boolean, label?: string) => void;
    showStatus: (message: string, error?: boolean) => void;
}

function isAcceptedFile(file: File): boolean {
    return /\.(?:txt|md)$/i.test(file.name) || ['text/plain', 'text/markdown'].includes(file.type);
}

export class SidepanelBatchController {
    private job: BatchJob | null = null;
    private paused = false;
    private processing = false;
    private readonly urls = new Set<string>();

    constructor(private readonly options: BatchControllerOptions) {}

    async initialize(): Promise<void> {
        this.job = await loadBatchJob();
        this.render();
    }

    async start(files: File[], mode: RequestMode, prompt?: string, force = false): Promise<void> {
        const selected = files.slice(0, 10);
        if (!selected.length) throw new Error('Выберите TXT или MD-файлы.');
        if (selected.some((file) => !isAcceptedFile(file))) throw new Error('Поддерживаются только TXT и MD-файлы.');
        if (selected.some((file) => file.size > 2_000_000)) throw new Error('Один из файлов больше 2 МБ.');

        // Предупреждаем, если есть незавершённое задание и принудительная замена не запрошена.
        if (!force && this.job && this.job.status !== 'completed') {
            throw new Error('ACTIVE_JOB_EXISTS');
        }

        const sources = await Promise.all(
            selected.map(async (file) => ({
                name: file.name,
                type: file.type || 'text/plain',
                source: await file.text(),
            })),
        );
        this.job = createBatchJob(sources, mode, prompt);
        await saveBatchJob(this.job);
        this.render();
        await this.resume();
    }

    async pause(): Promise<void> {
        this.paused = true;
        this.options.coordinator.cancelAll();
        if (this.job) {
            this.job.status = 'paused';
            await saveBatchJob(this.job);
        }
        this.render();
    }

    async resume(): Promise<void> {
        if (!this.job || this.processing || this.job.status === 'completed') return;
        this.paused = false;
        this.processing = true;
        this.job.status = 'running';
        await saveBatchJob(this.job);
        this.render();
        try {
            for (let fileIndex = 0; fileIndex < this.job.files.length && !this.paused; fileIndex++) {
                const file = this.job.files[fileIndex];
                if (file.status === 'completed') continue;
                await this.processFile(file, fileIndex);
            }
            this.job.status = this.job.files.every((file) => file.status === 'completed') ? 'completed' : 'paused';
            await saveBatchJob(this.job);
        } finally {
            this.processing = false;
            this.options.setBusy(false);
            this.render();
        }
    }

    async retry(fileId: string): Promise<void> {
        if (!this.job || this.processing) return;
        const file = this.job.files.find((candidate) => candidate.id === fileId);
        if (!file) return;
        file.status = 'pending';
        delete file.error;
        this.job.status = 'paused';
        await saveBatchJob(this.job);
        await this.resume();
    }

    async clear(): Promise<void> {
        await this.pause();
        this.job = null;
        await clearBatchJob();
        this.render();
    }

    private async processFile(file: BatchJobFile, fileIndex: number): Promise<void> {
        if (!this.job) return;
        file.status = 'processing';
        delete file.error;
        await saveBatchJob(this.job);
        this.render();
        try {
            for (let chunkIndex = file.processedChunks.length; chunkIndex < file.chunks.length; chunkIndex++) {
                if (this.paused) {
                    file.status = 'pending';
                    return;
                }
                this.options.setBusy(
                    true,
                    `${file.name}: ${chunkIndex + 1}/${file.chunks.length} · файл ${fileIndex + 1}/${this.job.files.length}`,
                );
                const result = await this.options.coordinator.run({
                    text: file.chunks[chunkIndex],
                    mode: this.job.mode,
                    customPrompt: this.job.prompt,
                });
                file.processedChunks.push(result);
                await saveBatchJob(this.job);
            }
            file.status = 'completed';
            await saveBatchJob(this.job);
        } catch (error) {
            if (this.paused || (error instanceof DOMException && error.name === 'AbortError')) {
                file.status = 'pending';
            } else {
                file.status = 'error';
                file.error = error instanceof Error ? error.message : 'Ошибка обработки файла.';
                this.options.showStatus(file.error, true);
            }
            await saveBatchJob(this.job);
        }
        this.render();
    }

    private render(): void {
        for (const url of this.urls) URL.revokeObjectURL(url);
        this.urls.clear();
        const list = document.getElementById('batchList') as HTMLElement;
        const resume = document.getElementById('resumeBatch') as HTMLButtonElement;
        const pause = document.getElementById('pauseBatch') as HTMLButtonElement;
        const clear = document.getElementById('clearBatch') as HTMLButtonElement;
        if (!this.job) {
            list.replaceChildren();
            resume.hidden = true;
            pause.hidden = true;
            clear.hidden = true;
            return;
        }
        resume.hidden = this.processing || this.job.status === 'completed';
        pause.hidden = !this.processing;
        clear.hidden = false;
        list.replaceChildren(
            ...this.job.files.map((file) => {
                const row = document.createElement('div');
                row.className = 'batch-item';
                const label = document.createElement('span');
                const progress = `${file.processedChunks.length}/${file.chunks.length}`;
                const statusLabel = {
                    pending: 'ожидает',
                    processing: 'обработка',
                    completed: 'готово',
                    error: 'ошибка',
                }[file.status];
                label.textContent = `${file.name} — ${statusLabel} · ${progress}`;
                const actions = document.createElement('div');
                actions.className = 'batch-actions';
                if (file.status === 'completed') {
                    const blob = new Blob([getBatchFileResult(file)], { type: file.type });
                    const url = URL.createObjectURL(blob);
                    this.urls.add(url);
                    const download = document.createElement('a');
                    download.href = url;
                    download.download = file.name.replace(/(\.[^.]+)?$/, '-lexisync$1');
                    download.textContent = 'Скачать';
                    actions.append(download);
                }
                if (file.status === 'error') {
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'text-button';
                    retry.textContent = 'Повторить';
                    retry.onclick = () => void this.retry(file.id);
                    actions.append(retry);
                }
                row.append(label, actions);
                return row;
            }),
        );
    }
}
