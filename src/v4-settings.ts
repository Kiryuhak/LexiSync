import { DEFAULT_BUDGET_SETTINGS } from './budget';
import { DEFAULT_THEME_CUSTOMIZATION, normalizeThemeCustomization } from './theme-customization';
import type { TextWorkflow, ThemeCustomization } from './types';
import { DEFAULT_WORKFLOWS, normalizeWorkflows } from './workflows';
import { openWorkspacePanel } from './workspace-panel';

function byId<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

function clampInteger(value: unknown, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));
}

function renderThemePreview(theme: ThemeCustomization): void {
    const preview = byId<HTMLElement>('themeEditorPreview');
    preview.style.setProperty('--editor-accent', theme.accent);
    preview.style.setProperty('--editor-radius', `${theme.radius}px`);
    preview.style.setProperty('--editor-density', String(theme.density / 100));
    preview.style.setProperty('--editor-opacity', String(theme.transparency / 100));
    preview.style.setProperty('--editor-font-scale', String(theme.fontScale / 100));
    byId<HTMLOutputElement>('themeRadiusValue').textContent = `${theme.radius} px`;
    byId<HTMLOutputElement>('themeDensityValue').textContent = `${theme.density}%`;
    byId<HTMLOutputElement>('themeTransparencyValue').textContent = `${theme.transparency}%`;
    byId<HTMLOutputElement>('themeFontScaleValue').textContent = `${theme.fontScale}%`;
}

function readThemeEditor(): ThemeCustomization {
    return normalizeThemeCustomization({
        accent: byId<HTMLInputElement>('themeAccent').value,
        radius: byId<HTMLInputElement>('themeRadius').value,
        density: byId<HTMLInputElement>('themeDensity').value,
        transparency: byId<HTMLInputElement>('themeTransparency').value,
        fontScale: byId<HTMLInputElement>('themeFontScale').value,
    });
}

function fillThemeEditor(theme: ThemeCustomization): void {
    byId<HTMLInputElement>('themeAccent').value = theme.accent;
    byId<HTMLInputElement>('themeRadius').value = String(theme.radius);
    byId<HTMLInputElement>('themeDensity').value = String(theme.density);
    byId<HTMLInputElement>('themeTransparency').value = String(theme.transparency);
    byId<HTMLInputElement>('themeFontScale').value = String(theme.fontScale);
    renderThemePreview(theme);
}

async function renderWorkflowSettings(workflows: TextWorkflow[]): Promise<void> {
    const list = byId<HTMLElement>('workflowSettingsList');
    list.replaceChildren(
        ...workflows.map((workflow) => {
            const item = document.createElement('div');
            item.className = 'command-item';
            const copy = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = workflow.name;
            const description = document.createElement('small');
            description.textContent = workflow.steps.map((step) => step.name).join(' → ');
            copy.append(title, description);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'secondary-button';
            remove.textContent = 'Удалить';
            remove.disabled = workflows.length <= 1;
            remove.onclick = async () => {
                const next = workflows.filter((item) => item.id !== workflow.id);
                await chrome.storage.local.set({ workflows: next });
                await renderWorkflowSettings(next);
            };
            item.append(copy, remove);
            return item;
        }),
    );
}

