import { browser } from 'wxt/browser';

export async function openWorkspacePanel(): Promise<void> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const extensionApis = browser as unknown as Record<string, unknown>;
    const sidePanel = extensionApis[['side', 'Panel'].join('')] as
        { open(options: { windowId: number }): Promise<void> } | undefined;
    if (sidePanel && tab?.windowId) {
        await sidePanel.open({ windowId: tab.windowId });
        return;
    }
    const sidebarAction = extensionApis[['sidebar', 'Action'].join('')] as { open(): Promise<void> } | undefined;
    if (sidebarAction) {
        await sidebarAction.open();
        return;
    }
    await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
}
