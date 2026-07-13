// 1. Создаем элементы в системном контекстном меню безопасно (с предварительной очисткой)
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: "spellcheck", title: "Исправить ошибки (Alt+R)", contexts: ["selection"] });
        chrome.contextMenus.create({ id: "style", title: "Переписать текст (Alt+Y)", contexts: ["selection"] });
        chrome.contextMenus.create({ id: "emoji", title: "Подобрать эмодзи (Alt+T)", contexts: ["selection"] });
        chrome.contextMenus.create({ id: "layout", title: "Исправить раскладку", contexts: ["selection"] });
        chrome.contextMenus.create({ id: "translate", title: "Перевести", contexts: ["selection"] });
        chrome.contextMenus.create({ id: "ocr", title: "📸 Распознать текст (Alt+S)", contexts: ["page", "image", "selection"] });
    });
});

// 2. Обработчик клика по системному контекстному меню
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (tab && tab.id) {
        // 🔥 НОВОЕ: Если кликнули "Распознать текст" — сразу делаем скриншот
        if (info.menuItemId === "ocr") {
            chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    console.error("Ошибка захвата:", chrome.runtime.lastError);
                    return;
                }
                chrome.tabs.sendMessage(tab.id!, { 
                    action: "startOcrMode", 
                    screenshotUrl: dataUrl 
                });
            });
        } else {
            // Стандартные текстовые функции
            chrome.tabs.sendMessage(tab.id, { 
                action: "contextMenuClicked", 
                mode: info.menuItemId, 
                text: info.selectionText || ""
            });
        }
    }
});

// 3. Обработчик глобальных горячих клавиш Chrome (включая Ножницы)
chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            // 🔥 Если нажали Alt+S (Ножницы)
            if (command === "ocr") {
                chrome.tabs.captureVisibleTab(tabs[0].windowId, { format: "png" }, (dataUrl) => {
                    if (chrome.runtime.lastError) {
                        console.error("Ошибка захвата:", chrome.runtime.lastError);
                        return;
                    }
                    chrome.tabs.sendMessage(tabs[0].id!, { 
                        action: "startOcrMode", 
                        screenshotUrl: dataUrl 
                    });
                });
            } else {
                // Стандартные текстовые хоткеи (Alt+R, Alt+Y, Alt+T)
                chrome.tabs.sendMessage(tabs[0].id, { 
                    action: "hotkeyTriggered", 
                    mode: command 
                });
            }
        }
    });
});

// 4. Обработчик сообщений от контент-скрипта (открытие Истории и Настроек)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "openHistory") {
        chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
    }
    if (request.action === "openOptionsPage") {
        chrome.runtime.openOptionsPage(); // Нативный метод Chrome для открытия настроек
    }
});

