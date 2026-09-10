import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(rootDir, '.output', 'chrome-mv3');
const rawDir = path.join(rootDir, '.output', 'showcase');
const outputDir = path.join(rootDir, 'docs', 'store-assets', 'firefox');
const chromeOutputDir = path.join(rootDir, 'docs', 'store-assets', 'chrome', 'ru');
const carouselPath = path.join(rootDir, 'docs', 'assets', 'lexisync-showcase-color.gif');
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lexisync-showcase-'));

const demoHtml = `<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <title>Редактор публикации</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; color: #17213a; background: radial-gradient(circle at 8% 4%, #c9d5ff 0, transparent 34%), radial-gradient(circle at 92% 92%, #b9f3ec 0, transparent 38%), #f4f6fc; font: 16px/1.5 Inter, system-ui, sans-serif; }
        header { display: flex; align-items: center; justify-content: space-between; height: 58px; padding: 0 40px; background: rgba(255,255,255,.78); border-bottom: 1px solid rgba(70,85,130,.12); backdrop-filter: blur(20px); }
        .brand { display: flex; align-items: center; gap: 12px; font-size: 20px; font-weight: 750; }
        .brand span { display: grid; width: 36px; height: 36px; place-items: center; color: white; background: linear-gradient(135deg,#7059f0,#29b8c8); border-radius: 12px; }
        .saved { padding: 7px 12px; color: #087466; background: #e6faf4; border-radius: 999px; font-size: 13px; font-weight: 650; }
        main { display: grid; grid-template-columns: minmax(0,1fr) 250px; gap: 22px; width: min(1040px, calc(100% - 64px)); margin: 16px auto; }
        .editor, aside { background: rgba(255,255,255,.86); border: 1px solid rgba(255,255,255,.92); border-radius: 24px; box-shadow: 0 22px 60px rgba(44,55,94,.13); backdrop-filter: blur(24px); }
        .editor { min-height: 520px; padding: 24px 36px; }
        .eyebrow { color: #6654d9; font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
        h1 { margin: 5px 0 14px; font-size: 32px; line-height: 1.12; }
        #draft { min-height: 150px; padding: 19px 22px; color: #26324d; background: #f8faff; border: 2px solid #dfe5f7; border-radius: 18px; outline: none; font-size: 20px; line-height: 1.55; }
        #draft:focus { border-color: #7b68ec; box-shadow: 0 0 0 5px rgba(123,104,236,.11); }
        .chips { display: flex; gap: 9px; margin-top: 12px; }
        .chip { padding: 7px 11px; color: #56617a; background: #f1f4fb; border-radius: 999px; font-size: 12px; }
        aside { align-self: start; padding: 24px; }
        aside strong { display: block; margin-bottom: 15px; font-size: 17px; }
        aside div { display: flex; gap: 9px; margin: 12px 0; color: #64708a; font-size: 13px; }
        aside i { width: 9px; height: 9px; margin-top: 5px; background: linear-gradient(135deg,#7059f0,#29b8c8); border-radius: 50%; }
    </style>
</head>
<body>
    <header><div class="brand"><span>✦</span>Редактор публикации</div><div class="saved">✓ Черновик сохранён</div></header>
    <main>
        <section class="editor">
            <div class="eyebrow">Новая публикация</div>
            <h1>Расскажите о продукте понятно</h1>
            <div id="draft" contenteditable="true">Проверяю текс на ашибки и хочу получить понятный результат для публикации.</div>
            <div class="chips"><span class="chip">Деловой стиль</span><span class="chip">Русский язык</span><span class="chip">Автосохранение</span></div>
        </section>
        <aside><strong>План публикации</strong><div><i></i><span>Проверить текст</span></div><div><i></i><span>Улучшить стиль</span></div><div><i></i><span>Добавить эмодзи</span></div></aside>
    </main>
</body>
</html>`;

