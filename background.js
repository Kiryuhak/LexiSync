import { API_KEY } from './config.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "callGemini") {
    // Передаем целевой язык в функцию обработки
    processText(request.text, request.mode, request.targetLang)
      .then(data => sendResponse({ success: true, data: data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; 
  }
});

async function processText(textToFix, mode, targetLang) {
    let promptText = "";
    let temp = 0.1;
    
    if (mode === "spellcheck") {
        promptText = `Исправь ошибки. Дай 2 варианта. Верни СТРОГО JSON-массив: [{"clean": "чистый текст", "html": "текст, где ТОЛЬКО измененные слова обернуты в <mark>"}]. Не оборачивай неизмененные слова.\n\nТекст:\n${textToFix}`;
    } else if (mode === "emoji") {
        temp = 0.7; 
        promptText = `Расставь эмодзи. Дай 3 варианта. Верни СТРОГО JSON-массив: [{"clean": "текст с эмодзи", "html": "текст с эмодзи"}]. Никакого markdown.\n\nТекст:\n${textToFix}`;
    } else if (mode === "rephrase") {
        temp = 0.5; 
        promptText = `Перепиши другими словами. Дай 3 варианта. Верни СТРОГО JSON-массив: [{"clean": "перефразированный текст", "html": "перефразированный текст"}]. Никакого markdown.\n\nТекст:\n${textToFix}`;
    } else if (mode === "style") {
        temp = 0.3; 
        promptText = `Улучши стиль текста. Сделай его деловым. Дай 2 варианта. Верни СТРОГО JSON-массив: [{"clean": "улучшенный текст", "html": "улучшенный текст"}]. Никакого markdown.\n\nТекст:\n${textToFix}`;
    } else if (mode === "translate") {
        temp = 0.1; 
        // Нейросеть будет переводить на язык, который выбрал пользователь
        const lang = targetLang || "Английский";
        promptText = `Переведи этот текст на язык: ${lang}. Верни СТРОГО JSON-массив: [{"clean": "переведенный текст", "html": "переведенный текст"}]. Никакого markdown.\n\nТекст:\n${textToFix}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal, 
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: temp, 
              maxOutputTokens: 800
            }
          })
        });

        clearTimeout(timeoutId); 

        const data = await response.json();
        
        if (response.status === 503 || (data.error && data.error.message.includes("high demand"))) {
            throw new Error("Сервера Google сейчас перегружены. Попробуйте через пару минут.");
        }

        if (data.error) throw new Error(data.error.message);

        if (data.candidates && data.candidates.length > 0) {
            let rawText = data.candidates[0].content.parts[0].text;
            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            if (jsonMatch) rawText = jsonMatch[0];
            else throw new Error("Сбой формата ответа.");
            
            return JSON.parse(rawText);
        }
        throw new Error("Пустой ответ от нейросети.");
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error("Сервер слишком долго думает (таймаут).");
        }
        throw error;
    }
}
