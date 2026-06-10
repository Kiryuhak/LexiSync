let currentSelection = { text: "", range: null, activeElement: null, start: null, end: null, isInput: false };
let popupUI = null;

// Набор цветных иконок в стиле Material 3 Expressive
const ICONS = {
    google: `<svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/><path d="M1 1h22v22H1z" fill="none"/></svg>`,
    edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#E8F0FE" stroke="#1A73E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
    copy: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#E0F2F1" stroke="#00897B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none"></path></svg>`,
    translate: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#E6F4EA" stroke="#1E8E3E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" fill="#E6F4EA"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
    check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#34A853" stroke="#34A853" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="8 12 11 15 16 9" stroke="#FFFFFF" stroke-width="2"></polyline></svg>`,
    replace: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D93025" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>`,
    close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#70757A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    spell: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#FCE8E6" stroke="#D93025" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
    rephrase: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#F3E8FD" stroke="#9334E6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14" fill="none"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3" fill="none"></path></svg>`,
    style: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#FEF7E0" stroke="#F9AB00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#FEF7E0"></polygon></svg>`,
    emoji: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#FFF3E0" stroke="#FA7B17" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" fill="#FFF3E0"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2" fill="none"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>`
};

// СЛУШАТЕЛЬ 1: Выделение мышкой
document.addEventListener('mouseup', (e) => {
    if (e.target.closest('#gemini-extension-ui')) return;

    setTimeout(() => {
        const text = getSelectedText();
        if (text && text.trim().length > 0) {
            saveSelectionState();
            showToolbarMenu(e.pageX, e.pageY);
        } else {
            closePopup();
        }
    }, 10);
});

// СЛУШАТЕЛЬ 2: Клавиатура (Ctrl+A и наши Горячие Клавиши)
document.addEventListener('keydown', (e) => {
    if (e.target.closest('#gemini-extension-ui')) return;

    // 1. Выделение всего текста (Ctrl+A / Cmd+A)
    const isSelectAll = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a';
    if (isSelectAll) {
        setTimeout(() => {
            const text = getSelectedText();
            if (text && text.trim().length > 0) {
                saveSelectionState();
                const coords = getSelectionCoords();
                showToolbarMenu(coords.x, coords.y);
            } else {
                closePopup();
            }
        }, 50);
        return;
    }

    // 2. Горячие клавиши нейросети (Alt + R/U/Y/T)
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        let mode = null;
        
        // Поддержка обеих раскладок: английской и русской
        if (key === 'r' || key === 'к') mode = 'spellcheck';
        else if (key === 'u' || key === 'г') mode = 'rephrase';
        else if (key === 'y' || key === 'н') mode = 'style';
        else if (key === 't' || key === 'е') mode = 'emoji';

        if (mode) {
            const text = getSelectedText();
            if (text && text.trim().length > 0) {
                e.preventDefault(); // Останавливаем стандартные браузерные действия
                saveSelectionState();
                const coords = getSelectionCoords();
                
                // Сразу показываем вертикальное меню и запускаем загрузку
                showAIMenu(coords.x, coords.y);
                handleActionClick(mode);
            }
        }
    }
});

function getSelectedText() {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        return activeEl.value.substring(activeEl.selectionStart, activeEl.selectionEnd);
    }
    return window.getSelection().toString();
}

function saveSelectionState() {
    const activeEl = document.activeElement;
    const sel = window.getSelection();
    currentSelection = { text: "", range: null, activeElement: activeEl, start: null, end: null, isInput: false };

    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        currentSelection.isInput = true;
        currentSelection.start = activeEl.selectionStart;
        currentSelection.end = activeEl.selectionEnd;
        currentSelection.text = activeEl.value.substring(activeEl.selectionStart, activeEl.selectionEnd);
    } else if (sel.rangeCount > 0) {
        currentSelection.range = sel.getRangeAt(0).cloneRange();
        currentSelection.text = sel.toString();
    }
}

