import { applyAppearanceStyle } from './appearance-style';
import { copyText } from './clipboard';
import { getLocalDayKey, getMonthUsage } from './budget';
import { localizeDocument } from './i18n';
import { applyThemeCustomization } from './theme-customization';
import type { CustomCommand, HistoryItem, RequestMode, StreamResponse, TextWorkflow, UsageStats } from './types';
import { EMPTY_USAGE_STATS } from './usage-stats';
import { DEFAULT_WORKFLOWS, normalizeWorkflows } from './workflows';

interface Command {
    id: string;
    name: string;
    mode: RequestMode;
    prompt?: string;
}

const COMMANDS: Command[] = [
    { id: 'spellcheck', name: 'Исправить ошибки', mode: 'spellcheck' },
    { id: 'style', name: 'Улучшить стиль', mode: 'style' },
    { id: 'emoji', name: 'Добавить эмодзи', mode: 'emoji' },
    { id: 'translate', name: 'Перевести', mode: 'translate' },
    {
        id: 'shorter',
        name: 'Сделать короче',
        mode: 'custom',
        prompt: 'Сократи текст без потери смысла и сохрани язык исходного текста. Верни только готовый текст.',
    },
    {
        id: 'formal',
        name: 'Сделать формальнее',
        mode: 'custom',
        prompt: 'Перепиши текст в вежливом деловом стиле, сохрани язык и факты. Верни только готовый текст.',
    },
];
let paletteCommands = COMMANDS;

const sourceText = document.getElementById('sourceText') as HTMLTextAreaElement;
const resultText = document.getElementById('resultText') as HTMLTextAreaElement;
const resultCard = document.getElementById('resultCard') as HTMLElement;
const resultMode = document.getElementById('resultMode') as HTMLElement;
const progressCard = document.getElementById('progressCard') as HTMLElement;
const progressLabel = document.getElementById('progressLabel') as HTMLElement;
const progress = document.getElementById('progress') as HTMLProgressElement;
const status = document.getElementById('status') as HTMLElement;
let activePorts = new Set<chrome.runtime.Port>();
let liveTimer: number | undefined;

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

function runRequest(text: string, mode: RequestMode, prompt?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'mistralStream' });
        activePorts.add(port);
        let result = '';
        port.onMessage.addListener((message: StreamResponse) => {
            if (message.status === 'chunk') result += message.text || '';
            if (message.status === 'done') {
                activePorts.delete(port);
                port.disconnect();
                resolve(result.trim());
            } else if (message.status === 'error' || message.status === 'cancelled') {
                activePorts.delete(port);
                port.disconnect();
                reject(new Error(message.error || 'Запрос не выполнен.'));
            }
        });
        port.onDisconnect.addListener(() => activePorts.delete(port));
        port.postMessage({
            action: 'callMistral',
            mode,
            text,
            customPrompt: prompt,
            targetLang: 'English',
            allowPageContext: false,
        });
    });
}

async function allowLargeText(text: string): Promise<boolean> {
    if (text.length < 8_000) return true;
    const stored = await chrome.storage.local.get({ warnLargeText: true });
    return (
        stored.warnLargeText === false ||
        window.confirm('Текст большой и может потребовать больше токенов. Продолжить?')
    );
}

async function processText(command: Command, text = sourceText.value): Promise<string> {
    if (!text.trim()) throw new Error('Сначала добавьте текст.');
    if (!(await allowLargeText(text))) throw new Error('Обработка отменена.');
    setBusy(true, command.name);
    try {
        const result = await runRequest(text, command.mode, command.prompt);
        resultText.value = result;
        resultMode.textContent = command.name;
        resultCard.hidden = false;
        await chrome.runtime.sendMessage({
            action: 'storageMutation',
            domain: 'history',
            mutation: 'add',
            payload: {
                item: {
                    id: Date.now(),
                    mode: command.mode,
                    original: text,
                    result,
                    date: new Date().toISOString(),
                    customName: command.mode === 'custom' ? command.name : undefined,
                },
            },
        });
        void renderHistory();
        return result;
    } finally {
        setBusy(false);
    }
}

