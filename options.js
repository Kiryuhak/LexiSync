document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);

function saveOptions() {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    chrome.storage.local.set({ mistralApiKey: apiKey }, () => {
        const status = document.getElementById('status');
        status.style.opacity = 1;
        
        setTimeout(() => { 
            status.style.opacity = 0; 
        }, 2000);
    });
}

function restoreOptions() {
    // Подгружаем сохраненный ключ
    chrome.storage.local.get(['mistralApiKey'], (result) => {
        if (result.mistralApiKey) {
            document.getElementById('apiKey').value = result.mistralApiKey;
        }
    });

    // --- АВТОМАТИЧЕСКАЯ ПОДГРУЗКА ВЕРСИИ ИЗ MANIFEST.JSON ---
    const manifestData = chrome.runtime.getManifest();
    document.getElementById('app-version').textContent = 'v' + manifestData.version;
}