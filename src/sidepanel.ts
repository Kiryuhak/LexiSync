import { browser } from 'wxt/browser';
import { applyAppearanceStyle } from './appearance-style';
import { getLocalDayKey, getMonthUsage } from './budget';
import { copyText } from './clipboard';
import { localizeDocument } from './i18n';
import { RequestCoordinator } from './request-coordinator';
import { SidepanelBatchController } from './sidepanel-batch-controller';
import { addSidepanelHistory, renderSidepanelHistory } from './sidepanel-history';
import { SIDEPANEL_COMMANDS, VARIANT_PRESETS, type SidepanelCommand } from './sidepanel-model';
import { applyResultToPage, readPageSelection, undoResultOnPage } from './sidepanel-page-bridge';
import { applyThemeCustomization } from './theme-customization';
import type { CustomCommand, HistoryItem, TextWorkflow, UsageStats } from './types';
import { EMPTY_USAGE_STATS } from './usage-stats';
import { DEFAULT_WORKFLOWS, normalizeWorkflows } from './workflows';

const sourceText = document.getElementById('sourceText') as HTMLTextAreaElement;
const resultText = document.getElementById('resultText') as HTMLTextAreaElement;
const resultCard = document.getElementById('resultCard') as HTMLElement;
const resultMode = document.getElementById('resultMode') as HTMLElement;
const progressCard = document.getElementById('progressCard') as HTMLElement;
const progressLabel = document.getElementById('progressLabel') as HTMLElement;
const progress = document.getElementById('progress') as HTMLProgressElement;
const status = document.getElementById('status') as HTMLElement;
const historyList = document.getElementById('historyList') as HTMLElement;
const undoResult = document.getElementById('undoResult') as HTMLButtonElement;

const interactiveRequests = new RequestCoordinator();
const liveRequests = new RequestCoordinator();
const batchRequests = new RequestCoordinator();
const batchController = new SidepanelBatchController({
    coordinator: batchRequests,
    setBusy,
    showStatus,
});

let paletteCommands = SIDEPANEL_COMMANDS;
let liveTimer: number | undefined;
let draftTimer: number | undefined;

function showStatus(message: string, error = false): void {
    status.textContent = message;
    status.style.background = error ? '#b3261e' : '#323038';
    status.hidden = false;
    window.setTimeout(() => (status.hidden = true), 2600);
}

function setBusy(value: boolean, label = 'Обработка…'): void {
    progressCard.hidden = !value;
    progressLabel.textContent = label;
    progress.removeAttribute('value');
}

async function allowLargeText(text: string): Promise<boolean> {
    if (text.length < 8_000) return true;
    const stored = await browser.storage.local.get({ warnLargeText: true });
    return (
        stored.warnLargeText === false ||
        window.confirm('Текст большой и может потребовать больше токенов. Продолжить?')
    );
}

async function processText(command: SidepanelCommand, text = sourceText.value, saveHistory = true): Promise<string> {
    if (!text.trim()) throw new Error('Сначала добавьте текст.');
    if (!(await allowLargeText(text))) throw new Error('Обработка отменена.');
    setBusy(true, command.name);
    try {
        const result = await interactiveRequests.run({
            text,
            mode: command.mode,
            customPrompt: command.prompt,
        });
        resultText.value = result;
        resultMode.textContent = command.name;
        resultCard.hidden = false;
        if (saveHistory) {
            await addSidepanelHistory({
                mode: command.mode,
                original: text,
                result,
                customName: command.mode === 'custom' ? command.name : undefined,
            });
            void renderHistory();
        }
        return result;
    } finally {
        setBusy(false);
    }
}

function renderCommands(filter = ''): void {
    const list = document.getElementById('commandList') as HTMLElement;
    const normalized = filter.trim().toLocaleLowerCase();
    list.replaceChildren(
        ...paletteCommands
            .filter((command) => command.name.toLocaleLowerCase().includes(normalized))
            .map((command) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'command';
                button.textContent = command.name;
                button.onclick = () => void processText(command).catch((error) => showStatus(error.message, true));
                return button;
            }),
    );
}

async function renderWorkflows(): Promise<void> {
    const stored = await browser.storage.local.get({ workflows: DEFAULT_WORKFLOWS });
    const workflows = normalizeWorkflows(stored.workflows);
    const list = document.getElementById('workflowList') as HTMLElement;
    list.replaceChildren(
        ...workflows.map((workflow: TextWorkflow) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'workflow';
            const title = document.createElement('strong');
            title.textContent = workflow.name;
            const steps = document.createElement('span');
            steps.textContent = workflow.steps.map((step) => step.name).join(' → ');
            button.append(title, steps);
            button.onclick = () => void runWorkflow(workflow);
            return button;
        }),
    );
}

