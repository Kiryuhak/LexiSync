import { t } from './i18n';
import { normalizeSitePatterns } from './site-profiles';
import type { StyleProfile } from './types';

let profiles: StyleProfile[] = [];
let activeProfileId = '';

function resetForm(): void {
    (document.getElementById('styleProfileForm') as HTMLFormElement | null)?.reset();
    const idInput = document.getElementById('styleProfileId') as HTMLInputElement | null;
    const cancelButton = document.getElementById('cancelStyleProfileEdit') as HTMLButtonElement | null;
    if (idInput) idInput.value = '';
    if (cancelButton) cancelButton.hidden = true;
}

function iconButton(label: string, symbol: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-icon-button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = symbol;
    button.addEventListener('click', onClick);
    return button;
}

function render(): void {
    const list = document.getElementById('styleProfileList');
    if (!list) return;
    list.replaceChildren();
    if (!profiles.length) {
        const empty = document.createElement('p');
        empty.textContent = t('noStyleProfiles', 'Пока нет профилей стиля.');
        list.appendChild(empty);
        return;
    }
    for (const profile of profiles) {
        const card = document.createElement('article');
        card.className = 'command-card';
        if (profile.id === activeProfileId) card.style.borderColor = 'var(--primary)';
        const copy = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = profile.name;
        const instruction = document.createElement('span');
        instruction.textContent = profile.instruction;
        copy.append(name, instruction);
        const sites = normalizeSitePatterns(profile.sites);
        if (sites.length) {
            const siteLabel = document.createElement('small');
            siteLabel.className = 'profile-sites';
            siteLabel.textContent = `${t('profileSitesShort', 'Автоматически:')} ${sites.join(', ')}`;
            copy.appendChild(siteLabel);
        }
        const actions = document.createElement('div');
        actions.className = 'command-card-actions';
        actions.append(
            iconButton(
                `${t('activateProfile', 'Использовать профиль')}: ${profile.name}`,
                profile.id === activeProfileId ? '✓' : '○',
                async () => {
                    activeProfileId = profile.id === activeProfileId ? '' : profile.id;
                    await chrome.storage.local.set({ activeStyleProfileId: activeProfileId });
                    render();
                },
            ),
            iconButton(`${t('edit', 'Изменить')}: ${profile.name}`, '✎', () => {
                (document.getElementById('styleProfileId') as HTMLInputElement).value = profile.id;
                (document.getElementById('styleProfileName') as HTMLInputElement).value = profile.name;
                (document.getElementById('styleProfileInstruction') as HTMLTextAreaElement).value = profile.instruction;
                (document.getElementById('styleProfileSites') as HTMLTextAreaElement).value = normalizeSitePatterns(
                    profile.sites,
                ).join('\n');
                (document.getElementById('cancelStyleProfileEdit') as HTMLButtonElement).hidden = false;
                (document.getElementById('styleProfileName') as HTMLInputElement).focus();
            }),
            iconButton(`${t('delete', 'Удалить')}: ${profile.name}`, '×', async () => {
                profiles = profiles.filter((item) => item.id !== profile.id);
                if (activeProfileId === profile.id) activeProfileId = '';
                await chrome.storage.local.set({ styleProfiles: profiles, activeStyleProfileId: activeProfileId });
                render();
            }),
        );
        card.append(copy, actions);
        list.appendChild(card);
    }
}

export function restoreStyleProfileSettings(value: unknown, activeId: unknown): void {
    profiles = Array.isArray(value)
        ? value
              .filter((item: unknown): item is StyleProfile =>
                  Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item && 'instruction' in item),
              )
              .slice(0, 8)
              .map((profile) => ({ ...profile, sites: normalizeSitePatterns(profile.sites) }))
        : [];
    activeProfileId = typeof activeId === 'string' ? activeId : '';
    render();
}

export function setupStyleProfileSettings(): void {
    const form = document.getElementById('styleProfileForm') as HTMLFormElement | null;
    const idInput = document.getElementById('styleProfileId') as HTMLInputElement | null;
    const nameInput = document.getElementById('styleProfileName') as HTMLInputElement | null;
    const instructionInput = document.getElementById('styleProfileInstruction') as HTMLTextAreaElement | null;
    const sitesInput = document.getElementById('styleProfileSites') as HTMLTextAreaElement | null;
    if (!form || !idInput || !nameInput || !instructionInput || !sitesInput) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = nameInput.value.trim().slice(0, 40);
        const instruction = instructionInput.value.trim().slice(0, 1000);
        if (!name || !instruction || (!idInput.value && profiles.length >= 8)) return;
        const existing = profiles.find((profile) => profile.id === idInput.value);
        const profile: StyleProfile = {
            id: idInput.value || crypto.randomUUID(),
            name,
            tone: existing?.tone || 'custom',
            instruction,
            sites: normalizeSitePatterns(sitesInput.value.split(/\r?\n/)),
        };
        const index = profiles.findIndex((item) => item.id === profile.id);
        if (index >= 0) profiles[index] = profile;
        else profiles.push(profile);
        if (!activeProfileId) activeProfileId = profile.id;
        await chrome.storage.local.set({ styleProfiles: profiles, activeStyleProfileId: activeProfileId });
        resetForm();
        render();
    });
    document.getElementById('cancelStyleProfileEdit')?.addEventListener('click', resetForm);
}
