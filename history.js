document.addEventListener('DOMContentLoaded', loadHistory);
document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

function getModeName(mode) {
    const modes = {
        'spellcheck': 'Исправление ошибок',
        'rephrase': 'Другими словами',
        'style': 'Улучшение стиля',
        'emoji': 'Эмодзи',
        'translate': 'Перевод'
    };
    return modes[mode] || mode;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('ru-RU', { 
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
    });
}

function loadHistory() {
    chrome.storage.local.get(['aiHistory'], (result) => {
        const container = document.getElementById('history-container');
        const history = result.aiHistory || [];

        if (history.length === 0) {
            container.innerHTML = '<div class="empty-state">История пуста. Здесь будут появляться ваши запросы (хранятся 7 дней).</div>';
            return;
        }

        container.innerHTML = ''; // Очищаем контейнер

        history.forEach(item => {
            const card = document.createElement('div');
            card.className = 'history-card';
            
            card.innerHTML = `
                <div class="card-header">
                    <span class="mode-badge">${getModeName(item.mode)}</span>
                    <span>${formatDate(item.timestamp)}</span>
                </div>
                <div class="text-blocks">
                    <div>
                        <div style="font-size: 12px; color: var(--m3-text-secondary); margin-bottom: 6px;">ИСХОДНЫЙ ТЕКСТ</div>
                        <div class="text-box original-text">${escapeHTML(item.original)}</div>
                    </div>
                    <div>
                        <div style="font-size: 12px; color: var(--m3-text-secondary); margin-bottom: 6px;">РЕЗУЛЬТАТ ИИ</div>
                        <div class="text-box result-text">${escapeHTML(item.result)}</div>
                        <button class="copy-btn" data-text="${escapeHTML(item.result)}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Копировать
                        </button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });

        // Добавляем обработчики копирования
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const text = e.target.closest('button').getAttribute('data-text');
                navigator.clipboard.writeText(text);
                const originalText = e.target.innerHTML;
                e.target.innerHTML = 'Скопировано!';
                setTimeout(() => e.target.innerHTML = originalText, 1500);
            });
        });
    });
}

function clearHistory() {
    if (confirm("Вы уверены, что хотите удалить всю историю?")) {
        chrome.storage.local.set({ aiHistory: [] }, () => {
            loadHistory();
        });
    }
}

// Защита от XSS-уязвимостей при выводе текста
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}