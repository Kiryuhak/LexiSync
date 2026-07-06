// 1. Создаем элементы в системном контекстном меню (ПКМ) при установке расширения
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: "spellcheck", title: "Исправить ошибки (Alt+R)", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "style", title: "Переписать текст (Alt+Y)", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "emoji", title: "Подобрать эмодзи (Alt+T)", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "layout", title: "Исправить раскладку", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "translate", title: "Перевести", contexts: ["selection"] });
});

// 2. Обработчик клика по системному контекстному меню
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { 
            action: "contextMenuClicked", 
            mode: info.menuItemId, 
            text: info.selectionText 
        });
    }
});

// 3. Обработчик глобальных горячих клавиш Chrome (Alt+R, Alt+Y, Alt+T)
chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { 
                action: "hotkeyTriggered", 
                mode: command 
            });
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

// 5. ДВИЖОК API: Работа с Mistral AI через потоковое соединение (Streaming)
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "geminiStream") return;

    port.onMessage.addListener(async (msg) => {
        if (msg.action === "callGemini") {
            try {
                // Достаем ключ и стиль из хранилища, явно указывая TypeScript, что это строки
                const data = await chrome.storage.local.get(['mistralApiKey', 'selectedTone']);
                const mistralApiKey = data.mistralApiKey as string;
                const selectedTone = data.selectedTone as string;
                
                if (!mistralApiKey) {
                    port.postMessage({ status: "error", error: "API-ключ не настроен. Откройте настройки расширения." });
                    return;
                }

                // --- ФОРМИРУЕМ СИСТЕМНЫЙ ПРОМПТ ---
                let systemPrompt = "Ты умный ассистент по работе с текстом. Твоя задача — вернуть ТОЛЬКО обработанный текст. Не пиши приветствий, объяснений, не оборачивай текст в кавычки или блоки кода (```). Сохраняй оригинальное HTML-форматирование (теги), если оно есть.";
                
                // 🔥 Добавляем контекст страницы, на которой находится пользователь
                if (msg.pageUrl || msg.pageTitle) {
                    systemPrompt += `\nКонтекст: Пользователь работает с текстом на сайте "${msg.pageUrl || 'неизвестный сайт'}" (Заголовок: "${msg.pageTitle || 'Без заголовка'}"). Учитывай специфику этого ресурса при необходимости.`;
                }

                // Добавляем специфичные инструкции для выбранного режима
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
                    systemPrompt += ` Переведи этот текст на ${msg.targetLang} язык.`;
                }

                // --- ЗАПРОС К MISTRAL API ---
                const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${mistralApiKey}`
                    },
                    body: JSON.stringify({
                        model: "mistral-large-latest",
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: `Широкий контекст вокруг выделенного текста: ${msg.context || ''}\n\nСам выделенный текст для обработки: ${msg.text}` }
                        ],
                        stream: true // Включаем потоковую передачу
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
                console.error("Глобальная ошибка API:", err);
                port.postMessage({ status: "error", error: err.message || "Неизвестная ошибка сети." });
            }
        }
    });
});