const scenes = [
    {
        raw: 'ai-actions.png',
        output: 'lexisync-ai-actions.png',
        eyebrow: 'УМНЫЕ ДЕЙСТВИЯ',
        title: 'Работайте с текстом прямо на странице',
        description: 'Исправление, перевод и улучшение стиля в одном аккуратном меню.',
        accent: '#684ff0',
        glow: '#69d7df',
    },
    {
        raw: 'result.png',
        output: 'lexisync-result-window.png',
        eyebrow: 'ТОЧНОЕ ИСПРАВЛЕНИЕ',
        title: 'Исправляйте ошибки за один клик',
        description: 'Проверяйте изменения и сразу заменяйте исходный текст готовой версией.',
        accent: '#4c5ff1',
        glow: '#9b7cf7',
    },
    {
        raw: 'providers.png',
        output: 'lexisync-ai-providers.png',
        eyebrow: 'ГИБКАЯ НАСТРОЙКА AI',
        title: 'Mistral и Cloudflare в одном месте',
        description: 'Выберите основной сервис, модель и безопасное резервное переключение.',
        accent: '#f38020',
        glow: '#f6c945',
    },
    {
        raw: 'usage.png',
        output: 'lexisync-ai-usage.png',
        eyebrow: 'РАСХОД И ЛИМИТЫ',
        title: 'Контролируйте модели и лимиты',
        description: 'Следите за использованием AI и управляйте расходом прямо в настройках.',
        accent: '#2479e8',
        glow: '#5bd4c7',
    },
    {
        raw: 'privacy.png',
        output: 'lexisync-privacy-settings.png',
        eyebrow: 'БЕЗОПАСНАЯ СИНХРОНИЗАЦИЯ',
        title: 'Google Drive без ручных токенов',
        description: 'Войдите через Google и сохраните зашифрованную копию одним нажатием.',
        accent: '#087b68',
        glow: '#60c9ec',
    },
    {
        raw: 'updates.png',
        output: 'lexisync-update-history.png',
        eyebrow: 'ИСТОРИЯ ОБНОВЛЕНИЙ',
        title: 'Все изменения всегда под рукой',
        description: 'Находите нужную версию и узнавайте о новых возможностях LexiSync.',
        accent: '#5c4bcc',
        glow: '#72c9e8',
    },
    {
        raw: 'onboarding.png',
        output: 'lexisync-quick-start.png',
        eyebrow: 'БЫСТРЫЙ СТАРТ',
        title: 'Восстановление без сложной настройки',
        description: 'Войдите в Google Drive или выберите локальную резервную копию.',
        accent: '#6a50d7',
        glow: '#43c7bd',
    },
];

