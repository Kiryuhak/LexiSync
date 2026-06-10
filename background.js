import { API_KEY } from './config.js'; 

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "checkText", title: "Исправить ошибки (Alt+R)", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "addEmojis", title: "Подобрать эмодзи (Alt+T)", contexts: ["selection"] });
  // Добавляем новые пункты меню
  chrome.contextMenus.create({ id: "rephraseText", title: "Другими словами (Alt+U)", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "improveStyle", title: "Улучшить стиль (Alt+Y)", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "checkText") await initiateCheck(tab, info.selectionText, "spellcheck");
  else if (info.menuItemId === "addEmojis") await initiateCheck(tab, info.selectionText, "emoji");
  else if (info.menuItemId === "rephraseText") await initiateCheck(tab, info.selectionText, "rephrase");
  else if (info.menuItemId === "improveStyle") await initiateCheck(tab, info.selectionText, "style");
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === "check_text_shortcut") await initiateCheck(tab, null, "spellcheck");
  else if (command === "suggest_emoji_shortcut") await initiateCheck(tab, null, "emoji");
  else if (command === "rephrase_shortcut") await initiateCheck(tab, null, "rephrase");
  else if (command === "style_shortcut") await initiateCheck(tab, null, "style");
});

async function initiateCheck(tab, fallbackText, action) {
  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: drawLoaderAndGetText
    });
    
    let selectedText = injectionResults[0]?.result || fallbackText;

    if (selectedText && selectedText.trim().length > 0) {
      await processText(selectedText, tab, action);
    } else {
      removeLoaderFromTab(tab.id);
    }
  } catch (err) {
    console.error("Ошибка инициализации:", err);
  }
}

async function processText(textToFix, tab, action) {
  try {
    let promptText = "";
    let temp = 0.1; // По умолчанию температура низкая для точности
    
    // Распределяем промпты в зависимости от того, что нажал пользователь
    if (action === "spellcheck") {
        promptText = `Исправь ошибки. Дай 2 варианта. Верни СТРОГО JSON-массив: [{"clean": "чистый текст", "html": "текст, где исправленные слова обернуты в тег <mark>"}]. Никакого markdown.\n\nТекст:\n${textToFix}`;
    } else if (action === "emoji") {
        temp = 0.7; // Повышаем креативность для эмодзи
        promptText = `Расставь подходящие по смыслу эмодзи. Дай 3 разных варианта. Верни СТРОГО JSON-массив: [{"clean": "текст с эмодзи", "html": "текст с эмодзи"}]. Никакого markdown.\n\nТекст:\n${textToFix}`;
    } else if (action === "rephrase") {
        temp = 0.5; // Средняя креативность для перефразирования
        promptText = `Перепиши этот текст другими словами, сохранив исходный смысл. Сделай его живым и естественным. Дай 3 разных варианта. Верни СТРОГО JSON-массив: [{"clean": "перефразированный текст", "html": "перефразированный текст"}]. Никакого markdown.\n\nТекст:\n${textToFix}`;
    } else if (action === "style") {
        temp = 0.3; // Умеренная креативность для стиля
        promptText = `Улучши стиль этого текста (Tone of Voice). Сделай его более профессиональным, структурированным и легко читаемым. Убери воду. Дай 2 варианта. Верни СТРОГО JSON-массив: [{"clean": "улучшенный текст", "html": "улучшенный текст"}]. Никакого markdown.\n\nТекст:\n${textToFix}`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: temp, 
          maxOutputTokens: 800 // Увеличили лимит токенов, так как при перефразировании текст может стать длиннее
        }
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    if (data.candidates && data.candidates.length > 0) {
        let rawText = data.candidates[0].content.parts[0].text;
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) rawText = jsonMatch[0];
        else throw new Error("Нейросеть не вернула массив. Ответ: " + rawText);
        
        let optionsArray = JSON.parse(rawText);

        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showCorrectionUI,
          args: [optionsArray, action] 
        });
    }
  } catch (error) {
    console.error("Ошибка API:", error);
    removeLoaderFromTab(tab.id);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (errMessage) => alert(`Ошибка расширения:\n${errMessage}`),
      args: [error.message]
    });
  }
}

function removeLoaderFromTab(tabId) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
            const loader = document.getElementById('gemini-spell-loader');
            if (loader) loader.remove();
        }
    });
}

function drawLoaderAndGetText() {
    let text = "";
    let rect = null;
    const activeEl = document.activeElement;
    const sel = window.getSelection();

    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        text = activeEl.value.substring(activeEl.selectionStart, activeEl.selectionEnd);
        rect = activeEl.getBoundingClientRect();
    } else if (sel.rangeCount > 0) {
        text = sel.toString();
        rect = sel.getRangeAt(0).getBoundingClientRect();
    }

    if (!text.trim()) return null;

    const existing = document.getElementById('gemini-spell-loader');
    if (existing) existing.remove();

    const loader = document.createElement('div');
    loader.id = 'gemini-spell-loader';
    loader.textContent = '⚡ Обработка...'; 
    loader.style.position = 'absolute';
    loader.style.zIndex = '2147483647';
    loader.style.backgroundColor = '#2c3e50';
    loader.style.color = '#ecf0f1';
    loader.style.padding = '6px 12px';
    loader.style.borderRadius = '20px';
    loader.style.fontSize = '13px';
    loader.style.fontFamily = 'system-ui, sans-serif';
    loader.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    loader.style.pointerEvents = 'none';

    if (rect && rect.width > 0) {
        const spaceBelow = window.innerHeight - rect.bottom;
        const leftPos = Math.min(rect.left, window.innerWidth - 120); 
        loader.style.left = `${leftPos + window.scrollX}px`;

        if (spaceBelow < 80) {
            loader.style.top = `${rect.top + window.scrollY - 8}px`;
            loader.style.transform = 'translateY(-100%)';
        } else {
            loader.style.top = `${rect.bottom + window.scrollY + 8}px`;
            loader.style.transform = 'none';
        }
    } else {
        loader.style.position = 'fixed';
        loader.style.left = '50%';
        loader.style.top = '50%';
        loader.style.transform = 'translate(-50%, -50%)';
    }

    document.body.appendChild(loader);
    return text;
}

