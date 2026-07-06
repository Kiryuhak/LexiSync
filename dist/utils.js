"use strict";
// Генерируем уникальный ключ для кэша
async function getCacheHash(mode, text) {
    const msgBuffer = new TextEncoder().encode(mode + ":" + text.trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return 'ai_cache_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
// Продвинутый парсер ответов (Подсветка + Списки + Абзацы)
function parseMarkdownToHTML(text) {
    let html = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Подсветка исправлений (заменяем **текст** на <mark>)
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<mark>$1</mark>');
    if (html.includes('**'))
        html = html.replace(/\*\*([^*]*)$/, '<mark>$1</mark>'); // Если поток оборвался на половине
    html = html.replace(/\*/g, ''); // Удаляем одиночные звездочки
    // Парсим списки
    html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\.\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>(\n<li>.*<\/li>)*)/g, '<ul style="margin: 8px 0; padding-left: 20px;">$1</ul>');
    // Абзацы
    html = html.replace(/\n/g, '<br>');
    return html;
}