function getSelectionCoords() {
    const activeEl = document.activeElement;
    let rect = null;

    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        rect = activeEl.getBoundingClientRect();
    } else {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            rect = sel.getRangeAt(0).getBoundingClientRect();
        }
    }

    if (rect) {
        let x = rect.left + window.scrollX;
        let y = rect.bottom + window.scrollY;

        const viewportBottom = window.scrollY + window.innerHeight;
        if (y > viewportBottom - 80) y = viewportBottom - 80; 
        if (y < window.scrollY + 20) y = window.scrollY + 40;
        
        return { x: x, y: y };
    }
    return { x: window.innerWidth / 2 + window.scrollX, y: window.innerHeight / 2 + window.scrollY };
}

function showToolbarMenu(x, y) {
    closePopup();

    popupUI = document.createElement('div');
    popupUI.id = 'gemini-extension-ui';
    popupUI.style.cssText = `
        position: absolute; left: ${x}px; top: ${y + 12}px;
        background: #ffffff; border: 1px solid #e0e0e0;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        border-radius: 8px; z-index: 2147483647;
        font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
        color: #333; display: flex; align-items: center; padding: 4px; gap: 2px;
    `;

    const createBtn = (icon, text, title, onClick) => {
        const btn = document.createElement('div');
        btn.innerHTML = `<span style="display: flex; align-items: center; justify-content: center; color: #444;">${icon}</span>${text ? `<span style="margin-left: 6px; font-weight: 500;">${text}</span>` : ''}`;
        btn.title = title;
        btn.style.cssText = `padding: 6px 8px; cursor: pointer; border-radius: 6px; display: flex; align-items: center; transition: background 0.15s;`;
        btn.onmouseover = () => btn.style.backgroundColor = '#f0f2f5';
        btn.onmouseout = () => btn.style.backgroundColor = 'transparent';
        btn.onclick = (e) => { e.stopPropagation(); onClick(e, btn); };
        return btn;
    };

    const divider = () => {
        const d = document.createElement('div');
        d.style.cssText = `width: 1px; height: 16px; background: #e0e0e0; margin: 0 4px;`;
        return d;
    };

    popupUI.appendChild(createBtn(ICONS.google, '', 'Искать в Google', () => {
        window.open('https://www.google.com/search?q=' + encodeURIComponent(currentSelection.text), '_blank');
        closePopup();
    }));

    popupUI.appendChild(divider());

    popupUI.appendChild(createBtn(ICONS.edit, 'Редактировать', 'Функции текста', () => {
        const rect = popupUI.getBoundingClientRect();
        showAIMenu(rect.left + window.scrollX, rect.top + window.scrollY);
    }));

    popupUI.appendChild(divider());

    popupUI.appendChild(createBtn(ICONS.copy, '', 'Копировать', (e, btn) => {
        navigator.clipboard.writeText(currentSelection.text);
        btn.innerHTML = `<span style="display: flex; align-items: center; justify-content: center;">${ICONS.check}</span>`;
        setTimeout(() => closePopup(), 1000);
    }));

    popupUI.appendChild(divider());

    popupUI.appendChild(createBtn(ICONS.translate, '', 'Перевести', () => {
        handleActionClick('translate');
    }));

    document.body.appendChild(popupUI);
    adjustPopupPosition(x, y);
}

