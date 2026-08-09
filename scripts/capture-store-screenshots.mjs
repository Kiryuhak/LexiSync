import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(rootDir, '.output', 'chrome-mv3');
const rawDir = path.join(rootDir, '.output', 'showcase');
const outputDir = path.join(rootDir, 'docs', 'store-assets', 'firefox');
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lexisync-showcase-'));

const demoHtml = `<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <title>Редактор публикации</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; color: #17213a; background: radial-gradient(circle at 8% 4%, #c9d5ff 0, transparent 34%), radial-gradient(circle at 92% 92%, #b9f3ec 0, transparent 38%), #f4f6fc; font: 16px/1.5 Inter, system-ui, sans-serif; }
        header { display: flex; align-items: center; justify-content: space-between; height: 72px; padding: 0 46px; background: rgba(255,255,255,.78); border-bottom: 1px solid rgba(70,85,130,.12); backdrop-filter: blur(20px); }
        .brand { display: flex; align-items: center; gap: 12px; font-size: 20px; font-weight: 750; }
        .brand span { display: grid; width: 36px; height: 36px; place-items: center; color: white; background: linear-gradient(135deg,#7059f0,#29b8c8); border-radius: 12px; }
        .saved { padding: 7px 12px; color: #087466; background: #e6faf4; border-radius: 999px; font-size: 13px; font-weight: 650; }
        main { display: grid; grid-template-columns: minmax(0,1fr) 250px; gap: 24px; width: min(1040px, calc(100% - 64px)); margin: 38px auto; }
        .editor, aside { background: rgba(255,255,255,.86); border: 1px solid rgba(255,255,255,.92); border-radius: 24px; box-shadow: 0 22px 60px rgba(44,55,94,.13); backdrop-filter: blur(24px); }
        .editor { min-height: 560px; padding: 38px 42px; }
        .eyebrow { color: #6654d9; font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
        h1 { margin: 8px 0 22px; font-size: 36px; line-height: 1.15; }
        #draft { min-height: 190px; padding: 24px; color: #26324d; background: #f8faff; border: 2px solid #dfe5f7; border-radius: 18px; outline: none; font-size: 21px; line-height: 1.65; }
        #draft:focus { border-color: #7b68ec; box-shadow: 0 0 0 5px rgba(123,104,236,.11); }
        .chips { display: flex; gap: 9px; margin-top: 18px; }
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
        title: 'Выберите, что сделать с текстом',
        description: 'Исправляйте ошибки, переписывайте, переводите и добавляйте эмодзи прямо на странице.',
        badges: ['Исправить ошибки', 'Другими словами', 'Улучшить стиль'],
        accent: '#684ff0',
        glow: '#69d7df',
    },
    {
        raw: 'result.png',
        output: 'lexisync-result-window.png',
        eyebrow: 'ГОТОВЫЙ РЕЗУЛЬТАТ',
        title: 'Получайте исправление рядом с текстом',
        description: 'Проверьте результат, замените исходный текст или скопируйте готовую версию.',
        badges: ['Компактное окно', 'Подсветка изменений', 'Быстрая замена'],
        accent: '#4c5ff1',
        glow: '#9b7cf7',
    },
    {
        raw: 'appearance.png',
        output: 'lexisync-appearance-settings.png',
        eyebrow: 'ПЕРСОНАЛЬНОЕ ОФОРМЛЕНИЕ',
        title: 'Настройте LexiSync под себя',
        description: 'Выберите тему, стиль окон, размер, плотность и прозрачность интерфейса.',
        badges: ['MagicOS', 'Aurora Glass', 'Светлая и тёмная тема'],
        accent: '#7656e8',
        glow: '#36c8d3',
    },
    {
        raw: 'privacy.png',
        output: 'lexisync-privacy-settings.png',
        eyebrow: 'ПРИВАТНОСТЬ',
        title: 'Ваши данные остаются под контролем',
        description: 'Решайте, что сохранять, где отключать расширение и когда передавать контекст страницы.',
        badges: ['Локальное хранение', 'Исключения сайтов', 'Без телеметрии'],
        accent: '#087b68',
        glow: '#60c9ec',
    },
    {
        raw: 'updates.png',
        output: 'lexisync-update-history.png',
        eyebrow: 'ИСТОРИЯ ОБНОВЛЕНИЙ',
        title: 'Все изменения всегда под рукой',
        description: 'Нажмите на номер версии, найдите нужное улучшение и посмотрите, что изменилось.',
        badges: ['Поиск по версиям', 'Понятные описания', 'Текущий выпуск'],
        accent: '#5c4bcc',
        glow: '#72c9e8',
    },
    {
        raw: 'onboarding.png',
        output: 'lexisync-quick-start.png',
        eyebrow: 'БЫСТРЫЙ СТАРТ',
        title: 'Начните работу за несколько шагов',
        description: 'Пошаговая настройка объясняет, где взять API-ключ и как запустить первую команду.',
        badges: ['5 простых шагов', 'Проверка ключа', 'Подсказки на русском'],
        accent: '#6a50d7',
        glow: '#43c7bd',
    },
];

function marketingHtml(scene, imageUrl) {
    const badges = scene.badges.map((badge) => `<span>${badge}</span>`).join('');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{width:1536px;height:1024px;margin:0;overflow:hidden}body{position:relative;color:#121a34;background:radial-gradient(circle at 10% 8%,color-mix(in srgb,${scene.accent} 24%,white),transparent 34%),radial-gradient(circle at 92% 88%,color-mix(in srgb,${scene.glow} 32%,white),transparent 38%),linear-gradient(145deg,#fbfcff,#eef3ff);font-family:Inter,system-ui,-apple-system,sans-serif}
        body:before{position:absolute;inset:0;content:"";background-image:linear-gradient(rgba(79,91,145,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(79,91,145,.035) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(90deg,#000,transparent 60%)}
        .copy{position:absolute;z-index:2;top:76px;left:62px;width:490px}.brand{display:flex;align-items:center;gap:14px;margin-bottom:118px;font-size:34px;font-weight:820;letter-spacing:-.03em}.logo{display:grid;width:58px;height:58px;place-items:center;color:white;background:linear-gradient(135deg,${scene.accent},${scene.glow});border:1px solid rgba(255,255,255,.74);border-radius:19px;box-shadow:0 15px 34px color-mix(in srgb,${scene.accent} 28%,transparent);font-size:29px}.eyebrow{margin-bottom:16px;color:${scene.accent};font-size:15px;font-weight:850;letter-spacing:.12em}.title{margin:0;font-size:58px;line-height:1.06;letter-spacing:-.045em}.description{margin:25px 0 28px;color:#59647d;font-size:23px;line-height:1.48}.badges{display:flex;flex-wrap:wrap;gap:9px}.badges span{padding:9px 13px;color:#3d4863;background:rgba(255,255,255,.72);border:1px solid rgba(255,255,255,.9);border-radius:999px;box-shadow:0 8px 24px rgba(48,57,95,.08);font-size:13px;font-weight:700;backdrop-filter:blur(14px)}
        .visual{position:absolute;z-index:1;top:62px;right:42px;width:900px;height:900px;padding:13px;background:rgba(255,255,255,.48);border:1px solid rgba(255,255,255,.88);border-radius:36px;box-shadow:0 34px 90px rgba(35,45,84,.24),inset 0 1px 0 white;transform:perspective(1400px) rotateY(-2deg);backdrop-filter:blur(24px)}.visual:before{position:absolute;top:15px;right:24px;left:24px;height:3px;content:"";background:linear-gradient(90deg,transparent,${scene.accent},${scene.glow},transparent);border-radius:999px;opacity:.76}.visual img{width:100%;height:100%;object-fit:cover;object-position:center top;border-radius:25px;border:1px solid rgba(57,73,125,.12)}
        .step{position:absolute;right:72px;bottom:41px;z-index:3;padding:8px 12px;color:white;background:${scene.accent};border-radius:999px;box-shadow:0 10px 28px color-mix(in srgb,${scene.accent} 36%,transparent);font-size:12px;font-weight:800;letter-spacing:.06em}
    </style></head><body><section class="copy"><div class="brand"><span class="logo">✦</span>LexiSync</div><div class="eyebrow">${scene.eyebrow}</div><h1 class="title">${scene.title}</h1><p class="description">${scene.description}</p><div class="badges">${badges}</div></section><div class="visual"><img src="${imageUrl}" alt=""></div><div class="step">ИНТЕРФЕЙС НА РУССКОМ</div></body></html>`;
}