function renderCommands(filter = ''): void {
    const list = document.getElementById('commandList') as HTMLElement;
    const normalized = filter.trim().toLocaleLowerCase('ru-RU');
    list.replaceChildren(
        ...paletteCommands
            .filter((command) => command.name.toLocaleLowerCase('ru-RU').includes(normalized))
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
    const stored = await chrome.storage.local.get({ workflows: DEFAULT_WORKFLOWS });
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
            button.onclick = async () => {
                let current = sourceText.value.trim();
                if (!current) return showStatus('Сначала добавьте текст.', true);
                if (!(await allowLargeText(current))) return;
                try {
                    for (let index = 0; index < workflow.steps.length; index++) {
                        const step = workflow.steps[index];
                        setBusy(true, `${workflow.name}: ${index + 1}/${workflow.steps.length} — ${step.name}`);
                        current = await runRequest(current, step.mode, step.prompt);
                    }
                    resultText.value = current;
                    resultMode.textContent = workflow.name;
                    resultCard.hidden = false;
                    showStatus('Цепочка выполнена.');
                } catch (error) {
                    showStatus(error instanceof Error ? error.message : 'Цепочка прервана.', true);
                } finally {
                    setBusy(false);
                }
            };
            return button;
        }),
    );
}

async function renderHistory(): Promise<void> {
    const stored = await chrome.storage.local.get({ aiHistory: [] });
    const items = (Array.isArray(stored.aiHistory) ? (stored.aiHistory as HistoryItem[]) : [])
        .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || b.id - a.id)
        .slice(0, 6);
    const list = document.getElementById('historyList') as HTMLElement;
    if (!items.length) {
        const empty = document.createElement('span');
        empty.className = 'hint';
        empty.textContent = 'Здесь появятся последние результаты.';
        list.replaceChildren(empty);
        return;
    }
    list.replaceChildren(
        ...items.map((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'history-item';
            const title = document.createElement('strong');
            title.textContent = `${item.favorite ? '★ ' : ''}${item.customName || item.mode}`;
            const preview = document.createElement('span');
            preview.textContent = item.result;
            button.append(title, preview);
            button.onclick = () => {
                sourceText.value = item.original;
                resultText.value = item.result;
                resultMode.textContent = item.customName || item.mode;
                resultCard.hidden = false;
                updateCount();
            };
            return button;
        }),
    );
}

async function renderUsage(): Promise<void> {
    const stored = await chrome.storage.local.get({ usageStats: EMPTY_USAGE_STATS });
    const stats = stored.usageStats as UsageStats;
    const today = stats.daily?.[getLocalDayKey()] || { requests: 0, tokens: 0 };
    const month = getMonthUsage(stats);
    document.getElementById('usageToday')!.textContent = `${today.requests} запросов сегодня`;
    document.getElementById('usageMonth')!.textContent = `≈ ${month.tokens.toLocaleString('ru-RU')} токенов за месяц`;
}

function updateCount(): void {
    document.getElementById('sourceCount')!.textContent = `${sourceText.value.length.toLocaleString('ru-RU')} знаков`;
}

async function takeSelection(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Активная вкладка не найдена.');
    const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                return active.value.slice(active.selectionStart || 0, active.selectionEnd || 0);
            }
            return window.getSelection()?.toString() || '';
        },
    });
    const text = String(result?.result || '');
    if (!text) throw new Error('На странице нет выделенного текста.');
    sourceText.value = text;
    updateCount();
}

async function applyToPage(): Promise<void> {
    const text = resultText.value;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !text) throw new Error('Нет текста для замены.');
    const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [text],
        func: (replacement) => {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                const start = active.selectionStart ?? active.value.length;
                const end = active.selectionEnd ?? start;
                active.setRangeText(replacement, start, end, 'end');
                active.dispatchEvent(
                    new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: replacement }),
                );
                return true;
            }
            const selection = window.getSelection();
            if (!selection?.rangeCount) return false;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(replacement));
            return true;
        },
    });
    if (!result?.result) throw new Error('Сначала поставьте курсор или выделите текст на странице.');
    showStatus('Текст заменён.');
}

