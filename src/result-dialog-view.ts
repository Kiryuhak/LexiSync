export interface ResultDialogElements {
    header: HTMLDivElement;
    headerTitle: HTMLDivElement;
    headerControl: HTMLDivElement;
    content: HTMLDivElement;
    compactDetails: HTMLDivElement;
    corrections: HTMLDivElement;
    tools: HTMLDivElement;
    stats: HTMLDivElement;
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

    const stats = document.createElement('div');
    stats.className = 'lexisync-text-stats';
    stats.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'lexisync-actions';

    const status = document.createElement('div');
    status.className = 'lexisync-action-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.hidden = true;

    container.append(header, content, compactDetails, corrections, tools, stats, actions, status);

    return {
        header,
        headerTitle,
        headerControl,
        content,
        compactDetails,
        corrections,
        tools,
        stats,
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
    tabImprove?: string;
    tabRephrase?: string;
    tabShorten?: string;
    dismiss?: string;
}

export function createExpandIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const poly1 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly1.setAttribute('points', '15 3 21 3 21 9');
    const poly2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly2.setAttribute('points', '9 21 3 21 3 15');
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '21');
    line1.setAttribute('y1', '3');
    line1.setAttribute('x2', '14');
    line1.setAttribute('y2', '10');
    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '3');
    line2.setAttribute('y1', '21');
    line2.setAttribute('x2', '10');
    line2.setAttribute('y2', '14');
    svg.append(poly1, poly2, line1, line2);
    return svg;
}

function createCheckIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 6 9 17l-5-5');
    svg.append(path);
    return svg;
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

    if (!detailed) {
        // Grammarly-style Quick Card Preview
        const expandBtn = document.createElement('span');
        expandBtn.className = 'lexisync-expand-btn lexisync-preview-expand';
        expandBtn.append(createExpandIcon());
        elements.headerControl.append(expandBtn, closeBtn);

        const tabs = document.createElement('div');
        tabs.className = 'lexisync-quick-tabs';
        const tab1 = document.createElement('span');
        tab1.className = 'lexisync-quick-tab lexisync-quick-tab--active';
        tab1.textContent = copy.tabImprove || 'Улучшить';
        const tab2 = document.createElement('span');
        tab2.className = 'lexisync-quick-tab';
        tab2.textContent = copy.tabRephrase || 'Перефразировать';
        const tab3 = document.createElement('span');
        tab3.className = 'lexisync-quick-tab';
        tab3.textContent = copy.tabShorten || copy.shorter || 'Сократить';
        tabs.append(tab1, tab2, tab3);
        elements.header.insertAdjacentElement('afterend', tabs);

        const spanBefore = document.createTextNode(copy.before);
        const del = document.createElement('del');
        del.className = 'lexisync-diff-del';
        del.textContent = 'с ошибкой';
        const ins = document.createElement('ins');
        ins.className = 'lexisync-diff-ins';
        ins.textContent = copy.correction;
        const spanAfter = document.createTextNode(copy.after);
        elements.content.append(spanBefore, del, ins, spanAfter);

        const acceptBtn = document.createElement('span');
        acceptBtn.className = 'lexisync-result-button lexisync-result-button--accept';
        acceptBtn.append(createCheckIcon(), document.createTextNode(' ' + copy.replace));

        const dismissBtn = document.createElement('span');
        dismissBtn.className = 'lexisync-result-button lexisync-result-button--dismiss';
        dismissBtn.textContent = copy.dismiss || 'Отклонить';

        elements.actions.append(acceptBtn, dismissBtn);
    } else {
        // Detailed layout Preview
        elements.headerControl.append(closeBtn);

        const spanBefore = document.createElement('span');
        spanBefore.textContent = copy.before;
        const mark = document.createElement('mark');
        mark.textContent = copy.correction;
        const spanAfter = document.createElement('span');
        spanAfter.textContent = copy.after;
        elements.content.append(spanBefore, mark, spanAfter);

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

        const replaceBtn = document.createElement('span');
        replaceBtn.className = 'lexisync-btn-action lexisync-result-button lexisync-result-button--primary';
        replaceBtn.append(createReplaceIcon(), document.createTextNode(' ' + copy.replace));

        const copyBtn = document.createElement('span');
        copyBtn.className = 'lexisync-btn-action lexisync-result-button icon-only';
        copyBtn.append(createCopyIcon());

        elements.actions.append(replaceBtn, copyBtn);
    }
}
