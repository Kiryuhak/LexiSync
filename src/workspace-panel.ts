import { browser } from 'wxt/browser';

export async function openWorkspacePanel(): Promise<void> {
    const extensionApis = browser as unknown as Record<string, unknown>;
    const sidebarAction = extensionApis[['sidebar', 'Action'].join('')] as { open(): Promise<void> } | undefined;

    // Firefox разрешает открыть sidebar только непосредственно из действия пользователя.
    // Не ждём запросы к tabs до вызова open(), иначе браузер может заблокировать панель.
    if (sidebarAction) {
        await sidebarAction.open();
        return;
    }

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const sidePanel = extensionApis[['side', 'Panel'].join('')] as
        { open(options: { windowId: number }): Promise<void> } | undefined;
    if (sidePanel && tab?.windowId) {
        await sidePanel.open({ windowId: tab.windowId });
        return;
    }
    await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
}