async function runWorkflow(workflow: TextWorkflow): Promise<void> {
    let current = sourceText.value.trim();
    if (!current) return showStatus('Сначала добавьте текст.', true);
    if (!(await allowLargeText(current))) return;
    try {
        for (let index = 0; index < workflow.steps.length; index++) {
            const step = workflow.steps[index];
            setBusy(true, `${workflow.name}: ${index + 1}/${workflow.steps.length} — ${step.name}`);
            current = await interactiveRequests.run({
                text: current,
                mode: step.mode,
                customPrompt: step.prompt,
            });
        }
        resultText.value = current;
        resultMode.textContent = workflow.name;
        resultCard.hidden = false;
        await addSidepanelHistory({
            mode: 'custom',
            original: sourceText.value,
            result: current,
            customName: workflow.name,
        });
        showStatus('Цепочка выполнена.');
    } catch (error) {
        showStatus(error instanceof Error ? error.message : 'Цепочка прервана.', true);
    } finally {
        setBusy(false);
    }
}

function selectHistoryItem(item: HistoryItem): void {
    sourceText.value = item.original;
    resultText.value = item.result;
    resultMode.textContent = item.customName || item.mode;
    resultCard.hidden = false;
    updateCount();
}

function renderHistory(): Promise<void> {
    return renderSidepanelHistory(historyList, selectHistoryItem);
}

async function renderUsage(): Promise<void> {
    const stored = await browser.storage.local.get({ usageStats: EMPTY_USAGE_STATS });
    const stats = stored.usageStats as UsageStats;
    const today = stats.daily?.[getLocalDayKey()] || { requests: 0, tokens: 0 };
    const month = getMonthUsage(stats);
    document.getElementById('usageToday')!.textContent = `${today.requests} запросов сегодня`;
    document.getElementById('usageMonth')!.textContent = `≈ ${month.tokens.toLocaleString('ru-RU')} токенов за месяц`;
}

function updateCount(): void {
    document.getElementById('sourceCount')!.textContent = `${sourceText.value.length.toLocaleString('ru-RU')} знаков`;
}

async function makeVariants(): Promise<void> {
    const base = resultText.value || sourceText.value;
    if (!base.trim()) return showStatus('Сначала добавьте текст.', true);
    setBusy(true, 'Создаю варианты…');
    const results: Array<{ name: string; text: string }> = [];
    try {
        for (let index = 0; index < VARIANT_PRESETS.length; index++) {
            const preset = VARIANT_PRESETS[index];
            setBusy(true, `Вариант ${index + 1}/${VARIANT_PRESETS.length} — ${preset.name}`);
            results.push({
                name: preset.name,
                text: await interactiveRequests.run({
                    text: base,
                    mode: 'custom',
                    customPrompt: preset.prompt,
                }),
            });
        }
        const list = document.getElementById('variantList') as HTMLElement;
        list.replaceChildren(
            ...results.map((variant) => {
                const item = document.createElement('div');
                item.className = 'variant';
                const label = document.createElement('strong');
                label.textContent = variant.name;
                const preview = document.createElement('span');
                preview.textContent = variant.text;
                const select = document.createElement('button');
                select.type = 'button';
                select.className = 'text-button';
                select.textContent = 'Выбрать';
                select.onclick = () => {
                    resultText.value = variant.text;
                    resultMode.textContent = variant.name;
                };
                item.append(label, preview, select);
                return item;
            }),
        );
    } catch (error) {
        showStatus(error instanceof Error ? error.message : 'Не удалось создать варианты.', true);
    } finally {
        setBusy(false);
    }
}

async function initialize(): Promise<void> {
    localizeDocument();
    const stored = await browser.storage.local.get({
        selectedTheme: 'auto',
        visualStyle: 'liquid-glass',
        themeCustomization: {},
        liveProofreadEnabled: false,
        sidepanelDraft: '',
        customCommands: [],
    });
    const isDark =
        stored.selectedTheme === 'dark' ||
        (stored.selectedTheme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.toggleAttribute('data-theme', isDark);
    applyAppearanceStyle(document.documentElement, stored.visualStyle);
    applyThemeCustomization(document.documentElement, stored.themeCustomization);
    sourceText.value = String(stored.sidepanelDraft || '');
    const customCommands = Array.isArray(stored.customCommands) ? (stored.customCommands as CustomCommand[]) : [];
    paletteCommands = [
        ...SIDEPANEL_COMMANDS,
        ...customCommands.slice(0, 8).map((command) => ({
            id: command.id,
            name: command.name,
            mode: 'custom' as const,
            prompt: command.prompt,
        })),
    ];
    (document.getElementById('liveProofread') as HTMLInputElement).checked = stored.liveProofreadEnabled === true;
    updateCount();
    renderCommands();
    await Promise.all([renderWorkflows(), renderHistory(), renderUsage(), batchController.initialize()]);
}

sourceText.addEventListener('input', () => {
    updateCount();
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => void browser.storage.local.set({ sidepanelDraft: sourceText.value }), 500);
    window.clearTimeout(liveTimer);
    liveRequests.cancelAll();
    const enabled = (document.getElementById('liveProofread') as HTMLInputElement).checked;
    if (enabled && sourceText.value.trim().length >= 12) {
        const snapshot = sourceText.value;
        liveTimer = window.setTimeout(async () => {
            try {
                const result = await liveRequests.run({ text: snapshot, mode: 'spellcheck' });
                if (sourceText.value !== snapshot) return;
                resultText.value = result;
                resultMode.textContent = 'Проверка при вводе';
                resultCard.hidden = false;
            } catch (error) {
                if (!(error instanceof DOMException && error.name === 'AbortError'))
                    showStatus(error instanceof Error ? error.message : 'Ошибка проверки.', true);
            }
        }, 900);
    }
});

