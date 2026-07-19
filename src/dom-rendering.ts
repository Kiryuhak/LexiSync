const FORBIDDEN_SVG_ELEMENTS = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed']);

export function createSvgIcon(markup: string): SVGElement {
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.localName !== 'svg' || root.querySelector('parsererror')) {
        const fallback = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fallback.setAttribute('viewBox', '0 0 24 24');
        return fallback;
    }
    for (const element of [root, ...root.querySelectorAll('*')]) {
        if (FORBIDDEN_SVG_ELEMENTS.has(element.localName)) element.remove();
        for (const attribute of [...element.attributes]) {
            if (attribute.name.toLowerCase().startsWith('on') || /^(?:href|xlink:href)$/i.test(attribute.name)) {
                element.removeAttribute(attribute.name);
            }
        }
    }
    return document.importNode(root, true) as unknown as SVGElement;
}

export function setIcon(element: Element, markup: string): void {
    element.replaceChildren(createSvgIcon(markup));
}

export function appendIconAndText(element: Element, markup: string, text: string): void {
    element.replaceChildren(createSvgIcon(markup), document.createTextNode(` ${text}`));
}

function appendInlineMarkup(parent: Node, value: string): void {
    const pattern = /\*\*([\s\S]*?)(?:\*\*|$)/g;
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > cursor) parent.appendChild(document.createTextNode(value.slice(cursor, index).replace(/\*/g, '')));
        const mark = document.createElement('mark');
        mark.textContent = match[1].replace(/\*/g, '');
        parent.appendChild(mark);
        cursor = index + match[0].length;
    }
    if (cursor < value.length) parent.appendChild(document.createTextNode(value.slice(cursor).replace(/\*/g, '')));
}

export function createMarkdownFragment(text: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const lines = text.split('\n');
    let list: HTMLUListElement | null = null;
    lines.forEach((line, index) => {
        const listMatch = line.match(/^(?:- |\d+\.\s)(.*)$/);
        if (listMatch) {
            if (!list) {
                list = document.createElement('ul');
                list.style.cssText = 'margin:8px 0;padding-left:20px;';
                fragment.appendChild(list);
            }
            const item = document.createElement('li');
            appendInlineMarkup(item, listMatch[1]);
            list.appendChild(item);
            return;
        }
        list = null;
        appendInlineMarkup(fragment, line);
        if (index < lines.length - 1) fragment.appendChild(document.createElement('br'));
    });
    return fragment;
}

export function renderMarkdown(element: Element, text: string): void {
    element.replaceChildren(createMarkdownFragment(text));
}
