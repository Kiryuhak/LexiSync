import { test as base, expect, chromium } from '@playwright/test';
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
async function setFakeApiKey(context: any) {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  await background.evaluate(() => {
    chrome.storage.local.set({ mistralApiKey: 'mock-test-key-123', selectedTone: 'business' });
  });
}

async function clearApiKey(context: any) {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  await background.evaluate(() => {
    chrome.storage.local.remove('mistralApiKey');
  });
}

async function selectTextOnPage(page: any, selector: string = 'p') {
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

test('Кейс 3: Мультимодальный OCR (Alt+S) и буфер обмена', async ({ page, context }) => {
    await setFakeApiKey(context);
    await page.waitForTimeout(300);
    await page.goto('https://example.com');

    // 1. Мокаем ответ от Mistral (визуальная модель Pixtral)
    await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
      const mockStreamData = `data: {"choices":[{"delta":{"content":"Распознанный с картинки текст."}}]}\n\ndata: [DONE]\n\n`;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: mockStreamData });
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
    const uiPanel = page.locator('#gemini-extension-ui');
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

    const uiPanel = page.locator('#gemini-extension-ui');
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

    const uiPanel = page.locator('#gemini-extension-ui');
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

    const uiPanel = page.locator('#gemini-extension-ui');
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

    const uiPanel = page.locator('#gemini-extension-ui');
    await expect(uiPanel).toBeVisible({ timeout: 5000 });
    await expect(uiPanel).toContainText('Ошибка');
  });
