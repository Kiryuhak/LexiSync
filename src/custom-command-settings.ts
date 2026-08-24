import { t } from './i18n';
import {
    CUSTOM_COMMAND_LIMIT,
    DEFAULT_TEXT_SNIPPETS,
    deleteCustomCommand,
    deleteTextSnippet,
    SNIPPET_LIMIT,
    upsertCustomCommand,
    upsertTextSnippet,
} from './settings-store';
import type { CustomCommand, TextSnippet } from './types';

let customCommands: CustomCommand[] = [];

function showCommandStatus(message: string, isError = false): void {
    const status = document.getElementById('status');
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = isError ? 'error' : 'warning';
    status.style.display = 'block';
}

function getSnippetErrorMessage(error: unknown): string {
    const code = error instanceof Error ? error.message : '';
    if (code === 'SNIPPET_TRIGGER_EXISTS') return t('snippetDuplicate', 'Сниппет с таким триггером уже существует.');
    if (code === 'SNIPPET_LIMIT') return t('snippetLimit', 'Можно сохранить не более 20 сниппетов.');
    if (code === 'INVALID_TEXT_SNIPPET')
        return t('snippetInvalid', 'Используйте триггер из букв, цифр, дефиса или подчёркивания после символа /.');
    return code || t('saveFailed', 'Не удалось сохранить настройки.');
}

function resetCustomCommandForm(): void {
    const form = document.getElementById('customCommandForm') as HTMLFormElement | null;
    const idInput = document.getElementById('customCommandId') as HTMLInputElement | null;
    const cancelButton = document.getElementById('cancelCommandEdit') as HTMLButtonElement | null;
    form?.reset();
    if (idInput) idInput.value = '';
    if (cancelButton) cancelButton.hidden = true;
}

function renderCustomCommands(): void {
    const list = document.getElementById('customCommandList');
    if (!list) return;
    list.replaceChildren();
    if (customCommands.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = t('noCommands', 'Пока нет пользовательских команд.');
        empty.style.margin = '0 0 4px';
        list.appendChild(empty);
        return;
    }
    for (const command of customCommands) {
        const card = document.createElement('article');
        card.className = 'command-card';
        const copy = document.createElement('div');
        copy.className = 'command-card-copy';
        const name = document.createElement('strong');
        name.textContent = command.name;
        const prompt = document.createElement('span');
        prompt.textContent = command.prompt;
        copy.append(name, prompt);
        const actions = document.createElement('div');
        actions.className = 'command-card-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'command-icon-button';
        edit.title = t('edit', 'Изменить');
        edit.textContent = '✎';
        edit.setAttribute('aria-label', `${edit.title}: ${command.name}`);
        edit.onclick = () => {
            (document.getElementById('customCommandId') as HTMLInputElement).value = command.id;
            (document.getElementById('customCommandName') as HTMLInputElement).value = command.name;
            (document.getElementById('customCommandPrompt') as HTMLTextAreaElement).value = command.prompt;
            (document.getElementById('cancelCommandEdit') as HTMLButtonElement).hidden = false;
        };
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'command-icon-button';
        remove.title = t('delete', 'Удалить');
        remove.textContent = '×';
        remove.setAttribute('aria-label', `${remove.title}: ${command.name}`);
        remove.onclick = () => {
            void deleteCustomCommand(command.id)
                .then((commands) => {
                    customCommands = commands;
                    renderCustomCommands();
                })
                .catch((error) =>
                    showCommandStatus(
                        error instanceof Error ? error.message : t('saveFailed', 'Не удалось сохранить настройки.'),
                        true,
                    ),
                );
        };
        actions.append(edit, remove);
        card.append(copy, actions);
        list.appendChild(card);
    }
}

export function setupCustomCommandSettings(): void {
    const form = document.getElementById('customCommandForm') as HTMLFormElement | null;
    const idInput = document.getElementById('customCommandId') as HTMLInputElement | null;
    const nameInput = document.getElementById('customCommandName') as HTMLInputElement | null;
    const promptInput = document.getElementById('customCommandPrompt') as HTMLTextAreaElement | null;
    if (!form || !idInput || !nameInput || !promptInput) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = nameInput.value.trim().slice(0, 40);
        const prompt = promptInput.value.trim().slice(0, 2000);
        if (!name || !prompt) return;
        if (!idInput.value && customCommands.length >= CUSTOM_COMMAND_LIMIT) {
            showCommandStatus(t('commandLimit', 'Можно создать не более 8 команд.'));
            return;
        }
        try {
            const command: CustomCommand = { id: idInput.value || crypto.randomUUID(), name, prompt };
            customCommands = await upsertCustomCommand(command);
            resetCustomCommandForm();
            renderCustomCommands();
        } catch (error) {
            showCommandStatus(
                error instanceof Error ? error.message : t('saveFailed', 'Не удалось сохранить настройки.'),
                true,
            );
        }
    });
    document.getElementById('cancelCommandEdit')?.addEventListener('click', resetCustomCommandForm);
    document.querySelectorAll<HTMLButtonElement>('.preset-button').forEach((button) => {
        button.addEventListener('click', () => {
            idInput.value = '';
            nameInput.value = t(button.dataset.commandNameKey || '', button.dataset.commandName || '');
            promptInput.value = t(button.dataset.commandPromptKey || '', button.dataset.commandPrompt || '');
            nameInput.focus();
        });
    });
}