function showAIMenu(x, y) {
    closePopup();

    popupUI = document.createElement('div');
    popupUI.id = 'gemini-extension-ui';
    popupUI.style.cssText = `
        position: absolute; left: ${x}px; top: ${y}px;
        background: #fff; border: 1px solid #e0e0e0;
        box-shadow: 0 6px 16px rgba(0,0,0,0.1);
        border-radius: 8px; z-index: 2147483647;
        font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
        color: #333; width: max-content; min-width: 220px; 
        overflow: hidden; padding: 4px;
    `;

    // Обновленная функция для создания кнопок с визуальными хоткеями
    const createMenuBtn = (icon, text, mode, shortcut) => {
        const btn = document.createElement('div');
        btn.innerHTML = `
            <div style="display: flex; align-items: center;">
                <span style="margin-right: 10px; display: flex;">${icon}</span>
                <span style="font-weight: 400;">${text}</span>
            </div>
            ${shortcut ? `<span style="color: #aaa; font-size: 11px; margin-left: 24px; letter-spacing: 0.5px;">${shortcut}</span>` : ''}
        `;
        // Добавили justify-content: space-between чтобы разнести текст и хоткей по краям
        btn.style.cssText = `padding: 8px 12px; cursor: pointer; transition: background 0.15s; display: flex; align-items: center; justify-content: space-between; border-radius: 6px;`;
        btn.onmouseover = () => btn.style.backgroundColor = '#f0f2f5';
        btn.onmouseout = () => btn.style.backgroundColor = 'transparent';
        btn.onclick = () => handleActionClick(mode);
        return btn;
    };

    // Добавляем хоткеи в отрисовку
    popupUI.appendChild(createMenuBtn(ICONS.spell, 'Исправить ошибки', 'spellcheck', 'Alt+R'));
    popupUI.appendChild(createMenuBtn(ICONS.rephrase, 'Другими словами', 'rephrase', 'Alt+U'));
    popupUI.appendChild(createMenuBtn(ICONS.style, 'Улучшить стиль', 'style', 'Alt+Y'));
    popupUI.appendChild(createMenuBtn(ICONS.emoji, 'Подобрать эмодзи', 'emoji', 'Alt+T'));

    document.body.appendChild(popupUI);
    adjustPopupPosition(x, y);
}

function handleActionClick(mode) {
    popupUI.style.width = 'max-content';
    popupUI.style.padding = '0';
    popupUI.innerHTML = `<div style="padding: 10px 14px; font-weight: 500; color: #555; display: flex; align-items: center; gap: 8px;"><div class="gemini-loader"></div>Обработка...</div>`;
    
    if (!document.getElementById('gemini-loader-style')) {
        const style = document.createElement('style');
        style.id = 'gemini-loader-style';
        style.textContent = `@keyframes gemini-spin { to { transform: rotate(360deg); } } .gemini-loader { width: 14px; height: 14px; border: 2px solid #ccc; border-top-color: #666; border-radius: 50%; animation: gemini-spin 0.8s linear infinite; }`;
        document.head.appendChild(style);
    }

    chrome.runtime.sendMessage({ action: "callGemini", text: currentSelection.text, mode: mode }, (response) => {
        if (chrome.runtime.lastError) {
            popupUI.innerHTML = `<div style="padding: 10px 14px; color: #d32f2f;">Сбой связи.</div>`;
            setTimeout(closePopup, 2000);
            return;
        }

        if (response && response.success) {
            showResultsMenu(response.data, mode);
        } else {
            popupUI.innerHTML = `<div style="padding: 10px 14px; color: #d32f2f;">Ошибка: ${response ? response.error : 'Неизвестная ошибка'}</div>`;
            setTimeout(closePopup, 3000);
        }
    });
}

