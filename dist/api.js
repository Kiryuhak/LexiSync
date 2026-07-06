"use strict";
function executeRequest(mode) {
    if (!popupUI)
        return;
    popupUI.style.width = '320px';
    popupUI.style.padding = '0';
    popupUI.style.display = 'block';
    let headerText = '';
    if (mode === "spellcheck")
        headerText = `<span style="font-weight: 600;">Ошибки исправлены</span>`;
    else if (mode === "style")
        headerText = `<span style="display:flex; align-items:center; gap:8px;">${ICONS.style} Измененный стиль</span>`;
    else if (mode === "emoji")
        headerText = `<span style="display:flex; align-items:center; gap:8px;">${ICONS.emoji} Варианты с эмодзи</span>`;
    else if (mode === "layout")
        headerText = `<span style="display:flex; align-items:center; gap:8px;">${ICONS.keyboard} Раскладка исправлена</span>`;
    else if (mode === "translate")
        headerText = 'Перевод';
    const header = document.createElement('div');
    header.className = 'gemini-header';
    header.style.cssText = 'padding: 12px 16px; font-size: 14px; color: var(--text-primary); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; border-radius: 12px 12px 0 0; background: transparent; cursor: grab; user-select: none;';
    header.onmousedown = (e) => {
        const target = e.target;
        if (target.closest('svg') || target.closest('div[style*="cursor: pointer"]') || target.closest('#gemini-lang-label'))
            return;
        isDragging = true;
        isManuallyPositioned = true;
        header.style.cursor = 'grabbing';
        const rect = popupUI.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        e.preventDefault();
    };
    const headerTitleWrapper = document.createElement('div');
    headerTitleWrapper.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: 600; pointer-events: none;';
    if (mode === "translate") {
        headerTitleWrapper.style.pointerEvents = 'auto';
        const langWrap = document.createElement('div');
        langWrap.style.cssText = 'display: flex; align-items: center; gap: 4px; cursor: pointer; position: relative; user-select: none; padding: 6px 10px; margin-left: -10px; border-radius: 8px; transition: background 0.15s;';
        langWrap.innerHTML = `<span id="gemini-lang-label">${currentTargetLang}</span> <span style="margin-top:2px;">${ICONS.chevronDown}</span>`;
        langWrap.onmouseover = () => langWrap.style.background = 'var(--hover-bg)';
        langWrap.onmouseout = () => langWrap.style.background = 'transparent';
        const langDropdown = document.createElement('div');
        langDropdown.className = 'gemini-scroll';
        langDropdown.style.cssText = 'display: none; position: absolute; top: 100%; left: -4px; margin-top: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 12px 24px var(--shadow-color); flex-direction: column; min-width: 140px; z-index: 9999; padding: 8px 0; max-height: 220px; overflow-y: auto; font-weight: normal;';
        const popularLangs = ['Английский', 'Русский', 'Немецкий', 'Французский', 'Испанский', 'Итальянский', 'Польский', 'Китайский', 'Турецкий', 'Японский'];
        popularLangs.forEach(lang => {
            const langItem = document.createElement('div');
            langItem.textContent = lang;
            langItem.style.cssText = `padding: 10px 16px; font-size: 13px; cursor: pointer; transition: background 0.1s; color: var(--text-primary);`;
            if (lang === currentTargetLang) {
                langItem.style.background = 'var(--hover-bg)';
                langItem.style.fontWeight = '600';
            }
            langItem.onmouseover = () => { if (lang !== currentTargetLang)
                langItem.style.background = 'var(--hover-bg)'; };
            langItem.onmouseout = () => { if (lang !== currentTargetLang)
                langItem.style.background = 'transparent'; };
            langItem.onclick = (e) => {
                e.stopPropagation();
                langDropdown.style.display = 'none';
                if (lang !== currentTargetLang) {
                    currentTargetLang = lang;
                    document.getElementById('gemini-lang-label').textContent = lang;
                    if (streamPort)
                        streamPort.disconnect();
                    startStream();
                }
            };
            langDropdown.appendChild(langItem);
        });
        langWrap.appendChild(langDropdown);
        langWrap.onclick = (e) => { e.stopPropagation(); langDropdown.style.display = langDropdown.style.display === 'flex' ? 'none' : 'flex'; };
        headerTitleWrapper.appendChild(langWrap);
    }
    else {
        headerTitleWrapper.innerHTML = headerText;
    }
    const loaderOrClose = document.createElement('div');
    loaderOrClose.innerHTML = `<div class="gemini-loader"></div>`;
    header.appendChild(headerTitleWrapper);
    header.appendChild(loaderOrClose);
    const contentPane = document.createElement('div');
    contentPane.className = 'gemini-scroll';
    contentPane.style.cssText = 'padding: 16px; min-height: 50px; max-height: 50vh; overflow-y: auto; overflow-x: hidden; font-size: 14px; color: var(--text-primary); line-height: 1.6; font-family: system-ui, sans-serif; word-wrap: break-word; white-space: pre-wrap;';
    const actionsContainer = document.createElement('div');
    actionsContainer.style.cssText = 'display: none; padding: 0 16px 16px 16px; gap: 10px;';
    popupUI.innerHTML = '';
    popupUI.appendChild(header);
    popupUI.appendChild(contentPane);
    popupUI.appendChild(actionsContainer);
    adjustPopupPosition();
    let fullResult = "";
    let streamPort = null;
    function startStream() {
        fullResult = "";
        contentPane.textContent = "";
        actionsContainer.style.display = 'none';
        loaderOrClose.innerHTML = `<div class="gemini-loader"></div>`;
        if (!navigator.onLine) {
            contentPane.innerHTML = `<span style="color: #d32f2f;">Нет подключения к интернету. Проверьте сеть и попробуйте снова.</span>`;
            finishStream(false);
            return;
        }
        if (currentSelection.text.length > 3000) {
            contentPane.innerHTML = `<span style="color: #d32f2f;">Текст слишком длинный (${currentSelection.text.length} симв.). Пожалуйста, выделите не более 3000 символов за раз.</span>`;
            finishStream(false);
            return;
        }
        if (!chrome.runtime || !chrome.runtime.connect) {
            contentPane.innerHTML = `<span style="color: #d32f2f;">Пожалуйста, обновите страницу (F5).</span>`;
            return;
        }
        streamPort = chrome.runtime.connect({ name: "geminiStream" });
        streamPort.postMessage({
            action: "callGemini",
            text: currentSelection.text,
            context: currentSelection.context,
            mode: mode,
            targetLang: currentTargetLang,
            // 🔥 ПУНКТ 5: Отправляем контекст вкладки
            pageTitle: document.title,
            pageUrl: window.location.hostname
        });
        streamPort.onMessage.addListener((response) => {
            if (response.status === "chunk") {
                fullResult += response.text;
                // ИСПОЛЬЗУЕМ НАШ НОВЫЙ ПАРСЕР:
                contentPane.innerHTML = parseMarkdownToHTML(fullResult);
                contentPane.scrollTop = contentPane.scrollHeight;
                adjustPopupPosition();
            }
            else if (response.status === "done") {
                contentPane.innerHTML = parseMarkdownToHTML(fullResult);
                finishStream();
                // 🔥 СОХРАНЯЕМ В КЭШ
                const cacheModeKey = mode === 'translate' ? mode + currentTargetLang : mode;
                getCacheHash(cacheModeKey, currentSelection.text).then(cacheKey => {
                    chrome.storage.local.set({ [cacheKey]: fullResult });
                });
                // 🔥 СОХРАНЯЕМ В ИСТОРИЮ (только успешные ответы)
                const historyItem = {
                    id: Date.now(),
                    mode: mode,
                    original: currentSelection.text,
                    result: fullResult.replace(/\*/g, ''), // Чистый текст для истории
                    date: new Date().toISOString()
                };
                chrome.storage.local.get({ aiHistory: [] }, (data) => {
                    const history = data.aiHistory;
                    history.unshift(historyItem); // Добавляем в начало списка
                    if (history.length > 50)
                        history.pop(); // Храним только последние 50 штук
                    chrome.storage.local.set({ aiHistory: history });
                });
            }
            else if (response.status === "error") {
                if (response.error.toLowerCase().includes('rate limit') || response.error.includes('429')) {
                    showRateLimitTimer(5, startStream, contentPane);
                }
                else {
                    contentPane.innerHTML = `<span style="color: #d32f2f;">Ошибка: ${response.error}</span>`;
                }
                finishStream(false);
            }
        });
    }
    function finishStream(success = true) {
        const closeBtn = document.createElement('div');
        closeBtn.innerHTML = ICONS.closeStandard;
        closeBtn.style.cssText = 'cursor: pointer; display: flex; align-items: center; margin-right: -4px; padding: 6px; border-radius: 8px; color: var(--text-secondary); transition: background 0.15s;';
        closeBtn.onmouseover = () => closeBtn.style.background = 'var(--hover-bg)';
        closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
        closeBtn.onclick = closePopup;
        loaderOrClose.innerHTML = '';
        loaderOrClose.appendChild(closeBtn);
        if (success && fullResult.trim().length > 0) {
            actionsContainer.style.display = 'flex';
            actionsContainer.innerHTML = '';
            const cleanResult = fullResult.replace(/\*/g, '');
            const btnClass = (mode === 'translate' || mode === 'layout') ? 'gemini-translate-btn' : 'gemini-btn-action';
            const replaceIcon = (mode === 'translate' || mode === 'layout') ? ICONS.replaceCurved : ICONS.replace;
            const copyIcon = (mode === 'translate' || mode === 'layout') ? ICONS.copyStandard : ICONS.copy;
            const replaceBtn = document.createElement('button');
            replaceBtn.type = 'button';
            replaceBtn.className = btnClass;
            replaceBtn.innerHTML = `${replaceIcon} Заменить текст`;
            replaceBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                insertTextToDOM(cleanResult, replaceBtn);
            };
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = `${btnClass} icon-only`;
            copyBtn.innerHTML = copyIcon;
            copyBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigator.clipboard.writeText(cleanResult);
                copyBtn.innerHTML = (mode === 'translate' || mode === 'layout') ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ICONS.check;
                setTimeout(() => copyBtn.innerHTML = copyIcon, 1500);
            };
            actionsContainer.appendChild(replaceBtn);
            actionsContainer.appendChild(copyBtn);
        }
        adjustPopupPosition();
    }
    // 🔥 ПРОВЕРЯЕМ КЛЮЧ И КЭШ ПЕРЕД ЗАПУСКОМ
    async function checkCacheAndRun() {
        chrome.storage.local.get(['mistralApiKey'], async (res) => {
            const apiKey = res.mistralApiKey;
            // ПУНКТ 1: Защита от пустого ключа + АВТОРЕДИРЕКТ
            if (!apiKey || apiKey.trim() === '') {
                contentPane.innerHTML = `
                    <div style="text-align: center; padding: 24px 16px;">
                        <span style="font-size: 32px; display: block; margin-bottom: 12px;">🔑</span>
                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 8px;">API-ключ не настроен</div>
                        <div style="color: var(--text-secondary); margin-bottom: 16px; font-size: 13px;">Открываем настройки через <span id="redirectTimer" style="font-weight:bold; color:var(--primary);">3</span>...</div>
                        <button id="openSettingsBtn" style="background: var(--primary); color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 500;">Открыть сейчас</button>
                    </div>`;
                let timeLeft = 3;
                const timerSpan = document.getElementById('redirectTimer');
                // Запускаем таймер
                const interval = setInterval(() => {
                    timeLeft--;
                    if (timerSpan)
                        timerSpan.textContent = timeLeft.toString();
                    if (timeLeft <= 0) {
                        clearInterval(interval);
                        chrome.runtime.sendMessage({ action: "openOptionsPage" });
                        closePopup();
                    }
                }, 1000);
                // Если пользователь не хочет ждать и нажал кнопку сам
                setTimeout(() => {
                    document.getElementById('openSettingsBtn')?.addEventListener('click', () => {
                        clearInterval(interval); // Останавливаем таймер
                        chrome.runtime.sendMessage({ action: "openOptionsPage" });
                        closePopup();
                    });
                }, 50);
                return; // Прерываем выполнение!
            }
            // ... (остальной код функции без изменений)
            const cacheModeKey = mode === 'translate' ? mode + currentTargetLang : mode;
            const cacheKey = await getCacheHash(cacheModeKey, currentSelection.text);
            chrome.storage.local.get([cacheKey], (result) => {
                if (result[cacheKey]) {
                    fullResult = result[cacheKey];
                    let finalHtml = parseMarkdownToHTML(fullResult);
                    contentPane.innerHTML = finalHtml;
                    finishStream(true);
                }
                else {
                    startStream();
                }
            });
        });
    }
    // Запускаем проверку кэша
    checkCacheAndRun();
}
