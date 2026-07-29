import { t } from './i18n';
import { deleteCustomCommand, upsertCustomCommand } from './settings-store';
import type { CustomCommand } from './types';

let customCommands: CustomCommand[] = [];

function showCommandStatus(message: string, isError = false): void {
    const status = document.getElementById('status');
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? '#b42318' : '#d97706';
    status.style.display = 'block';
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
        if (!idInput.value && customCommands.length >= 8) {
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
              .slice(0, 8)
        : [];
    renderCustomCommands();
}