async function waitForBackground(context) {
    const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await background.evaluate(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const { settingsSchemaVersion } = await chrome.storage.local.get('settingsSchemaVersion');
            if (settingsSchemaVersion === 10) return;
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
}

async function captureRaw(page, name) {
    await page.screenshot({ path: path.join(rawDir, name), animations: 'disabled' });
}

async function compose(context, scene) {
    const image = await fs.readFile(path.join(rawDir, scene.raw));
    const page = await context.newPage();
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.setContent(marketingHtml(scene, `data:image/png;base64,${image.toString('base64')}`));
    await page.locator('.visual img').evaluate((element) => element.decode());
    await page.screenshot({ path: path.join(outputDir, scene.output), animations: 'disabled' });
    await page.close();
}

await fs.access(path.join(extensionDir, 'manifest.json'));
await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    locale: 'ru-RU',
    viewport: { width: 1000, height: 1000 },
    args: ['--lang=ru', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});

try {
    const background = await waitForBackground(context);
    await background.evaluate(() =>
        chrome.storage.local.set({
            onboardingCompleted: true,
            selectedTheme: 'light',
            visualStyle: 'magicos-11',
            resultDisplayMode: 'detailed',
            compactResultMode: false,
            sendPageContext: false,
            historyEnabled: true,
            disabledSites: ['social.example', 'private.example'],
        }),
    );

    const initialPages = context.pages();
    for (const initialPage of initialPages) await initialPage.close();
    const extensionId = new URL(background.url()).host;
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    const controller = await context.newPage();
    await controller.goto(optionsUrl);

    const keyPage = await context.newPage();
    await keyPage.goto(optionsUrl);
    await keyPage.evaluate(() => chrome.runtime.sendMessage({ action: 'setApiKey', value: 'showcase-key' }));
    await keyPage.close();

    const appearance = await context.newPage();
    await appearance.goto(optionsUrl);
    await appearance.locator('[data-tab="appearance"]').click();
    await appearance.locator('#visualStyleSelect').selectOption('magicos-11');
    await appearance.locator('#visualStyleSelect').scrollIntoViewIfNeeded();
    await captureRaw(appearance, 'appearance.png');
    await appearance.close();

    const privacy = await context.newPage();
    await privacy.goto(optionsUrl);
    await privacy.locator('[data-tab="privacy"]').click();
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
    await onboarding.locator('#onboardingNext').click();
    await onboarding.locator('#onboardingApiKey').waitFor({ state: 'visible' });
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
    await actions.locator('#lexisync-extension-ui[data-surface="menu"]').waitFor({ state: 'visible' });
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
    await captureRaw(result, 'result.png');
    await result.close();

    for (const scene of scenes) await compose(context, scene);
    process.stdout.write(`Создано ${scenes.length} скриншотов в ${path.relative(rootDir, outputDir)}\n`);
} finally {
    await context.close();
    if (path.dirname(profileDir) === os.tmpdir() && path.basename(profileDir).startsWith('lexisync-showcase-')) {
        await fs.rm(profileDir, { recursive: true, force: true });
    }
}
