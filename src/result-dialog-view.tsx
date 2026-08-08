import { createRef, render, type ComponentChildren, type RefObject } from 'preact';

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

interface ResultDialogElementRefs {
    header: RefObject<HTMLDivElement>;
    headerTitle: RefObject<HTMLDivElement>;
    headerControl: RefObject<HTMLDivElement>;
    content: RefObject<HTMLDivElement>;
    compactDetails: RefObject<HTMLDivElement>;
    corrections: RefObject<HTMLDivElement>;
    tools: RefObject<HTMLDivElement>;
    actions: RefObject<HTMLDivElement>;
    status: RefObject<HTMLDivElement>;
}

interface ResultDialogFrameProps {
    refs?: ResultDialogElementRefs;
    title?: ComponentChildren;
    headerControl?: ComponentChildren;
    content?: ComponentChildren;
    tools?: ComponentChildren;
    actions?: ComponentChildren;
    showTools?: boolean;
}

function ResultDialogFrame(props: ResultDialogFrameProps) {
    return (
        <>
            <div class="lexisync-header" ref={props.refs?.header}>
                <div class="lexisync-header-title" ref={props.refs?.headerTitle}>
                    {props.title}
                </div>
                <div class="lexisync-header-control" ref={props.refs?.headerControl}>
                    {props.headerControl}
                </div>
            </div>
            <div class="lexisync-scroll lexisync-content-pane" ref={props.refs?.content}>
                {props.content}
            </div>
            <div class="lexisync-compact-correction-details" ref={props.refs?.compactDetails} hidden />
            <div class="lexisync-corrections" ref={props.refs?.corrections} />
            <div
                class="lexisync-result-tools"
                ref={props.refs?.tools}
                style={props.showTools ? { display: 'flex' } : undefined}
            >
                {props.tools}
            </div>
            <div class="lexisync-actions" ref={props.refs?.actions}>
                {props.actions}
            </div>
            <div
                class="lexisync-action-status"
                ref={props.refs?.status}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                hidden
            />
        </>
    );
}

function requireElement<T extends HTMLElement>(ref: RefObject<T>, name: string): T {
    if (!ref.current) throw new Error(`Preact не создал элемент модального окна: ${name}`);
    return ref.current;
}

export function mountResultDialogFrame(container: HTMLElement): ResultDialogElements {
    // The result panel reuses the selection-menu container. Preact keeps DOM nodes
    // that it did not create, so remove the previous menu before the first render.
    container.replaceChildren();
    const refs: ResultDialogElementRefs = {
        header: createRef<HTMLDivElement>(),
        headerTitle: createRef<HTMLDivElement>(),
        headerControl: createRef<HTMLDivElement>(),
        content: createRef<HTMLDivElement>(),
        compactDetails: createRef<HTMLDivElement>(),
        corrections: createRef<HTMLDivElement>(),
        tools: createRef<HTMLDivElement>(),
        actions: createRef<HTMLDivElement>(),
        status: createRef<HTMLDivElement>(),
    };
    render(<ResultDialogFrame refs={refs} />, container);
    return {
        header: requireElement(refs.header, 'header'),
        headerTitle: requireElement(refs.headerTitle, 'headerTitle'),
        headerControl: requireElement(refs.headerControl, 'headerControl'),
        content: requireElement(refs.content, 'content'),
        compactDetails: requireElement(refs.compactDetails, 'compactDetails'),
        corrections: requireElement(refs.corrections, 'corrections'),
        tools: requireElement(refs.tools, 'tools'),
        actions: requireElement(refs.actions, 'actions'),
        status: requireElement(refs.status, 'status'),
    };
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

function ReplaceIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path d="M9 10 4 15l5 5" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
        </svg>
    );
}

function CopyIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

export function renderCompactResultPreview(
    container: HTMLElement,
    copy: CompactResultPreviewCopy,
    detailed: boolean,
): void {
    render(
        <ResultDialogFrame
            title={<strong>{copy.title}</strong>}
            headerControl={<span class="lexisync-close-button lexisync-preview-close">×</span>}
            content={
                <>
                    <span>{copy.before}</span>
                    <mark>{copy.correction}</mark>
                    <span>{copy.after}</span>
                </>
            }
            showTools={detailed}
            tools={
                <>
                    <span class="lexisync-tool-chip">{copy.beforeAfter}</span>
                    <span class="lexisync-tool-chip">{copy.repeat}</span>
                    <span class="lexisync-tool-chip">{copy.shorter}</span>
                </>
            }
            actions={
                <>
                    <span class="lexisync-btn-action lexisync-result-button lexisync-result-button--primary">
                        <ReplaceIcon />
                        {copy.replace}
                    </span>
                    <span class="lexisync-btn-action lexisync-result-button icon-only">
                        <CopyIcon />
                    </span>
                </>
            }
        />,
        container,
    );
}