export function restoreCustomCommandSettings(value: unknown): void {
    customCommands = Array.isArray(value)
        ? value
              .filter((item): item is CustomCommand =>
                  Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item && 'prompt' in item),
              )
              .slice(0, CUSTOM_COMMAND_LIMIT)
        : [];
    renderCustomCommands();
}

let textSnippets: TextSnippet[] = [...DEFAULT_TEXT_SNIPPETS];

function resetTextSnippetForm(): void {
    const form = document.getElementById('textSnippetForm') as HTMLFormElement | null;
    const idInput = document.getElementById('textSnippetId') as HTMLInputElement | null;
    const cancelButton = document.getElementById('cancelSnippetEdit') as HTMLButtonElement | null;
    form?.reset();
    if (idInput) idInput.value = '';
    if (cancelButton) cancelButton.hidden = true;
}

function renderTextSnippets(): void {
    const list = document.getElementById('textSnippetsList');
    if (!list) return;
    list.replaceChildren();
    if (textSnippets.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = t('noSnippets', 'Пока нет сохранённых сниппетов.');
        empty.style.margin = '0 0 4px';
        list.appendChild(empty);
        return;
    }
    for (const snippet of textSnippets) {
        const card = document.createElement('article');
        card.className = 'snippet-card';
        const copy = document.createElement('div');
        copy.className = 'command-card-copy';
        const trigger = document.createElement('strong');
        trigger.textContent = snippet.trigger;
        const content = document.createElement('span');
        content.textContent = snippet.content.length > 80 ? `${snippet.content.slice(0, 80)}…` : snippet.content;
        copy.append(trigger, content);
        const actions = document.createElement('div');
        actions.className = 'command-card-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'command-icon-button';
        edit.title = t('edit', 'Изменить');
        edit.textContent = '✎';
        edit.setAttribute('aria-label', `${edit.title}: ${snippet.trigger}`);
        edit.onclick = () => {
            (document.getElementById('textSnippetId') as HTMLInputElement).value = snippet.id;
            (document.getElementById('textSnippetTrigger') as HTMLInputElement).value = snippet.trigger;
            (document.getElementById('textSnippetContent') as HTMLTextAreaElement).value = snippet.content;
            (document.getElementById('cancelSnippetEdit') as HTMLButtonElement).hidden = false;
            document.getElementById('textSnippetForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            (document.getElementById('textSnippetTrigger') as HTMLInputElement).focus({ preventScroll: true });
        };
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'command-icon-button';
        remove.title = t('delete', 'Удалить');
        remove.textContent = '×';
        remove.setAttribute('aria-label', `${remove.title}: ${snippet.trigger}`);
        remove.onclick = () => {
            void deleteTextSnippet(snippet.id)
                .then((snippets) => {
                    textSnippets = snippets;
                    renderTextSnippets();
                })
                .catch((error) =>
                    showCommandStatus(
                        error instanceof Error ? error.message : t('saveFailed', 'Не удалось сохранить настройки.'),
                        true,
                    ),
                );
        };
        actions.append(edit, remove);
        card.append(copy, actions);
        list.appendChild(card);
    }
}

export function setupTextSnippetSettings(): void {
    const form = document.getElementById('textSnippetForm') as HTMLFormElement | null;
    const idInput = document.getElementById('textSnippetId') as HTMLInputElement | null;
    const triggerInput = document.getElementById('textSnippetTrigger') as HTMLInputElement | null;
    const contentInput = document.getElementById('textSnippetContent') as HTMLTextAreaElement | null;
    if (!form || !idInput || !triggerInput || !contentInput) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        let trigger = triggerInput.value.trim().slice(0, 40);
        if (!trigger.startsWith('/')) trigger = `/${trigger}`;
        const content = contentInput.value.trim().slice(0, 5000);
        if (!trigger || !content) return;
        if (!idInput.value && textSnippets.length >= SNIPPET_LIMIT) {
            showCommandStatus(t('snippetLimit', 'Можно сохранить не более 20 сниппетов.'));
            return;
        }
        try {
            const snippet: TextSnippet = { id: idInput.value || crypto.randomUUID(), trigger, content };
            textSnippets = await upsertTextSnippet(snippet);
            resetTextSnippetForm();
            renderTextSnippets();
        } catch (error) {
            showCommandStatus(getSnippetErrorMessage(error), true);
            triggerInput.focus();
        }
    });

    document.getElementById('cancelSnippetEdit')?.addEventListener('click', resetTextSnippetForm);
}

export function restoreTextSnippetSettings(value: unknown): void {
    textSnippets = Array.isArray(value)
        ? value
              .filter((item): item is TextSnippet =>
                  Boolean(item && typeof item === 'object' && 'id' in item && 'trigger' in item && 'content' in item),
              )
              .slice(0, SNIPPET_LIMIT)
        : [...DEFAULT_TEXT_SNIPPETS];
    renderTextSnippets();
}
