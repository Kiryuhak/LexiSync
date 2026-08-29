import { enqueueStorageMutation } from './storage-queue';
import type { CustomCommand, StyleProfile, TextSnippet } from './types';
import { normalizeDisabledSites, normalizeSiteEntries } from './privacy';
import { clearAllSecrets } from './secret-store';
import {
    DEFAULT_TEXT_SNIPPETS,
    isTextSnippet,
    normalizeTextSnippet,
    normalizeTextSnippets,
    SNIPPET_LIMIT,
} from './text-snippets';

export { DEFAULT_TEXT_SNIPPETS, SNIPPET_LIMIT } from './text-snippets';

export type SettingsMutation =
    | 'addPersonalDictionaryWord'
    | 'addAdaptiveBlockedWord'
    | 'upsertCustomCommand'
    | 'deleteCustomCommand'
    | 'replaceStyleProfiles'
    | 'setSitePreference'
    | 'upsertTextSnippet'
    | 'deleteTextSnippet'
    | 'factoryReset';

export type SitePreference = 'access' | 'suggestions' | 'history' | 'context';

export const CUSTOM_COMMAND_LIMIT = 8;

interface SettingsMutationPayload {
    value?: unknown;
    command?: unknown;
    snippet?: unknown;
    id?: unknown;
    profiles?: unknown;
    activeProfileId?: unknown;
    preference?: unknown;
    hostname?: unknown;
    enabled?: unknown;
}

function isCustomCommand(value: unknown): value is CustomCommand {
    if (!value || typeof value !== 'object') return false;
    const command = value as Partial<CustomCommand>;
    return (
        typeof command.id === 'string' &&
        typeof command.name === 'string' &&
        command.name.trim().length > 0 &&
        typeof command.prompt === 'string' &&
        command.prompt.trim().length > 0
    );
}

function normalizeCommand(command: CustomCommand): CustomCommand {
    return {
        id: command.id.slice(0, 100),
        name: command.name.trim().slice(0, 40),
        prompt: command.prompt.trim().slice(0, 2000),
    };
}

async function requestSettingsMutation<T>(mutation: SettingsMutation, payload: SettingsMutationPayload): Promise<T> {
    const response = await chrome.runtime.sendMessage({
        action: 'storageMutation',
        domain: 'settings',
        mutation,
        payload,
    });
    if (response?.ok !== true) throw new Error(response?.error || 'SETTINGS_MUTATION_FAILED');
    return response.data as T;
}

export function addPersonalDictionaryWord(value: string): Promise<string[]> {
    return requestSettingsMutation('addPersonalDictionaryWord', { value });
}

export function addAdaptiveBlockedWord(value: string): Promise<string[]> {
    return requestSettingsMutation('addAdaptiveBlockedWord', { value });
}

export function upsertCustomCommand(command: CustomCommand): Promise<CustomCommand[]> {
    return requestSettingsMutation('upsertCustomCommand', { command });
}

export async function getTextSnippets(): Promise<TextSnippet[]> {
    const stored = await chrome.storage.local.get({ textSnippets: DEFAULT_TEXT_SNIPPETS });
    return normalizeTextSnippets(stored.textSnippets);
}

export function upsertTextSnippet(snippet: TextSnippet): Promise<TextSnippet[]> {
    return requestSettingsMutation('upsertTextSnippet', { snippet });
}

export function deleteTextSnippet(id: string): Promise<TextSnippet[]> {
    return requestSettingsMutation('deleteTextSnippet', { id });
}

export function deleteCustomCommand(id: string): Promise<CustomCommand[]> {
    return requestSettingsMutation('deleteCustomCommand', { id });
}

export function replaceStyleProfiles(profiles: StyleProfile[], activeProfileId: string): Promise<void> {
    return requestSettingsMutation('replaceStyleProfiles', { profiles, activeProfileId });
}

export function setSitePreference(preference: SitePreference, hostname: string, enabled: boolean): Promise<void> {
    return requestSettingsMutation('setSitePreference', { preference, hostname, enabled });
}

export function factoryResetAllSettings(): Promise<void> {
    return requestSettingsMutation('factoryReset', {});
}

