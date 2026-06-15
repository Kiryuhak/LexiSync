document.getElementById('btn-history').addEventListener('click', () => {
    chrome.tabs.create({ url: 'history.html' });
    window.close(); // Закрываем всплывающее окно после клика
});

document.getElementById('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});