function showResultsMenu(options, mode) {
    popupUI.innerHTML = '';
    popupUI.style.width = '320px'; 
    
    const header = document.createElement('div');
    if (mode === "translate") header.innerHTML = `<span style="display:flex; align-items:center; gap:6px;">${ICONS.translate} Перевод</span>`;
    else if (mode === "emoji") header.innerHTML = `<span style="display:flex; align-items:center; gap:6px;">${ICONS.emoji} Варианты с эмодзи</span>`;
    else header.innerHTML = `Выберите вариант`;
    
    header.style.cssText = 'padding: 8px 12px; font-size: 13px; font-weight: 600; color: #333; border-bottom: 1px solid #eaeaea; background: #fafafa; display: flex; justify-content: space-between; align-items: center;';
    
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = ICONS.close;
    closeBtn.style.cssText = 'cursor: pointer; color: #777; display: flex; align-items: center; padding: 4px; border-radius: 4px; transition: background 0.15s;';
    closeBtn.onmouseover = () => closeBtn.style.background = '#e4e4e4';
    closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
    closeBtn.onclick = closePopup;
    header.appendChild(closeBtn);
    
    popupUI.appendChild(header);

    if (!document.getElementById('gemini-styles')) {
        const style = document.createElement('style');
        style.id = 'gemini-styles';
        style.textContent = `
            #gemini-extension-ui mark { background: #dcfce7; color: #166534; padding: 2px 4px; border-radius: 4px; font-weight: 500; }
            .gemini-btn-action { 
                background: #f5f5f5; border: 1px solid #eaeaea; border-radius: 6px; padding: 6px 10px; 
                font-size: 13px; cursor: pointer; color: #444; display: flex; align-items: center; gap: 6px; 
                transition: all 0.15s; font-family: inherit; font-weight: 500;
            }
            .gemini-btn-action:hover { background: #ebebeb; color: #222; }
        `;
        document.head.appendChild(style);
    }

    options.forEach((opt, index) => {
        const item = document.createElement('div');
        item.style.cssText = `padding: 12px; border-bottom: ${index < options.length - 1 ? '1px solid #eaeaea' : 'none'};`;
        
        const textContainer = document.createElement('div');
        textContainer.innerHTML = opt.html || opt.clean || opt;
        textContainer.style.cssText = `word-wrap: break-word; white-space: pre-wrap; margin-bottom: 12px; color: #222;`;
        
        const actionsContainer = document.createElement('div');
        actionsContainer.style.cssText = `display: flex; gap: 8px;`;

        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'gemini-btn-action';
        replaceBtn.innerHTML = `${ICONS.replace} Заменить`;
        replaceBtn.onclick = (e) => {
            e.preventDefault();
            insertTextToDOM(opt.clean || opt);
            closePopup();
        };

        const copyBtn = document.createElement('button');
        copyBtn.className = 'gemini-btn-action';
        copyBtn.innerHTML = ICONS.copy;
        copyBtn.title = "Копировать в буфер";
        copyBtn.onclick = (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(opt.clean || opt);
            copyBtn.innerHTML = ICONS.check;
            setTimeout(() => copyBtn.innerHTML = ICONS.copy, 1500); 
        };

        actionsContainer.appendChild(replaceBtn);
        actionsContainer.appendChild(copyBtn);

        item.appendChild(textContainer);
        item.appendChild(actionsContainer);
        popupUI.appendChild(item);
    });
}

function insertTextToDOM(newText) {
    const { isInput, activeElement, start, end, range } = currentSelection;
    try {
        if (isInput && activeElement) {
            const val = activeElement.value;
            activeElement.value = val.substring(0, start) + newText + val.substring(end);
            activeElement.selectionStart = activeElement.selectionEnd = start + newText.length;
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (range) {
            range.deleteContents();
            const textNode = document.createTextNode(newText);
            range.insertNode(textNode);
            
            const sel = window.getSelection();
            sel.removeAllRanges();
            const newRange = document.createRange();
            newRange.setStartAfter(textNode);
            newRange.setEndAfter(textNode);
            sel.addRange(newRange);
            
            if (activeElement) activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } catch (err) {
        console.error("Ошибка вставки:", err);
    }
}

function closePopup() {
    if (popupUI) {
        popupUI.remove();
        popupUI = null;
    }
}

function adjustPopupPosition(mouseX, mouseY) {
    if (!popupUI) return;
    const rect = popupUI.getBoundingClientRect();
    const spaceBelow = window.innerHeight - mouseY;
    
    if (mouseX + rect.width > window.innerWidth) {
        popupUI.style.left = `${window.innerWidth - rect.width - 20 + window.scrollX}px`;
    }
    
    if (spaceBelow < rect.height + 40) {
        popupUI.style.top = `${mouseY - rect.height - 15 + window.scrollY}px`;
    }
}