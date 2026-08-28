const FORBIDDEN_SVG_ELEMENTS = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed']);
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const svgTemplateCache = new Map<string, SVGElement>();
const MAX_CACHED_TEMPLATES = 100;

export function createSvgIcon(markup: string): SVGElement {
    const cached = svgTemplateCache.get(markup);
    if (cached) {
        return cached.cloneNode(true) as SVGElement;
    }

    const namespacedMarkup = markup.replace(/<svg\b(?![^>]*\bxmlns=)/i, `<svg xmlns="${SVG_NAMESPACE}"`);
    const parsed = new DOMParser().parseFromString(namespacedMarkup, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.localName !== 'svg' || root.querySelector('parsererror')) {
        const fallback = document.createElementNS(SVG_NAMESPACE, 'svg');
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
    const imported = document.importNode(root, true) as unknown as SVGElement;
    if (typeof imported?.cloneNode === 'function') {
        if (svgTemplateCache.size >= MAX_CACHED_TEMPLATES) {
            const firstKey = svgTemplateCache.keys().next().value;
            if (firstKey) svgTemplateCache.delete(firstKey);
        }
        svgTemplateCache.set(markup, imported);
        return imported.cloneNode(true) as SVGElement;
    }
    return imported;
}

export function setIcon(element: Element, markup: string): void {
    element.replaceChildren(createSvgIcon(markup));
}

export function appendIconAndText(element: Element, markup: string, text: string): void {
    element.replaceChildren(createSvgIcon(markup), document.createTextNode(` ${text}`));
}

function appendInlineMarkup(parent: Node, value: string): void {
    const cleanValue = value.replace(/\*{1,3}([^*]+?)\*{1,3}/g, '$1');
    parent.appendChild(document.createTextNode(cleanValue));
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