// 5. ДВИЖОК API: Работа с Mistral AI (Text & Vision) через потоковое соединение
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "mistralStream") return;

    // Создаем контроллер для отмены запроса
    let abortController = new AbortController();

    // Если UI-панель закрылась/отключилась — убиваем запрос к нейросети
    port.onDisconnect.addListener(() => {
        abortController.abort();
        console.log("Порт закрыт: генерация отменена для экономии токенов.");
    });

    port.onMessage.addListener(async (msg) => {
        if (msg.action === "callMistral") {
            // Пересоздаем контроллер для нового запроса
            abortController.abort();
            abortController = new AbortController(); 

            try {
                // Достаем ключ и стиль из локального хранилища строго как строки
                const data = await chrome.storage.local.get(['mistralApiKey', 'selectedTone']);
                const mistralApiKey = data.mistralApiKey as string;
                const selectedTone = data.selectedTone as string;
                
                if (!mistralApiKey) {
                    port.postMessage({ status: "error", error: "API-ключ не настроен." });
                    return;
                }

                // --- ФОРМИРУЕМ ПАРАМЕТРЫ ЗАПРОСА ---
                let currentModel = "mistral-large-latest";
                let apiMessages: any[] = [];

                // 📸 Если пришла картинка (Режим OCR)
                if (msg.mode === "ocr" && msg.imageUrl) {
                    currentModel = "pixtral-12b-2409";
                    apiMessages = [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "Распознай и извлеки весь текст с этого изображения. Верни ТОЛЬКО извлеченный текст, без пояснений, кавычек и приветствий. Точно сохраняй оригинальные переносы строк и абзацы." },
                                { type: "image_url", image_url: msg.imageUrl }
                            ]
                        }
                    ];
                } else {
                    // 📝 Стандартный текстовый режим
                    let systemPrompt = "Ты умный ассистент по работе с текстом. Твоя задача — вернуть ТОЛЬКО обработанный текст. Не пиши приветствий, объяснений, не оборачивай текст в кавычки или блоки кода (```). КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать HTML-теги, возвращай только чистый текст.";                    
                    // Добавляем контекст страницы
                    if (msg.pageUrl || msg.pageTitle) {
                        systemPrompt += `\nКонтекст: Пользователь работает с текстом на сайте "${msg.pageUrl || 'неизвестный сайт'}" (Заголовок: "${msg.pageTitle || 'Без заголовка'}"). Учитывай специфику этого ресурса при необходимости.`;
                    }

                    // Специфичные инструкции
                    if (msg.mode === "spellcheck") {
                        systemPrompt += " Тщательно исправь все ошибки в тексте. ОБЯЗАТЕЛЬНО оборачивай каждое исправленное, измененное или добавленное слово в двойные звездочки, вот так: **исправленное**.";
                    } else if (msg.mode === "style") {
                        const toneMap: Record<string, string> = {
                            business: "в строгом, деловом и профессиональном стиле",
                            friendly: "в дружелюбном, открытом и разговорном стиле",
                            persuasive: "в убедительном и продающем стиле",
                            creative: "в креативном стиле с использованием ярких метафор"
                        };
                        systemPrompt += ` Перепиши текст ${toneMap[selectedTone || 'business']}, сделав его более естественным. Ключевые измененные фразы или новые слова оборачивай в двойные звездочки, например: **новая фраза**.`;
                    } else if (msg.mode === "emoji") {
                        systemPrompt += " Добавь подходящие по смыслу эмодзи в предоставленный текст, чтобы сделать его более выразительным. Не переборщи.";
                    } else if (msg.mode === "layout") {
                        systemPrompt += " Исправь текст, набранный в неправильной раскладке (например, 'ghbdtn' -> 'привет'). Исправленные слова оберни в двойные звездочки: **привет**.";
                    } else if (msg.mode === "translate") {
                        // Получаем язык браузера (например, "ru" или "en") или задаем русский по умолчанию
                        const target = msg.targetLang || chrome.i18n.getUILanguage() || 'русский';
                        systemPrompt += ` Переведи этот текст на ${target} язык.`;
                    }

                    apiMessages = [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Широкий контекст вокруг выделенного текста: ${msg.context || ''}\n\nСам выделенный текст для обработки: ${msg.text}` }
                    ];
                }

                // --- ЗАПРОС К MISTRAL API ---
                const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
                    method: 'POST',
                    signal: abortController.signal, // 🔥 ДОБАВЛЯЕМ СИГНАЛ СЮДА
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${mistralApiKey}`
                    },
                    body: JSON.stringify({
                        model: currentModel,
                        messages: apiMessages,
                        stream: true
                    })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    if (response.status === 401) {
                         port.postMessage({ status: "error", error: "Неверный API-ключ. Проверьте настройки." });
                    } else if (response.status === 429) {
                         port.postMessage({ status: "error", error: "Rate limit (превышен лимит запросов)." });
                    } else {
                         port.postMessage({ status: "error", error: `Ошибка Mistral API (${response.status}): ${errText}` });
                    }
                    return;
                }

                // --- ПАРСИНГ ПОТОКА ДАННЫХ (STREAM) ---
                const reader = response.body?.getReader();
                const decoder = new TextDecoder();

                if (reader) {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n').filter(line => line.trim() !== '');
                        
                        for (const line of lines) {
                            if (line.replace(/^data: /, '') === '[DONE]') {
                                port.postMessage({ status: "done" });
                                return;
                            }
                            if (line.startsWith('data: ')) {
                                try {
                                    const parsed = JSON.parse(line.replace(/^data: /, ''));
                                    if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                                        port.postMessage({ status: "chunk", text: parsed.choices[0].delta.content });
                                    }
                                } catch (e) {
                                    console.error("Ошибка парсинга чанка:", e);
                                }
                            }
                        }
                    }
                }
                port.postMessage({ status: "done" });

            } catch (err: any) {
                // 🔥 Игнорируем ошибку, если мы сами отменили запрос
                if (err.name === 'AbortError') return; 
                
                console.error("Глобальная ошибка API:", err);
                port.postMessage({ status: "error", error: err.message || "Неизвестная ошибка сети." });
            }
        }
    });
});