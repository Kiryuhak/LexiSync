export interface ResultDialogElements {
    header: HTMLDivElement;
    headerTitle: HTMLDivElement;
    headerControl: HTMLDivElement;
    content: HTMLDivElement;
    compactDetails: HTMLDivElement;
    corrections: HTMLDivElement;
    tools: HTMLDivElement;
    actions: HTMLDivElement;
    status: HTMLDivElement;
}

export function mountResultDialogFrame(container: HTMLElement): ResultDialogElements {
    container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'lexisync-header';
    const headerTitle = document.createElement('div');
    headerTitle.className = 'lexisync-header-title';
    const headerControl = document.createElement('div');
    headerControl.className = 'lexisync-header-control';
    header.append(headerTitle, headerControl);

    const content = document.createElement('div');
    content.className = 'lexisync-scroll lexisync-content-pane';

    const compactDetails = document.createElement('div');
    compactDetails.className = 'lexisync-compact-correction-details';
    compactDetails.hidden = true;

    const corrections = document.createElement('div');
    corrections.className = 'lexisync-corrections';

    const tools = document.createElement('div');
    tools.className = 'lexisync-result-tools';

    const actions = document.createElement('div');
    actions.className = 'lexisync-actions';

    const status = document.createElement('div');
    status.className = 'lexisync-action-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.hidden = true;

    container.append(header, content, compactDetails, corrections, tools, actions, status);

    return {
        header,
        headerTitle,
        headerControl,
        content,
        compactDetails,
        corrections,
        tools,
        actions,
        status,
    };
}

export function unmountResultDialogFrame(container: HTMLElement): void {
    container.replaceChildren();
}

export interface CompactResultPreviewCopy {
    title: string;
    before: string;
    correction: string;
    after: string;
    replace: string;
    beforeAfter: string;
    repeat: string;
    shorter: string;
}

function createReplaceIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('aria-hidden', 'true');
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M9 10 4 15l5 5');
    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M20 4v7a4 4 0 0 1-4 4H4');
    svg.append(path1, path2);
    return svg;
}

function createCopyIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '9');
    rect.setAttribute('y', '9');
    rect.setAttribute('width', '13');
    rect.setAttribute('height', '13');
    rect.setAttribute('rx', '2');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');
    svg.append(rect, path);
    return svg;
}

export function renderCompactResultPreview(
    container: HTMLElement,
    copy: CompactResultPreviewCopy,
    detailed: boolean,
): void {
    const elements = mountResultDialogFrame(container);

    const strong = document.createElement('strong');
    strong.textContent = copy.title;
    elements.headerTitle.append(strong);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'lexisync-close-button lexisync-preview-close';
    closeBtn.textContent = '×';
    elements.headerControl.append(closeBtn);

    const spanBefore = document.createElement('span');
    spanBefore.textContent = copy.before;
    const mark = document.createElement('mark');
    mark.textContent = copy.correction;
    const spanAfter = document.createElement('span');
    spanAfter.textContent = copy.after;
    elements.content.append(spanBefore, mark, spanAfter);

    if (detailed) {
        elements.tools.style.display = 'flex';
        const chip1 = document.createElement('span');
        chip1.className = 'lexisync-tool-chip';
        chip1.textContent = copy.beforeAfter;
        const chip2 = document.createElement('span');
        chip2.className = 'lexisync-tool-chip';
        chip2.textContent = copy.repeat;
        const chip3 = document.createElement('span');
        chip3.className = 'lexisync-tool-chip';
        chip3.textContent = copy.shorter;
        elements.tools.append(chip1, chip2, chip3);
    }

    const replaceBtn = document.createElement('span');
    replaceBtn.className = 'lexisync-btn-action lexisync-result-button lexisync-result-button--primary';
    replaceBtn.append(createReplaceIcon(), document.createTextNode(' ' + copy.replace));

    const copyBtn = document.createElement('span');
    copyBtn.className = 'lexisync-btn-action lexisync-result-button icon-only';
    copyBtn.append(createCopyIcon());

    elements.actions.append(replaceBtn, copyBtn);
}
