export function escapeHTML(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function parseMarkdownToHTML(text: string): string {
    let html = escapeHTML(text);
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<mark>$1</mark>');
    if (html.includes('**')) html = html.replace(/\*\*([^*]*)$/, '<mark>$1</mark>');
    html = html.replace(/\*/g, '');
    html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\.\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>(\n<li>.*<\/li>)*)/g, '<ul style="margin: 8px 0; padding-left: 20px;">$1</ul>');
    return html.replace(/\n/g, '<br>');
}