document.getElementById('liveProofread')!.addEventListener('change', (event) => {
    void browser.storage.local.set({ liveProofreadEnabled: (event.target as HTMLInputElement).checked });
});
document
    .getElementById('commandSearch')!
    .addEventListener('input', (event) => renderCommands((event.target as HTMLInputElement).value));
document.addEventListener('keydown', (event) => {
    if (
        (event.ctrlKey || event.metaKey) &&
        (event.code === 'KeyK' || event.key.toLocaleLowerCase() === 'k' || event.key.toLocaleLowerCase() === 'л')
    ) {
        event.preventDefault();
        (document.getElementById('commandSearch') as HTMLInputElement).focus();
    }
});
document.getElementById('cancelRequest')!.addEventListener('click', () => {
    interactiveRequests.cancelAll();
    liveRequests.cancelAll();
    void batchController.pause();
    setBusy(false);
});
document.getElementById('takeSelection')!.addEventListener('click', () => {
    void readPageSelection()
        .then((text) => {
            sourceText.value = text;
            updateCount();
        })
        .catch((error) => showStatus(error.message, true));
});
document.getElementById('copyResult')!.addEventListener('click', () => {
    void copyText(resultText.value)
        .then(() => showStatus('Скопировано.'))
        .catch(() => showStatus('Не удалось скопировать.', true));
});
document.getElementById('applyResult')!.addEventListener('click', () => {
    void applyResultToPage(resultText.value)
        .then(() => {
            undoResult.hidden = false;
            showStatus('Текст заменён.');
        })
        .catch((error) => showStatus(error.message, true));
});
undoResult.addEventListener('click', () => {
    void undoResultOnPage()
        .then(() => {
            undoResult.hidden = true;
            showStatus('Замена отменена.');
        })
        .catch((error) => showStatus(error.message, true));
});
document.getElementById('makeVariants')!.addEventListener('click', () => void makeVariants());
document.getElementById('runBatch')!.addEventListener('click', () => {
    const input = document.getElementById('batchFiles') as HTMLInputElement;
    const mode = (document.getElementById('batchMode') as HTMLSelectElement).value as 'spellcheck' | 'style' | 'custom';
    const prompt =
        mode === 'custom'
            ? 'Сократи текст без потери смысла. Сохрани Markdown-разметку и язык. Верни только результат.'
            : undefined;
    void batchController.start([...(input.files || [])], mode, prompt).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'ACTIVE_JOB_EXISTS') {
            if (confirm('Незавершённое задание будет заменено. Продолжить?')) {
                void batchController
                    .start([...(input.files || [])], mode, prompt, true)
                    .catch((err: unknown) => showStatus(err instanceof Error ? err.message : String(err), true));
            }
            return;
        }
        showStatus(error instanceof Error ? error.message : String(error), true);
    });
});
document.getElementById('pauseBatch')!.addEventListener('click', () => void batchController.pause());
document.getElementById('resumeBatch')!.addEventListener('click', () => void batchController.resume());
document.getElementById('clearBatch')!.addEventListener('click', () => void batchController.clear());
document.getElementById('openOptions')!.addEventListener('click', () => void browser.runtime.openOptionsPage());
document.getElementById('openBudget')!.addEventListener('click', () => void browser.runtime.openOptionsPage());
document.getElementById('openHistory')!.addEventListener('click', () => {
    void browser.tabs.create({ url: browser.runtime.getURL('/lexisync-history.html') });
});
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.usageStats) void renderUsage();
    if (changes.aiHistory) void renderHistory();
});
window.addEventListener('pagehide', () => {
    window.clearTimeout(draftTimer);
    void browser.storage.local.set({ sidepanelDraft: sourceText.value });
    interactiveRequests.cancelAll();
    liveRequests.cancelAll();
    void batchController.pause();
});

void initialize();
