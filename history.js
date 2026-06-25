// --- Установка темы при открытии окна ---
chrome.storage.local.get(['selectedTheme'], function(res) {
    const theme = res.selectedTheme || 'auto';
    if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
});

document.addEventListener('DOMContentLoaded', loadHistory);
document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

function getModeName(mode) {
    const modes = {
        'spellcheck': 'Исправление ошибок',
        'rephrase': 'Другими словами', // для старых записей
        'style': 'Переписывание текста',
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

        container.innerHTML = ''; 

        history.forEach(item => {
            const card = document.createElement('div');
            card.className = 'history-card';
            
            let explanationHTML = '';
            if (item.explanation && (item.mode === 'spellcheck' || item.mode === 'style')) {
                explanationHTML = `
                    <div class="explanation-box">
                        <div class="explanation-header">
                            <div class="explanation-title-wrap">
                                <svg class="explanation-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                <span class="explanation-title">Показать разбор от ИИ</span>
                            </div>
                            <svg class="explanation-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </div>
                        <div class="explanation-content">
                            <div class="explanation-text">${formatExplanation(item.explanation)}</div>
                        </div>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="card-header">
                    <span class="mode-badge">${getModeName(item.mode)}</span>
                    <span>${formatDate(item.timestamp)}</span>
                </div>
                <div class="text-blocks">
                    <div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">ИСХОДНЫЙ ТЕКСТ</div>
                        <div class="text-box original-text">${escapeHTML(item.original)}</div>
                    </div>
                    <div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">РЕЗУЛЬТАТ ИИ</div>
                        <div class="text-box result-text">${escapeHTML(item.result)}</div>
                        <button class="copy-btn" data-text="${escapeHTML(item.result)}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Копировать
                        </button>
                    </div>
                </div>
                ${explanationHTML}
            `;
            container.appendChild(card);

            // Безопасное добавление слушателей (без inline-onclick)
            const spoilerHeader = card.querySelector('.explanation-header');
            if (spoilerHeader) {
                spoilerHeader.addEventListener('click', function() {
                    this.parentElement.classList.toggle('open');
                });
            }

            const copyBtn = card.querySelector('.copy-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', function() {
                    const text = this.getAttribute('data-text');
                    navigator.clipboard.writeText(text);
                    const originalHTML = this.innerHTML;
                    this.innerHTML = 'Скопировано!';
                    setTimeout(() => this.innerHTML = originalHTML, 1500);
                });
            }
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

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    if (typeof str === 'object') {
        str = str.clean || str.html || JSON.stringify(str);
    }
    return String(str).replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

function formatExplanation(text) {
    if (!text) return '';
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            let html = '';
            if (parsed['общее_замечание']) {
                html += `<strong>${escapeHTML(parsed['общее_замечание'])}</strong><br><br>`;
            }
            if (Array.isArray(parsed['ошибки'])) {
                parsed['ошибки'].forEach(err => {
                    const word = escapeHTML(err['слово'] || '');
                    const fix = escapeHTML(err['исправление'] || '');
                    const expl = escapeHTML(err['объяснение'] || '');
                    html += `<div style="margin-bottom: 8px;">• <del style="color: #D93025;">${word}</del> ➔ <strong style="color: #166534;">${fix}</strong>: ${expl}</div>`;
                });
            }
            if (html) return html;
        }
    } catch (e) {}

    return escapeHTML(String(text)).replace(/\n/g, '<br>');
}