export function applySettingsMutation(mutation: SettingsMutation, payload: SettingsMutationPayload): Promise<unknown> {
    return enqueueStorageMutation(async () => {
        if (mutation === 'addPersonalDictionaryWord' || mutation === 'addAdaptiveBlockedWord') {
            if (typeof payload.value !== 'string') throw new Error('INVALID_SETTINGS_VALUE');
            const key = mutation === 'addPersonalDictionaryWord' ? 'personalDictionary' : 'adaptiveBlockedWords';
            const normalized = payload.value.trim().slice(0, 120);
            if (!normalized) throw new Error('INVALID_SETTINGS_VALUE');
            const stored = await chrome.storage.local.get({ [key]: [] });
            const values = Array.isArray(stored[key]) ? stored[key].map(String) : [];
            if (!values.some((item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
                values.push(normalized);
            }
            const result = values.slice(0, 2000).sort((a, b) => a.localeCompare(b, 'ru'));
            await chrome.storage.local.set({ [key]: result });
            return result;
        }
        if (mutation === 'upsertCustomCommand') {
            if (!isCustomCommand(payload.command)) throw new Error('INVALID_CUSTOM_COMMAND');
            const stored = await chrome.storage.local.get({ customCommands: [] });
            const commands = Array.isArray(stored.customCommands)
                ? stored.customCommands.filter(isCustomCommand).map(normalizeCommand).slice(0, CUSTOM_COMMAND_LIMIT)
                : [];
            const command = normalizeCommand(payload.command);
            const index = commands.findIndex((item) => item.id === command.id);
            if (index >= 0) commands[index] = command;
            else if (commands.length < CUSTOM_COMMAND_LIMIT) commands.push(command);
            else throw new Error('CUSTOM_COMMAND_LIMIT');
            await chrome.storage.local.set({ customCommands: commands });
            return commands;
        }
        if (mutation === 'deleteCustomCommand') {
            if (typeof payload.id !== 'string') throw new Error('INVALID_CUSTOM_COMMAND_ID');
            const stored = await chrome.storage.local.get({ customCommands: [] });
            const commands = Array.isArray(stored.customCommands)
                ? stored.customCommands
                      .filter(isCustomCommand)
                      .map(normalizeCommand)
                      .filter((item) => item.id !== payload.id)
                      .slice(0, CUSTOM_COMMAND_LIMIT)
                : [];
            await chrome.storage.local.set({ customCommands: commands });
            return commands;
        }
        if (mutation === 'upsertTextSnippet') {
            if (!isTextSnippet(payload.snippet)) throw new Error('INVALID_TEXT_SNIPPET');
            const stored = await chrome.storage.local.get({ textSnippets: DEFAULT_TEXT_SNIPPETS });
            const snippets = normalizeTextSnippets(stored.textSnippets);
            const snippet = normalizeTextSnippet(payload.snippet);
            const index = snippets.findIndex((s) => s.id === snippet.id);
            const duplicate = snippets.find(
                (item) =>
                    item.id !== snippet.id && item.trigger.toLocaleLowerCase() === snippet.trigger.toLocaleLowerCase(),
            );
            if (duplicate) throw new Error('SNIPPET_TRIGGER_EXISTS');
            if (index >= 0) snippets[index] = snippet;
            else if (snippets.length < SNIPPET_LIMIT) snippets.push(snippet);
            else throw new Error('SNIPPET_LIMIT');
            await chrome.storage.local.set({ textSnippets: snippets });
            return snippets;
        }
        if (mutation === 'deleteTextSnippet') {
            if (typeof payload.id !== 'string') throw new Error('INVALID_SNIPPET_ID');
            const stored = await chrome.storage.local.get({ textSnippets: DEFAULT_TEXT_SNIPPETS });
            const snippets = normalizeTextSnippets(stored.textSnippets, []).filter((s) => s.id !== payload.id);
            await chrome.storage.local.set({ textSnippets: snippets });
            return snippets;
        }
        if (mutation === 'replaceStyleProfiles') {
            if (!Array.isArray(payload.profiles)) throw new Error('INVALID_STYLE_PROFILES');
            const normalizeStyleProfile = (profile: StyleProfile): StyleProfile => ({
                id: String(profile.id || '').slice(0, 100),
                name: String(profile.name || '')
                    .trim()
                    .slice(0, 100),
                tone: String(profile.tone || 'business').slice(0, 40),
                instruction: String(profile.instruction || '')
                    .trim()
                    .slice(0, 2000),
                sites: Array.isArray(profile.sites) ? profile.sites.map((s) => String(s).slice(0, 253)) : [],
            });
            const profiles = (payload.profiles.slice(0, 8) as StyleProfile[]).map(normalizeStyleProfile);
            const activeProfileId = typeof payload.activeProfileId === 'string' ? payload.activeProfileId : '';
            await chrome.storage.local.set({ styleProfiles: profiles, activeStyleProfileId: activeProfileId });
            return;
        }
        if (mutation === 'setSitePreference') {
            const preferences: Record<SitePreference, { listKey: string; globalKey?: string }> = {
                access: { listKey: 'blockedSites' },
                suggestions: { listKey: 'adaptiveDisabledSites', globalKey: 'adaptiveSuggestionsEnabled' },
                history: { listKey: 'disabledSites' },
                context: { listKey: 'contextDisabledSites', globalKey: 'sendPageContext' },
            };
            if (
                typeof payload.preference !== 'string' ||
                !Object.prototype.hasOwnProperty.call(preferences, payload.preference)
            )
                throw new Error('INVALID_SITE_PREFERENCE');
            if (typeof payload.hostname !== 'string' || typeof payload.enabled !== 'boolean')
                throw new Error('INVALID_SITE_PREFERENCE');
            const normalized = normalizeSiteEntries([payload.hostname]);
            if (normalized.invalid.length || normalized.valid.length !== 1) throw new Error('INVALID_SITE_HOSTNAME');
            const preference = payload.preference as SitePreference;
            const { listKey, globalKey } = preferences[preference];
            const stored = await chrome.storage.local.get({
                [listKey]: [],
                ...(globalKey ? { [globalKey]: false } : {}),
            });
            const hostname = normalized.valid[0];
            const sites = normalizeDisabledSites(stored[listKey]).filter((site) => site !== hostname);
            if (!payload.enabled) sites.push(hostname);
            const updates: Record<string, unknown> = { [listKey]: [...new Set(sites)].sort() };
            if (globalKey && payload.enabled) updates[globalKey] = true;
            await chrome.storage.local.set(updates);
            return;
        }
        if (mutation === 'factoryReset') {
            await chrome.storage.local.clear();
            if (chrome.storage.sync?.clear) {
                try {
                    await chrome.storage.sync.clear();
                } catch {
                    // Ignore if sync is unavailable
                }
            }
            try {
                await clearAllSecrets();
            } catch {
                // Ignore secret store reset failure
            }
            return;
        }
        throw new Error('INVALID_SETTINGS_MUTATION');
    });
}