function showCorrectionUI(options, action) {
  const loader = document.getElementById('gemini-spell-loader');
  if (loader) loader.remove();

  const activeElement = document.activeElement;
  const selection = window.getSelection();
  
  let savedRange = null;
  let startOffset = null;
  let endOffset = null;
  let isInputOrTextarea = false;
  let rect = null;

  if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
    isInputOrTextarea = true;
    startOffset = activeElement.selectionStart;
    endOffset = activeElement.selectionEnd;
    rect = activeElement.getBoundingClientRect();
  } else if (selection.rangeCount > 0) {
    savedRange = selection.getRangeAt(0).cloneRange();
    rect = savedRange.getBoundingClientRect();
  }

  const popup = document.createElement('div');
  popup.id = 'gemini-popup-container'; 
  popup.style.position = 'absolute';
  popup.style.backgroundColor = '#ffffff';
  popup.style.border = '1px solid #c0c0c0';
  popup.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
  popup.style.zIndex = '2147483647';
  popup.style.padding = '6px 0';
  popup.style.borderRadius = '8px';
  popup.style.fontFamily = 'system-ui, sans-serif';
  popup.style.fontSize = '14px';
  popup.style.color = '#000';
  popup.style.minWidth = '250px';
  popup.style.maxWidth = '450px';

  const style = document.createElement('style');
  style.textContent = `
    #gemini-popup-container mark {
        background-color: #ffeeb2; 
        color: #b47a00;
        padding: 0px 4px;
        border-radius: 4px;
        font-weight: 500;
    }
    .gemini-item {
        padding: 10px 16px;
        cursor: pointer;
        line-height: 1.5;
        transition: background-color 0.1s;
    }
    .gemini-item:hover {
        background-color: #f4f6f8;
    }
  `;
  popup.appendChild(style);

  if (!rect || (rect.x === 0 && rect.y === 0)) {
      popup.style.position = 'fixed';
      popup.style.left = '50%';
      popup.style.top = '50%';
      popup.style.transform = 'translate(-50%, -50%)';
  } else {
      const spaceBelow = window.innerHeight - rect.bottom;
      const popupExpectedWidth = 300; 
      
      if (rect.left + popupExpectedWidth > window.innerWidth) {
          popup.style.left = `${window.innerWidth - popupExpectedWidth - 20 + window.scrollX}px`;
      } else {
          popup.style.left = `${rect.left + window.scrollX}px`;
      }

      if (spaceBelow < 200) {
          popup.style.top = `${rect.top + window.scrollY - 10}px`;
          popup.style.transform = 'translateY(-100%)'; 
      } else {
          popup.style.top = `${rect.bottom + window.scrollY + 10}px`;
          popup.style.transform = 'none';
      }
  }

  const header = document.createElement('div');
  
  // Динамический заголовок в зависимости от выбранного режима
  if (action === "emoji") header.textContent = 'Выберите вариант с эмодзи:';
  else if (action === "rephrase") header.textContent = 'Выберите вариант перефразирования:';
  else if (action === "style") header.textContent = 'Выберите вариант с улучшенным стилем:';
  else header.textContent = 'Выберите вариант (подсвечены исправления):';
  
  header.style.padding = '4px 16px 8px';
  header.style.fontSize = '12px';
  header.style.color = '#666';
  header.style.borderBottom = '1px solid #eee';
  popup.appendChild(header);

  options.forEach((opt, index) => {
    const item = document.createElement('div');
    item.className = 'gemini-item';
    item.style.borderBottom = index < options.length - 1 ? '1px solid #f0f0f0' : 'none';
    
    item.innerHTML = opt.html || opt.clean || opt; 
    
    item.onclick = (e) => {
      e.preventDefault();
      const textToInsert = opt.clean || opt; 

      try {
          if (isInputOrTextarea) {
            const textBefore = activeElement.value.substring(0, startOffset);
            const textAfter = activeElement.value.substring(endOffset);
            activeElement.value = textBefore + textToInsert + textAfter;
            activeElement.selectionStart = activeElement.selectionEnd = startOffset + textToInsert.length;
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (savedRange) {
            savedRange.deleteContents();
            const textNode = document.createTextNode(textToInsert);
            savedRange.insertNode(textNode);
            
            const newSelection = window.getSelection();
            newSelection.removeAllRanges();
            const newRange = document.createRange();
            newRange.setStartAfter(textNode);
            newRange.setEndAfter(textNode);
            newSelection.addRange(newRange);
            
            if (activeElement) {
                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
      } catch(err) {
          console.error("Ошибка при вставке текста:", err);
      }
      popup.remove();
    };
    popup.appendChild(item);
  });

  const closePopup = (e) => {
    if (!popup.contains(e.target)) {
      popup.remove();
      document.removeEventListener('mousedown', closePopup);
    }
  };
  
  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('mousedown', closePopup), 50);
}