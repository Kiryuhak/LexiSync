interface SidePanelApi {
    open(options: { windowId: number }): Promise<void>;
}

interface SidebarActionApi {
    open(): Promise<void>;
}

export async function openWorkspacePanel(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const extensionApis = chrome as unknown as Record<string, unknown>;
    const sidePanel = extensionApis[['side', 'Panel'].join('')] as SidePanelApi | undefined;
    if (sidePanel && tab?.windowId) {
        await sidePanel.open({ windowId: tab.windowId });
        return;
    }
    const sidebarAction = extensionApis[['sidebar', 'Action'].join('')] as SidebarActionApi | undefined;
    if (sidebarAction) {
        await sidebarAction.open();
        return;
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
}