async function makeVariants(): Promise<void> {
    const base = resultText.value || sourceText.value;
    if (!base.trim()) return showStatus('Сначала добавьте текст.', true);
    const variants = [
        ['Короче', 'Сделай текст заметно короче и яснее, сохрани язык и смысл. Верни только результат.'],
        ['Нейтрально', 'Перепиши текст в спокойном нейтральном тоне, сохрани язык и факты. Верни только результат.'],
        [
            'Живее',
            'Сделай текст более живым и естественным без лишней эмоциональности, сохрани язык. Верни только результат.',
        ],
    ];
    setBusy(true, 'Создаю варианты…');
    try {
        const results = await Promise.all(
            variants.map(async ([name, prompt]) => ({ name, text: await runRequest(base, 'custom', prompt) })),
        );
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

async function runBatch(): Promise<void> {
    const input = document.getElementById('batchFiles') as HTMLInputElement;
    const files = [...(input.files || [])].slice(0, 10);
    if (!files.length) return showStatus('Выберите TXT или MD-файлы.', true);
    if (files.some((file) => file.size > 2_000_000)) return showStatus('Один из файлов больше 2 МБ.', true);
    const mode = (document.getElementById('batchMode') as HTMLSelectElement).value as RequestMode;
    const prompt =
        mode === 'custom'
            ? 'Сократи текст без потери смысла. Сохрани Markdown-разметку и язык. Верни только результат.'
            : undefined;
    const list = document.getElementById('batchList') as HTMLElement;
    list.replaceChildren();
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex];
        const row = document.createElement('div');
        row.className = 'batch-item';
        const label = document.createElement('span');
        label.textContent = `${file.name} — обработка…`;
        row.append(label);
        list.append(row);
        try {
            const source = await file.text();
            const chunks = source.match(/[\s\S]{1,6000}(?:\n\n|$)/g) || [source];
            const processed: string[] = [];
            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                setBusy(
                    true,
                    `${file.name}: ${chunkIndex + 1}/${chunks.length} · файл ${fileIndex + 1}/${files.length}`,
                );
                processed.push(await runRequest(chunks[chunkIndex], mode, prompt));
            }
            const blob = new Blob([processed.join('\n\n')], { type: file.type || 'text/plain' });
            const url = URL.createObjectURL(blob);
            const download = document.createElement('a');
            download.href = url;
            download.download = file.name.replace(/(\.[^.]+)?$/, '-lexisync$1');
            download.textContent = 'Скачать';
            download.onclick = () => window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            label.textContent = `${file.name} — готово`;
            row.append(download);
        } catch (error) {
            label.textContent = `${file.name} — ошибка`;
            showStatus(error instanceof Error ? error.message : 'Ошибка обработки файла.', true);
        }
    }
    setBusy(false);
}

async function initialize(): Promise<void> {
    localizeDocument();
    const stored = await chrome.storage.local.get({
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
        ...COMMANDS,
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
    await Promise.all([renderWorkflows(), renderHistory(), renderUsage()]);
}

sourceText.addEventListener('input', () => {
    updateCount();
    void chrome.storage.local.set({ sidepanelDraft: sourceText.value });
    window.clearTimeout(liveTimer);
    const enabled = (document.getElementById('liveProofread') as HTMLInputElement).checked;
    if (enabled && sourceText.value.trim().length >= 12) {
        liveTimer = window.setTimeout(
            () =>
                void processText(COMMANDS[0]).catch((error) => {
                    showStatus(error.message, true);
                }),
            900,
        );
    }
});
document.getElementById('liveProofread')!.addEventListener('change', (event) => {
    void chrome.storage.local.set({ liveProofreadEnabled: (event.target as HTMLInputElement).checked });
});
document
    .getElementById('commandSearch')!
    .addEventListener('input', (event) => renderCommands((event.target as HTMLInputElement).value));
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        (document.getElementById('commandSearch') as HTMLInputElement).focus();
    }
});
document.getElementById('cancelRequest')!.addEventListener('click', () => {
    for (const port of activePorts) port.postMessage({ action: 'cancelMistral' });
    activePorts = new Set();
    setBusy(false);
});
document
    .getElementById('takeSelection')!
    .addEventListener('click', () => void takeSelection().catch((error) => showStatus(error.message, true)));
document.getElementById('copyResult')!.addEventListener(
    'click',
    () =>
        void copyText(resultText.value)
            .then(() => showStatus('Скопировано.'))
            .catch(() => showStatus('Не удалось скопировать.', true)),
);
document
    .getElementById('applyResult')!
    .addEventListener('click', () => void applyToPage().catch((error) => showStatus(error.message, true)));
document.getElementById('makeVariants')!.addEventListener('click', () => void makeVariants());
document.getElementById('runBatch')!.addEventListener('click', () => void runBatch());
document.getElementById('openOptions')!.addEventListener('click', () => void chrome.runtime.openOptionsPage());
document.getElementById('openBudget')!.addEventListener('click', () => void chrome.runtime.openOptionsPage());
document
    .getElementById('openHistory')!
    .addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('lexisync-history.html') }));
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.usageStats) void renderUsage();
    if (changes.aiHistory) void renderHistory();
});
void initialize();
