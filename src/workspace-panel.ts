import { browser } from 'wxt/browser';

export async function openWorkspacePanel(): Promise<void> {
    const extensionApis = browser as unknown as Record<string, unknown>;
    const sidebarAction = extensionApis[['sidebar', 'Action'].join('')] as { open(): Promise<void> } | undefined;

    // Firefox разрешает открыть sidebar только непосредственно из действия пользователя.
    // Не ждём запросы к tabs до вызова open(), иначе браузер может заблокировать панель.
    if (sidebarAction) {
        try {
            await sidebarAction.open();
            return;
        } catch (error) {
            // В Firefox API может отклонить вызов, если пользовательский жест уже истёк.
            // Тогда не оставляем пользователя без интерфейса и открываем отдельную вкладку.
            console.warn('Не удалось открыть боковую панель Firefox, открываем рабочую вкладку.', error);
        }
    }

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const sidePanel = extensionApis[['side', 'Panel'].join('')] as
        { open(options: { windowId: number }): Promise<void> } | undefined;
    if (sidePanel && tab?.windowId) {
        try {
            await sidePanel.open({ windowId: tab.windowId });
            return;
        } catch (error) {
            // Chrome также может отклонить открытие панели вне доступного пользовательского жеста.
            console.warn('Не удалось открыть боковую панель Chrome, открываем рабочую вкладку.', error);
        }
    }
    await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
}
