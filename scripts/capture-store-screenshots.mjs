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
        raw: 'providers.png',
        output: 'lexisync-ai-providers.png',
        eyebrow: 'ДВА AI-ПРОВАЙДЕРА',
        title: 'Выберите AI для вашей задачи',
        description: 'Подключите Mistral и Cloudflare Workers AI, назначьте основной сервис и резервный маршрут.',
        badges: ['Mistral AI', 'Cloudflare Workers AI', 'Статус подключения'],
        accent: '#f38020',
        glow: '#f6c945',
    },
    {
        raw: 'usage.png',
        output: 'lexisync-ai-usage.png',
        eyebrow: 'РАСХОД И ЛИМИТЫ',
        title: 'Контролируйте модели и использование AI',
        description:
            'Смотрите активную модель, локальную статистику и задавайте безопасные дневные и месячные пределы.',
        badges: ['GLM 4.7 Flash', 'Локальная статистика', 'Лимиты расходов'],
        accent: '#2479e8',
        glow: '#5bd4c7',
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
        *{box-sizing:border-box}html,body{width:1280px;height:800px;margin:0;overflow:hidden}body{position:relative;color:#121a34;background:radial-gradient(circle at 10% 8%,color-mix(in srgb,${scene.accent} 24%,white),transparent 34%),radial-gradient(circle at 92% 88%,color-mix(in srgb,${scene.glow} 32%,white),transparent 38%),linear-gradient(145deg,#fbfcff,#eef3ff);font-family:Inter,system-ui,-apple-system,sans-serif}
        body:before{position:absolute;inset:0;content:"";background-image:linear-gradient(rgba(79,91,145,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(79,91,145,.035) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(90deg,#000,transparent 60%)}
        .copy{position:absolute;z-index:2;top:50px;left:50px;width:405px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:74px;font-size:29px;font-weight:820;letter-spacing:-.03em}.logo{display:grid;width:50px;height:50px;place-items:center;color:white;background:linear-gradient(135deg,${scene.accent},${scene.glow});border:1px solid rgba(255,255,255,.74);border-radius:17px;box-shadow:0 15px 34px color-mix(in srgb,${scene.accent} 28%,transparent);font-size:25px}.eyebrow{margin-bottom:13px;color:${scene.accent};font-size:13px;font-weight:850;letter-spacing:.12em}.title{margin:0;font-size:46px;line-height:1.06;letter-spacing:-.045em}.description{margin:20px 0 23px;color:#59647d;font-size:18px;line-height:1.48}.badges{display:flex;flex-wrap:wrap;gap:8px}.badges span{padding:8px 11px;color:#3d4863;background:rgba(255,255,255,.72);border:1px solid rgba(255,255,255,.9);border-radius:999px;box-shadow:0 8px 24px rgba(48,57,95,.08);font-size:11px;font-weight:700;backdrop-filter:blur(14px)}
        .visual{position:absolute;z-index:1;top:44px;right:30px;width:750px;height:712px;padding:11px;background:rgba(255,255,255,.48);border:1px solid rgba(255,255,255,.88);border-radius:30px;box-shadow:0 30px 76px rgba(35,45,84,.24),inset 0 1px 0 white;transform:perspective(1400px) rotateY(-2deg);backdrop-filter:blur(24px)}.visual:before{position:absolute;top:13px;right:22px;left:22px;height:3px;content:"";background:linear-gradient(90deg,transparent,${scene.accent},${scene.glow},transparent);border-radius:999px;opacity:.76}.visual img{width:100%;height:100%;object-fit:cover;object-position:center top;border-radius:21px;border:1px solid rgba(57,73,125,.12)}
        .step{position:absolute;right:55px;bottom:26px;z-index:3;padding:7px 11px;color:white;background:${scene.accent};border-radius:999px;box-shadow:0 10px 28px color-mix(in srgb,${scene.accent} 36%,transparent);font-size:10px;font-weight:800;letter-spacing:.06em}
    </style></head><body><section class="copy"><div class="brand"><span class="logo">✦</span>LexiSync</div><div class="eyebrow">${scene.eyebrow}</div><h1 class="title">${scene.title}</h1><p class="description">${scene.description}</p><div class="badges">${badges}</div></section><div class="visual"><img src="${imageUrl}" alt=""></div><div class="step">ИНТЕРФЕЙС НА РУССКОМ</div></body></html>`;
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
    await page.screenshot({ path: path.join(rawDir, name), animations: 'disabled' });
}

async function compose(context, scene) {
    const image = await fs.readFile(path.join(rawDir, scene.raw));
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(marketingHtml(scene, `data:image/png;base64,${image.toString('base64')}`));
    await page.locator('.visual img').evaluate((element) => element.decode());
    await page.screenshot({ path: path.join(outputDir, scene.output), animations: 'disabled' });
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
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:grid;place-items:center;background:radial-gradient(circle at 18% 15%,#9e8cff 0,transparent 35%),radial-gradient(circle at 82% 82%,#62d8da 0,transparent 38%),linear-gradient(145deg,#342384,#131a45)}
        .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px);background-size:36px 36px;mask-image:radial-gradient(circle,#000,transparent 76%)}
        .card{position:absolute;width:44%;height:48%;border:1px solid rgba(255,255,255,.38);border-radius:12%;background:rgba(255,255,255,.13);box-shadow:0 28px 80px rgba(8,10,40,.38);backdrop-filter:blur(18px)}.left{left:7%;top:18%;transform:rotate(-8deg)}.right{right:7%;bottom:14%;transform:rotate(8deg)}
        .logo{z-index:2;width:min(30vw,30vh);height:min(30vw,30vh);padding:5%;border:1px solid rgba(255,255,255,.62);border-radius:29%;background:rgba(255,255,255,.94);box-shadow:0 25px 75px rgba(10,14,55,.44)}.logo img{width:100%;height:100%;object-fit:contain}
    </style></head><body><div class="grid"></div><div class="card left"></div><div class="card right"></div><div class="logo"><img src="${iconUrl}" alt=""></div></body></html>`;
}

async function createChromeAssets(context) {
    const chromeScenes = [
        ['lexisync-ai-actions.png', '01-lexisync-ai-actions.png'],
        ['lexisync-result-window.png', '02-lexisync-result-window.png'],
        ['lexisync-ai-providers.png', '03-lexisync-ai-providers.png'],
        ['lexisync-ai-usage.png', '04-lexisync-ai-usage.png'],
        ['lexisync-privacy-settings.png', '05-lexisync-privacy-settings.png'],
    ];
    await fs.mkdir(chromeOutputDir, { recursive: true });
    await Promise.all(
        chromeScenes.map(([source, target]) =>
            sharp(path.join(outputDir, source))
                .resize(1280, 800, { fit: 'cover', position: 'attention' })
                .png()
                .toFile(path.join(chromeOutputDir, target)),
        ),
    );

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
    await background.evaluate(() =>
        chrome.storage.local.set({
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
    await usage.locator('#cloudflareActiveModelDisplay').scrollIntoViewIfNeeded();
    await captureRaw(usage, 'usage.png');
    await usage.close();

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
    for (let step = 0; step < 3; step++) {
        await onboarding.locator('#onboardingNext').click();
        await onboarding.locator(`[data-onboarding-step="${step + 1}"].is-active`).waitFor({ state: 'visible' });
    }
    await onboarding.locator('#onboardingCloudflareAccountId').waitFor({ state: 'visible' });
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
    await createCarousel();
    await createChromeAssets(context);
    process.stdout.write(
        `Создано ${scenes.length} скриншотов и анимированная галерея ${path.relative(rootDir, carouselPath)}\n`,
    );
} finally {
    await context.close();
    if (path.dirname(profileDir) === os.tmpdir() && path.basename(profileDir).startsWith('lexisync-showcase-')) {
        await fs.rm(profileDir, { recursive: true, force: true });
    }
}
