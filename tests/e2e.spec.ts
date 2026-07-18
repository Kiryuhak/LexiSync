import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'path';

// ==========================================
// 1. НАСТРОЙКА БРАУЗЕРА И ВЫДАЧА ПРАВ
// ==========================================
const test = base.extend({
  context: async ({ }, use) => {
    const pathToExtension = path.resolve(__dirname, '../.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      permissions: ['clipboard-read', 'clipboard-write'], 
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`
      ]
    });
    await use(context);
    await context.close();
  }
});

// ==========================================
// 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================
async function setFakeApiKey(context: BrowserContext) {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  await background.evaluate(() => {
    chrome.storage.local.set({ mistralApiKey: 'mock-test-key-123', selectedTone: 'business', sendPageContext: false });
  });
}

async function clearApiKey(context: BrowserContext) {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  await background.evaluate(() => {
    chrome.storage.local.remove('mistralApiKey');
  });
}

async function selectTextOnPage(page: Page, selector: string = 'p') {
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }, selector);
}

test('Сборки Chrome и Firefox используют совместимые background-механизмы', async () => {
  const chromeManifest = JSON.parse(await fs.readFile(
    path.resolve(__dirname, '../.output/chrome-mv3/manifest.json'),
    'utf8'
  ));
  const firefoxManifest = JSON.parse(await fs.readFile(
    path.resolve(__dirname, '../.output/firefox-mv3/manifest.json'),
    'utf8'
  ));

  expect(chromeManifest.background.service_worker).toBe('background.js');
  expect(firefoxManifest.background.scripts).toEqual(['background.js']);
  expect(firefoxManifest.browser_specific_settings.gecko.id).toBe('lexisync@kiryuhak.dev');
  expect(chromeManifest.permissions).toContain('clipboardWrite');
  expect(chromeManifest.permissions).not.toContain('scripting');
});

test('Проверка ошибок подсвечивает только исправленные слова', async ({ page, context }) => {
  await setFakeApiKey(context);
  await page.goto('https://example.com');

  await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
    const mockStreamData = `data: {"choices":[{"delta":{"content":"Пишу кот для проверки."}}]}\n\ndata: [DONE]\n\n`;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: mockStreamData });
  });

  await page.evaluate(() => {
    const textarea = document.createElement('textarea');
    textarea.id = 'spellcheck-input';
    textarea.value = 'Пишуу кот для провирки.';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);
  });

  await page.keyboard.press('Alt+r');

  const uiPanel = page.locator('#lexisync-extension-ui');
  await expect(uiPanel).toContainText('Пишу кот для проверки.', { timeout: 5000 });
  await expect(uiPanel.locator('mark')).toHaveText(['Пишу', 'проверки']);
  await expect(page.locator('#lexisync-shadow-host')).toHaveCount(1);

  // Отклоняем первое исправление и применяем остальные.
  await uiPanel.locator('mark').first().click();
  await uiPanel.getByRole('button', { name: 'Заменить текст' }).click();
  await expect(page.locator('#spellcheck-input')).toHaveValue('Пишуу кот для проверки.');

  // Возвращаем исходное значение одной кнопкой.
  await uiPanel.getByRole('button', { name: 'Отменить замену' }).click();
  await expect(page.locator('#spellcheck-input')).toHaveValue('Пишуу кот для провирки.');
});

test('Контекст страницы не отправляется без явного разрешения', async ({ page, context }) => {
  await setFakeApiKey(context);
  await page.goto('https://example.com');
  let requestBody: { messages: Array<{ content: string }> } | null = null;

  await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
    requestBody = route.request().postDataJSON();
    const mockStreamData = `data: {"choices":[{"delta":{"content":"Example Domain"}}]}\n\ndata: [DONE]\n\n`;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: mockStreamData });
  });

  await selectTextOnPage(page, 'h1');
  await page.keyboard.press('Alt+r');
  await expect(page.locator('#lexisync-extension-ui')).toContainText('Example Domain', { timeout: 5000 });

  expect(requestBody).not.toBeNull();
  const capturedRequest = requestBody as unknown as { messages: Array<{ content: string }> };
  expect(capturedRequest.messages[1].content).toBe('Текст для обработки: Example Domain');
  expect(JSON.stringify(capturedRequest.messages)).not.toContain('example.com');
});

test('Личный словарь передаётся в инструкцию проверки', async ({ page, context }) => {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  await background.evaluate(() => chrome.storage.local.set({
    mistralApiKey: 'mock-test-key-123',
    personalDictionary: ['LexiSync'],
  }));
  await page.goto('https://example.com');
  let systemPrompt = '';
  await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ content: string }> };
    systemPrompt = body.messages[0].content;
    const data = `data: {"choices":[{"delta":{"content":"LexiSync"}}]}\n\ndata: [DONE]\n\n`;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: data });
  });
  await page.evaluate(() => {
    const input = document.createElement('textarea');
    input.value = 'LexiSync';
    document.body.appendChild(input);
    input.focus();
    input.select();
  });
  await page.keyboard.press('Alt+r');
  await expect(page.locator('#lexisync-extension-ui')).toContainText('LexiSync');
  expect(systemPrompt).toContain('LexiSync');
});

test('На исключённом сайте история и кэш не сохраняются', async ({ page, context }) => {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  await background.evaluate(() => chrome.storage.local.set({
    mistralApiKey: 'mock-test-key-123',
    disabledSites: ['example.com'],
    historyEnabled: true,
    aiHistory: [],
  }));
  await page.goto('https://example.com');
  await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
    const data = `data: {"choices":[{"delta":{"content":"Example Domain"}}]}\n\ndata: [DONE]\n\n`;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: data });
  });
  await selectTextOnPage(page, 'h1');
  await page.keyboard.press('Alt+r');
  await expect(page.locator('#lexisync-extension-ui')).toContainText('Example Domain');
  await page.waitForTimeout(100);
  const stored = await background.evaluate(() => chrome.storage.local.get({ aiHistory: [], ai_cache_index: [] }));
  expect(stored.aiHistory).toEqual([]);
  expect(stored.ai_cache_index).toEqual([]);
});

test('История безопасно показывает текст и поддерживает поиск и удаление', async ({ page, context }) => {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  await background.evaluate(() => chrome.storage.local.set({
    aiHistory: [{
      id: 42,
      mode: 'spellcheck',
      original: '<img src=x onerror=alert(1)> опасный текст',
      result: 'Безопасный результат',
      date: new Date().toISOString(),
    }],
  }));
  const extensionId = new URL(background.url()).host;
  await page.goto(`chrome-extension://${extensionId}/lexisync-history.html`);

  await expect(page.locator('.history-card')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.history-card img')).toHaveCount(0);
  await page.locator('#historySearch').fill('нет совпадения');
  await expect(page.locator('.history-card')).toHaveCount(0);
  await page.locator('#historySearch').fill('безопасный');
  await expect(page.locator('.history-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.locator('.history-card')).toHaveCount(0);
});

test('Кейс 3: Mistral OCR (Alt+S) и буфер обмена', async ({ page, context }) => {
    await setFakeApiKey(context);
    await page.waitForTimeout(300);
    await page.goto('https://example.com');

    // 1. Мокаем ответ специализированного Mistral OCR API.
    await context.route('https://api.mistral.ai/v1/ocr', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pages: [{ index: 0, markdown: 'Распознанный с картинки текст.' }] })
      });
    });

    // 2. Передаем content-скрипту результат захвата экрана.
    // Нативный chrome.tabs.captureVisibleTab нельзя надежно переприсвоить в тесте.
    let [background] = context.serviceWorkers();
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const fakeImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        await chrome.tabs.sendMessage(tabs[0].id, {
          action: 'startOcrMode',
          screenshotUrl: fakeImage
        });
      }
    });

    // 3. Выделяем область на OCR-оверлее.
    await expect(page.locator('#lexisync-ocr-overlay')).toBeVisible();
    await page.mouse.move(20, 20);
    await page.mouse.down();
    await page.mouse.move(120, 80);
    await page.mouse.up();

    // 4. Проверяем, что UI панель показала распознанный текст
    const uiPanel = page.locator('#lexisync-extension-ui');
    await expect(uiPanel).toBeVisible({ timeout: 5000 });
    await expect(uiPanel).toContainText('Распознанный с картинки текст.');
  });
  test('Кейс 4: Переписывание стиля (Alt+Y)', async ({ page, context }) => {
    await setFakeApiKey(context);
    await page.waitForTimeout(300);
    await page.goto('https://example.com');

    await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
      const mockStreamData = `data: {"choices":[{"delta":{"content":"Официальный деловой текст."}}]}\n\ndata: [DONE]\n\n`;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: mockStreamData });
    });

    await selectTextOnPage(page, 'h1');
    await page.keyboard.press('Alt+y');

    const uiPanel = page.locator('#lexisync-extension-ui');
    await expect(uiPanel).toContainText('Официальный деловой текст.', { timeout: 5000 });
  });

  test('Кейс 5: Добавление эмодзи (Alt+T)', async ({ page, context }) => {
    await setFakeApiKey(context);
    await page.waitForTimeout(300);
    await page.goto('https://example.com');

    await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
      const mockStreamData = `data: {"choices":[{"delta":{"content":"Классный текст 🚀✨"}}]}\n\ndata: [DONE]\n\n`;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: mockStreamData });
    });

    await selectTextOnPage(page);
    await page.keyboard.press('Alt+t');

    const uiPanel = page.locator('#lexisync-extension-ui');
    await expect(uiPanel).toContainText('Классный текст 🚀✨', { timeout: 5000 });
  });

  test('Кейс 6: Эмуляция контекстного меню (Перевод)', async ({ page, context }) => {
    await setFakeApiKey(context);
    await page.waitForTimeout(300);
    await page.goto('https://example.com');

    await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
      const mockStreamData = `data: {"choices":[{"delta":{"content":"Привет, мир!"}}]}\n\ndata: [DONE]\n\n`;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: mockStreamData });
    });

    let [background] = context.serviceWorkers();
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "contextMenuClicked", mode: "translate", text: "Hello world" });
      }
    });

    const uiPanel = page.locator('#lexisync-extension-ui');
    await expect(uiPanel).toContainText('Привет, мир!', { timeout: 5000 });
  });

  test('Кейс 7: Негативный сценарий (Обработка HTTP 500 от API)', async ({ page, context }) => {
    await setFakeApiKey(context);
    await page.waitForTimeout(300);
    await page.goto('https://example.com');

    await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
      await route.fulfill({ 
        status: 500, 
        contentType: 'application/json', 
        body: JSON.stringify({ message: "Internal Server Error" }) 
      });
    });

    await selectTextOnPage(page);
    await page.keyboard.press('Alt+r');

    const uiPanel = page.locator('#lexisync-extension-ui');
    await expect(uiPanel).toBeVisible({ timeout: 5000 });
    await expect(uiPanel).toContainText('Ошибка');
  });

test('Персональная подсказка дополняет изученное слово по Tab', async ({ page, context }) => {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  await background.evaluate(() => chrome.storage.local.set({
    adaptiveSuggestionsEnabled: true,
    adaptiveLearningEnabled: true,
    adaptiveLanguageModel: {
      version: 1,
      words: {
        'привет': { count: 4, lastUsed: Date.now(), value: 'привет' },
      },
      pairs: {},
    },
  }));

  await page.goto('https://example.com');
  await page.evaluate(() => {
    const textarea = document.createElement('textarea');
    textarea.id = 'adaptive-input';
    document.body.appendChild(textarea);
    textarea.focus();
  });
  await page.locator('#adaptive-input').fill('при');

  const suggestion = page.locator('#lexisync-adaptive-suggestions-host button').first();
  await expect(suggestion).toHaveText('привет');
  await page.keyboard.press('Tab');
  await expect(page.locator('#adaptive-input')).toHaveValue('привет');
});