export async function setupV4Settings(): Promise<void> {
    const stored = await chrome.storage.local.get({
        workflows: DEFAULT_WORKFLOWS,
        themeCustomization: DEFAULT_THEME_CUSTOMIZATION,
        liveProofreadEnabled: false,
        liveProofreadDelay: 900,
        ...DEFAULT_BUDGET_SETTINGS,
    });
    let workflows = normalizeWorkflows(stored.workflows);
    await renderWorkflowSettings(workflows);

    byId<HTMLInputElement>('liveProofreadEnabled').checked = stored.liveProofreadEnabled === true;
    byId<HTMLSelectElement>('liveProofreadDelay').value = ['600', '900', '1500', '2500'].includes(
        String(stored.liveProofreadDelay),
    )
        ? String(stored.liveProofreadDelay)
        : '900';
    byId<HTMLInputElement>('dailyRequestLimit').value = String(clampInteger(stored.dailyRequestLimit, 0, 10_000));
    byId<HTMLInputElement>('monthlyTokenLimit').value = String(clampInteger(stored.monthlyTokenLimit, 0, 100_000_000));
    byId<HTMLInputElement>('warnLargeText').checked = stored.warnLargeText !== false;
    byId<HTMLInputElement>('autoFastMode').checked = stored.autoFastMode !== false;
    fillThemeEditor(normalizeThemeCustomization(stored.themeCustomization));

    byId<HTMLInputElement>('liveProofreadEnabled').addEventListener('change', (event) => {
        void chrome.storage.local.set({ liveProofreadEnabled: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLSelectElement>('liveProofreadDelay').addEventListener('change', (event) => {
        void chrome.storage.local.set({ liveProofreadDelay: Number((event.target as HTMLSelectElement).value) });
    });
    byId<HTMLInputElement>('dailyRequestLimit').addEventListener('change', (event) => {
        const value = clampInteger((event.target as HTMLInputElement).value, 0, 10_000);
        (event.target as HTMLInputElement).value = String(value);
        void chrome.storage.local.set({ dailyRequestLimit: value });
    });
    byId<HTMLInputElement>('monthlyTokenLimit').addEventListener('change', (event) => {
        const value = clampInteger((event.target as HTMLInputElement).value, 0, 100_000_000);
        (event.target as HTMLInputElement).value = String(value);
        void chrome.storage.local.set({ monthlyTokenLimit: value });
    });
    for (const id of ['warnLargeText', 'autoFastMode'] as const) {
        byId<HTMLInputElement>(id).addEventListener('change', (event) => {
            void chrome.storage.local.set({ [id]: (event.target as HTMLInputElement).checked });
        });
    }

    for (const id of ['themeAccent', 'themeRadius', 'themeDensity', 'themeTransparency', 'themeFontScale']) {
        byId<HTMLInputElement>(id).addEventListener('input', () => {
            const theme = readThemeEditor();
            renderThemePreview(theme);
            void chrome.storage.local.set({ themeCustomization: theme });
        });
    }
    byId<HTMLButtonElement>('resetThemeEditor').addEventListener('click', () => {
        fillThemeEditor(DEFAULT_THEME_CUSTOMIZATION);
        void chrome.storage.local.set({ themeCustomization: DEFAULT_THEME_CUSTOMIZATION });
    });

    const workflowForm = byId<HTMLFormElement>('workflowForm');
    workflowForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = byId<HTMLInputElement>('workflowName').value.trim();
        const prompt = byId<HTMLTextAreaElement>('workflowPrompt').value.trim();
        if (!name || !prompt || workflows.length >= 12) return;
        const id = crypto.randomUUID();
        workflows = [
            ...workflows,
            {
                id,
                name,
                steps: [
                    ...(byId<HTMLInputElement>('workflowSpellcheck').checked
                        ? [{ id: `${id}-spellcheck`, name: 'Исправить ошибки', mode: 'spellcheck' as const }]
                        : []),
                    { id: `${id}-custom`, name: name, mode: 'custom' as const, prompt },
                ],
            },
        ];
        await chrome.storage.local.set({ workflows });
        await renderWorkflowSettings(workflows);
        workflowForm.reset();
        byId<HTMLInputElement>('workflowSpellcheck').checked = true;
    });
    byId<HTMLButtonElement>('resetWorkflows').addEventListener('click', async () => {
        workflows = DEFAULT_WORKFLOWS;
        await chrome.storage.local.set({ workflows });
        await renderWorkflowSettings(workflows);
    });
    byId<HTMLButtonElement>('openSidepanel').addEventListener('click', async () => {
        await openWorkspacePanel();
    });
}