function marketingHtml(scene, imageUrl) {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{width:1280px;height:800px;margin:0;overflow:hidden}body{position:relative;color:#111936;background:radial-gradient(circle at 8% 0%,color-mix(in srgb,${scene.accent} 18%,white),transparent 34%),radial-gradient(circle at 94% 18%,color-mix(in srgb,${scene.glow} 18%,white),transparent 30%),linear-gradient(145deg,#fbfcff,#edf2ff);font-family:Inter,system-ui,-apple-system,sans-serif}
        body:before{position:absolute;inset:0;content:"";background-image:linear-gradient(rgba(72,84,132,.032) 1px,transparent 1px),linear-gradient(90deg,rgba(72,84,132,.032) 1px,transparent 1px);background-size:36px 36px;mask-image:linear-gradient(#000,transparent 48%)}
        .top{position:relative;z-index:2;height:116px;display:flex;align-items:center;padding:18px 40px 17px;gap:26px}.brand{display:flex;align-items:center;gap:11px;min-width:184px;font-size:24px;font-weight:850;letter-spacing:-.035em}.logo{display:grid;width:44px;height:44px;place-items:center;color:white;background:linear-gradient(135deg,${scene.accent},${scene.glow});border:1px solid rgba(255,255,255,.8);border-radius:14px;box-shadow:0 12px 28px color-mix(in srgb,${scene.accent} 25%,transparent);font-size:22px}.copy{min-width:0;flex:1}.eyebrow{margin-bottom:4px;color:${scene.accent};font-size:11px;font-weight:850;letter-spacing:.12em}.title{margin:0;font-size:29px;line-height:1.05;letter-spacing:-.035em}.description{margin:6px 0 0;color:#5d6882;font-size:14px;line-height:1.3}
        .visual{position:absolute;z-index:1;left:28px;top:116px;width:1224px;height:674px;padding:12px;background:rgba(255,255,255,.72);border:1px solid rgba(255,255,255,.95);border-radius:25px;box-shadow:0 24px 58px rgba(35,45,84,.2),inset 0 1px 0 white;backdrop-filter:blur(20px)}.visual:before{position:absolute;top:8px;right:32px;left:32px;height:3px;content:"";background:linear-gradient(90deg,transparent,${scene.accent},${scene.glow},transparent);border-radius:999px;opacity:.66}.visual img{display:block;width:1200px;height:650px;object-fit:contain;border-radius:15px;border:1px solid rgba(57,73,125,.12);background:#f2f5fd}
    </style></head><body><header class="top"><div class="brand"><span class="logo">✦</span>LexiSync</div><section class="copy"><div class="eyebrow">${scene.eyebrow}</div><h1 class="title">${scene.title}</h1><p class="description">${scene.description}</p></section></header><div class="visual"><img src="${imageUrl}" alt=""></div></body></html>`;
}

async function waitForBackground(context) {
    const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await background.evaluate(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const { settingsSchemaVersion } = await chrome.storage.local.get('settingsSchemaVersion');
            if (settingsSchemaVersion === 15) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Настройки расширения не инициализированы.');
    });
    return background;
}

async function selectDemoText(page) {
    await page.locator('#draft').evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
    });
}

async function injectExtension(extensionPage, page) {
    await page.bringToFront();
    const tabId = await extensionPage.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        return tabs.find((tab) => tab.url === url)?.id;
    }, page.url());
    if (!tabId) throw new Error(`Не найдена вкладка для ${page.url()}`);
    await extensionPage.evaluate(
        (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['inject.js'] }),
        tabId,
    );
    await extensionPage.evaluate(async (id) => {
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                if ((await chrome.tabs.sendMessage(id, { action: 'lexisyncPing' }))?.ok === true) return;
            } catch {
                // Content script can need a short moment after executeScript resolves.
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Content script LexiSync не отвечает.');
    }, tabId);
    await extensionPage.evaluate(
        (id) => chrome.tabs.sendMessage(id, { action: 'setSiteEnabled', enabled: true }),
        tabId,
    );
}

async function captureRaw(page, name) {
    await page.setViewportSize({ width: 1200, height: 650 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(rawDir, name), animations: 'disabled' });
}

async function compose(context, scene, destinationDir) {
    const image = await fs.readFile(path.join(rawDir, scene.raw));
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(marketingHtml(scene, `data:image/png;base64,${image.toString('base64')}`));
    await page.locator('.visual img').evaluate((element) => element.decode());
    await page.screenshot({ path: path.join(destinationDir, scene.output), animations: 'disabled' });
    await page.close();
}

async function createCarousel() {
    const names = scenes.map((scene) => scene.output);
    const frames = await Promise.all(
        names.map((name) => sharp(path.join(outputDir, name)).resize(960, 600, { fit: 'cover' }).png().toBuffer()),
    );
    await sharp(frames, { join: { animated: true } })
        .gif({
            loop: 0,
            delay: Array.from({ length: names.length }, () => 2800),
            effort: 10,
            colours: 256,
            dither: 0.65,
            interFrameMaxError: 3,
        })
        .toFile(carouselPath);
}

function promoHtml(iconUrl) {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{position:relative;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 12% 0%,#8d7bff 0,transparent 34%),radial-gradient(circle at 92% 100%,#41cbd1 0,transparent 38%),linear-gradient(145deg,#30227e,#111834);color:white;font-family:Inter,system-ui,sans-serif}
        .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.065) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.065) 1px,transparent 1px);background-size:34px 34px;mask-image:radial-gradient(circle,#000,transparent 78%)}.card{position:absolute;inset:9%;border:1px solid rgba(255,255,255,.22);border-radius:36px;background:rgba(255,255,255,.08);box-shadow:0 28px 90px rgba(4,8,35,.34);backdrop-filter:blur(18px)}
        .content{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:6vw;width:82%;height:76%}.logo{flex:none;width:min(25vw,190px);height:min(25vw,190px);padding:2.8%;border:1px solid rgba(255,255,255,.7);border-radius:28%;background:rgba(255,255,255,.96);box-shadow:0 24px 68px rgba(7,10,40,.42)}.logo img{display:block;width:100%;height:100%;object-fit:contain}.copy{min-width:0}.brand{font-size:clamp(22px,3vw,42px);font-weight:850;letter-spacing:-.04em}.title{margin-top:.2em;font-size:clamp(30px,5.3vw,76px);font-weight:850;line-height:.96;letter-spacing:-.055em}.subtitle{margin-top:.8em;color:#dce5ff;font-size:clamp(12px,1.55vw,22px);font-weight:600}
        @media(max-width:600px){.card{inset:7%;border-radius:25px}.content{width:88%;height:82%;gap:22px}.logo{width:112px;height:112px}.brand{font-size:23px}.title{font-size:38px}.subtitle{font-size:13px}}
    </style></head><body><div class="grid"></div><div class="card"></div><main class="content"><div class="logo"><img src="${iconUrl}" alt=""></div><section class="copy"><div class="brand">LexiSync</div><div class="title">Пишите уверенно</div><div class="subtitle">Исправление и улучшение текста прямо в браузере</div></section></main></body></html>`;
}

async function createChromeAssets(context) {
    const promoDir = path.join(chromeOutputDir, 'promo');
    await fs.mkdir(promoDir, { recursive: true });
    const icon = await fs.readFile(path.join(rootDir, 'public', 'icons', 'icon-128.png'));
    const iconUrl = `data:image/png;base64,${icon.toString('base64')}`;
    for (const [width, height, filename] of [
        [440, 280, 'lexisync-small-promo-440x280.png'],
        [1400, 560, 'lexisync-marquee-promo-1400x560.png'],
    ]) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height });
        await page.setContent(promoHtml(iconUrl));
        await page.locator('.logo img').evaluate((element) => element.decode());
        await page.screenshot({ path: path.join(promoDir, filename), animations: 'disabled' });
        await page.close();
    }
}

await fs.access(path.join(extensionDir, 'manifest.json'));
for (const target of [rawDir, outputDir, chromeOutputDir]) {
    const relativeTarget = path.relative(rootDir, target);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        throw new Error(`Отказ от очистки каталога вне проекта: ${target}`);
    }
    await fs.rm(target, { recursive: true, force: true });
}
await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(chromeOutputDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    locale: 'ru-RU',
    viewport: { width: 1000, height: 1000 },
    args: ['--lang=ru', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});

try {
    const background = await waitForBackground(context);
    await background.evaluate(() => {
        const networkFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
            if (url === 'https://api.mistral.ai/v1/models') {
                return new Response('{"data":[]}', {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.startsWith('https://api.cloudflare.com/client/v4/accounts/')) {
                return new Response('{"success":true,"result":{"response":"Pong"}}', {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return networkFetch(input, init);
        };
    });
    await background.evaluate(() => {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return chrome.storage.local.set({
            onboardingCompleted: true,
            selectedTheme: 'light',
            visualStyle: 'magicos-11',
            resultDisplayMode: 'detailed',
            compactResultMode: false,
            sendPageContext: false,
            historyEnabled: true,
            quickActionBubbleEnabled: false,
            cloudflareModel: '@cf/zai-org/glm-4.7-flash',
            disabledSites: ['social.example', 'private.example'],
            usageStats: {
                requests: 24,
                cacheHits: 7,
                failures: 1,
                totalLatencyMs: 86400,
                byMode: { spellcheck: 15, style: 6, translate: 3 },
                estimatedInputTokens: 10320,
                estimatedOutputTokens: 2840,
                mistralTokens: 8220,
                cloudflareTokens: 4940,
                cloudflareNeurons: 31.84,
                fallbackCount: 2,
                daily: {
                    [today]: {
                        requests: 9,
                        tokens: 4380,
                        mistralTokens: 2730,
                        cloudflareTokens: 1650,
                        cloudflareNeurons: 10.72,
                        fallbackCount: 1,
                        failures: 1,
                    },
                },
            },
        });
    });

    const initialPages = context.pages();
    for (const initialPage of initialPages) await initialPage.close();
    const extensionId = new URL(background.url()).host;
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    const controller = await context.newPage();
    await controller.goto(optionsUrl);

    const keyPage = await context.newPage();
    await keyPage.goto(optionsUrl);
    await keyPage.evaluate(() => chrome.runtime.sendMessage({ action: 'setApiKey', value: 'showcase-key' }));
    await keyPage.evaluate(() =>
        chrome.runtime.sendMessage({
            action: 'setCloudflareCredentials',
            accountId: '1234567890abcdef1234567890abcdef',
            apiToken: 'showcase-cloudflare-token',
        }),
    );
    await keyPage.close();

    const providers = await context.newPage();
    await providers.goto(optionsUrl);
    await providers.locator('[data-tab="main"]').click();
    await providers.locator('#cloudflareAccountId').scrollIntoViewIfNeeded();
    await captureRaw(providers, 'providers.png');
    await providers.close();

    const usage = await context.newPage();
    await usage.goto(optionsUrl);
    await usage.locator('[data-tab="ai"]').click();
    await usage.locator('#localUsageToday').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await captureRaw(usage, 'usage.png');
    await usage.close();

    const privacy = await context.newPage();
    await privacy.goto(optionsUrl);
    await privacy.locator('[data-tab="privacy"]').click();
    await privacy.locator('#saveToDriveBtn').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await captureRaw(privacy, 'privacy.png');
    await privacy.close();

    const updates = await context.newPage();
    await updates.goto(optionsUrl);
    await updates.locator('#app-version').click();
    await updates.locator('#releaseNotesDialog').waitFor({ state: 'visible' });
    await captureRaw(updates, 'updates.png');
    await updates.close();

    const onboarding = await context.newPage();
    await onboarding.goto(`${optionsUrl}?tutorial=1`);
    await onboarding.locator('[data-onboarding-step="0"].is-active').waitFor({ state: 'visible' });
    await onboarding.locator('#onboardingNext').click();
    await onboarding.locator('[data-onboarding-step="1"].is-active').waitFor({ state: 'visible' });
    await captureRaw(onboarding, 'onboarding.png');
    await onboarding.close();

    await context.route('https://lexisync.demo/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: demoHtml });
    });
    await context.route('https://api.mistral.ai/v1/chat/completions', async (route) => {
        const result = 'Проверяю текст на ошибки и хочу получить понятный результат для публикации.';
        const body = `data: ${JSON.stringify({ choices: [{ delta: { content: result } }] })}\n\ndata: [DONE]\n\n`;
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
    });

    const actions = await context.newPage();
    await actions.goto('https://lexisync.demo/actions');
    await injectExtension(controller, actions);
    await selectDemoText(actions);
    await actions.locator('[data-lexisync-action="edit"]').waitFor({ state: 'visible' });
    await actions.locator('[data-lexisync-action="edit"]').click();
    const actionsMenu = actions.locator('#lexisync-extension-ui[data-surface="menu"]');
    await actionsMenu.waitFor({ state: 'visible' });
    await actionsMenu.evaluate((element) => {
        element.style.zoom = '0.88';
    });
    await captureRaw(actions, 'ai-actions.png');
    await actions.close();

    const result = await context.newPage();
    await result.goto('https://lexisync.demo/result');
    await injectExtension(controller, result);
    await selectDemoText(result);
    await result.keyboard.press('Alt+r');
    await result
        .locator('#lexisync-extension-ui[data-surface="result"] .lexisync-content-pane')
        .filter({ hasText: 'Проверяю текст на ошибки' })
        .waitFor({ state: 'visible' });
    await result.locator('#lexisync-extension-ui[data-surface="result"]').evaluate((element) => {
        element.style.zoom = '0.92';
    });
    await captureRaw(result, 'result.png');
    await result.close();

    for (const scene of scenes) await compose(context, scene, outputDir);
    for (const scene of scenes.slice(0, 5)) {
        const chromeScene = {
            ...scene,
            output: `${String(scenes.indexOf(scene) + 1).padStart(2, '0')}-${scene.output}`,
        };
        await compose(context, chromeScene, chromeOutputDir);
    }
    await createCarousel();
    await createChromeAssets(context);
    process.stdout.write(
        `Создано 5 скриншотов Chrome, ${scenes.length} скриншотов Firefox и анимированная галерея ${path.relative(rootDir, carouselPath)}\n`,
    );
} finally {
    await context.close();
    if (path.dirname(profileDir) === os.tmpdir() && path.basename(profileDir).startsWith('lexisync-showcase-')) {
        await fs.rm(profileDir, { recursive: true, force: true });
    }
}
