export const POPUP_STYLE_TEXT = `
            #lexisync-extension-ui {
                --bg-primary: rgba(248, 250, 255, 0.78); --bg-solid: #f8faff; --bg-elevated: rgba(248, 250, 255, 0.96); --bg-secondary: rgba(255, 255, 255, 0.72);
                --text-primary: #1c2438; --text-secondary: #69738d; --primary: #6d5ce7; --primary-strong: #5947d2;
                --primary-soft: rgba(109, 92, 231, 0.12); --cyan-soft: rgba(31, 174, 190, 0.12);
                --border-color: rgba(255,255,255,0.74); --inner-border: rgba(83, 91, 126, 0.12);
                --hover-bg: rgba(255,255,255,0.9); --shadow-color: rgba(41, 43, 77, 0.18);
                transition: opacity 0.15s ease; border-radius: 18px;
                border: 1px solid var(--border-color);
                animation: lexiSyncFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                box-shadow: 0 20px 52px var(--shadow-color), 0 3px 10px rgba(38, 40, 72, 0.08), inset 0 1px 0 rgba(255,255,255,0.42);
                backdrop-filter: blur(22px) saturate(155%);
                -webkit-backdrop-filter: blur(22px) saturate(155%);
            }
            #lexisync-extension-ui[data-theme="dark"] {
                --bg-primary: rgba(27, 30, 49, 0.82); --bg-solid: #1b1e31; --bg-elevated: rgba(27, 30, 49, 0.96); --bg-secondary: rgba(49, 54, 82, 0.72);
                --text-primary: #f5f6fc; --text-secondary: #abb4ce; --primary: #b7a8ff; --primary-strong: #9c89ff;
                --primary-soft: rgba(183, 168, 255, 0.15); --cyan-soft: rgba(102, 215, 228, 0.14);
                --border-color: rgba(255,255,255,0.14); --inner-border: rgba(255,255,255,0.08);
                --hover-bg: rgba(64, 70, 104, 0.9); --shadow-color: rgba(0,0,0,0.48);
            }
            #lexisync-extension-ui[data-ui-style="material-3"] {
                --bg-primary: #ffffff; --bg-solid: #ffffff; --bg-elevated: #f7f8fa; --bg-secondary: #f1f3f6;
                --text-primary: #1d1b20; --text-secondary: #49454f; --primary: #6750a4; --primary-strong: #4f378b;
                --primary-soft: #eee9ff; --cyan-soft: #e8f3f5; --border-color: #c8cdd4; --inner-border: #d9dde3;
                --hover-bg: #e9edf2; --shadow-color: rgba(29, 35, 43, 0.18);
                border-radius: 28px;
                box-shadow: 0 3px 8px var(--shadow-color), 0 1px 3px rgba(29,25,43,.14);
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }
            #lexisync-extension-ui[data-ui-style="material-3"][data-theme="dark"] {
                --bg-primary: #1d2024; --bg-solid: #1d2024; --bg-elevated: #272b30; --bg-secondary: #272b30;
                --text-primary: #f2f4f7; --text-secondary: #c5cad1; --primary: #c7b8ff; --primary-strong: #ad99ff;
                --primary-soft: #493b78; --cyan-soft: #29454b; --border-color: #454b54; --inner-border: #3b4149;
                --hover-bg: #31363c; --shadow-color: rgba(0,0,0,.48);
            }
            #lexisync-extension-ui[data-ui-style="flutter"] {
                --bg-primary: #ffffff; --bg-solid: #ffffff; --bg-elevated: #ffffff; --bg-secondary: #f1f6fb;
                --text-primary: #17212b; --text-secondary: #607080; --primary: #1976d2; --primary-strong: #0d5ca8;
                --primary-soft: #e3f2fd; --cyan-soft: #e0f7fa; --border-color: #d7e0e8; --inner-border: #dfe7ee;
                --hover-bg: #eaf3fb; --shadow-color: rgba(32,73,105,.2);
                border-radius: 14px;
                box-shadow: 0 8px 22px var(--shadow-color), 0 2px 5px rgba(32,73,105,.12);
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }
            #lexisync-extension-ui[data-ui-style="flutter"][data-theme="dark"] {
                --bg-primary: #20252b; --bg-solid: #20252b; --bg-elevated: #272d34; --bg-secondary: #2b333b;
                --text-primary: #f3f6f9; --text-secondary: #aebbc7; --primary: #64b5f6; --primary-strong: #42a5f5;
                --primary-soft: #163b58; --cyan-soft: #16444a; --border-color: #43505c; --inner-border: #3b4650;
                --hover-bg: #35414c; --shadow-color: rgba(0,0,0,.44);
            }
            #lexisync-extension-ui[data-ui-style="bento"] {
                --bg-primary: #ffffff; --bg-solid: #ffffff; --bg-elevated: #ffffff; --bg-secondary: #f5f7fa;
                --text-primary: #20242c; --text-secondary: #667085; --primary: #6d5ce7; --primary-strong: #5746cf;
                --primary-soft: #ecebff; --cyan-soft: #e7f7f5; --border-color: #2d3648; --inner-border: rgba(45,54,72,.16);
                --hover-bg: #edf2f7; --shadow-color: rgba(45,54,72,.16);
                border: 2px solid var(--border-color);
                border-radius: 22px;
                box-shadow: 7px 7px 0 var(--shadow-color);
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }
            #lexisync-extension-ui[data-ui-style="bento"][data-theme="dark"] {
                --bg-primary: #20242b; --bg-solid: #20242b; --bg-elevated: #282d35; --bg-secondary: #303640;
                --text-primary: #f7f9fc; --text-secondary: #c4cbd6; --primary: #b7abff; --primary-strong: #9d8fff;
                --primary-soft: #413a70; --cyan-soft: #294b4c; --border-color: #d7dde8; --inner-border: rgba(215,221,232,.18);
                --hover-bg: #39414c; --shadow-color: rgba(0,0,0,.46);
            }
            #lexisync-extension-ui span { flex-shrink: 0 !important; }
            #lexisync-extension-ui svg { width: 16px !important; height: 16px !important; min-width: 16px !important; min-height: 16px !important; max-width: 16px !important; max-height: 16px !important; flex-shrink: 0 !important; display: block !important; }
            @keyframes lexisync-spin { to { transform: rotate(360deg); } }
            @keyframes lexisync-flip { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(180deg); } }
            @keyframes lexiSyncFadeIn { 0% { opacity: 0; transform: translateY(12px) scale(0.98); } 100% { opacity: 1; transform: translateY(0) scale(1); }}
            .lexisync-loader { width: 14px; height: 14px; border: 2.5px solid var(--text-secondary); border-top-color: transparent; border-radius: 50%; animation: lexisync-spin 0.8s linear infinite; }
            .lexisync-hourglass { animation: lexisync-flip 2s ease-in-out infinite; display: flex; align-items: center; justify-content: center; }
            #lexisync-extension-ui mark { background: #dcfce7; color: #166534; padding: 2px 4px; border-radius: 4px; font-weight: 500; }
            #lexisync-extension-ui[data-theme="dark"] mark { background: #0f5223; color: #c4eed0; }
            /* Общие стили для обеих кнопок */
            .lexisync-btn-action, .lexisync-translate-btn {
                background: var(--bg-secondary) !important;
                border: none !important;
                border-radius: 8px !important;
                padding: 0 16px !important;
                height: 38px !important; /* Строгая высота */
                font-size: 13px !important;
                cursor: pointer !important;
                color: var(--text-primary) !important;
                display: flex !important;
                flex-direction: row !important; /* Выстраиваем в линию */
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                font-family: inherit !important;
                font-weight: 500 !important;
                box-sizing: border-box !important;
                white-space: nowrap !important; /* ЗАПРЕЩАЕМ ПЕРЕНОС ТЕКСТА */
                flex-shrink: 0 !important; /* Запрещаем сжатие кнопки */
                transition: all 0.2s cubic-bezier(0.2, 0, 0, 1) !important;
            }

            .lexisync-btn-action:hover, .lexisync-translate-btn:hover {
                background: var(--hover-bg) !important;
            }

            .lexisync-btn-action:active, .lexisync-translate-btn:active {
                transform: translateY(1px) scale(0.98) !important;
            }

            /* Стили только для квадратной кнопки копирования */
            .lexisync-translate-btn.icon-only, .lexisync-btn-action.icon-only {
                padding: 0 !important;
                width: 38px !important;
                min-width: 38px !important;
            }

            /* Иконки внутри кнопок */
            .lexisync-btn-action svg, .lexisync-translate-btn svg {
                width: 16px !important;
                height: 16px !important;
                min-width: 16px !important;
                flex-shrink: 0 !important;
                display: block !important;
                margin: 0 !important;
            }
            .lexisync-scroll::-webkit-scrollbar { width: 6px; }
            .lexisync-scroll::-webkit-scrollbar-track { background: transparent; }
            .lexisync-scroll::-webkit-scrollbar-thumb { background: var(--text-secondary); border-radius: 4px; }

            #lexisync-extension-ui[data-surface="toolbar"] {
                border-radius: 14px;
                background: var(--bg-primary) !important;
            }
            .lexisync-toolbar-button {
                min-height: 32px !important;
                border-radius: 9px !important;
                font-family: system-ui, -apple-system, sans-serif !important;
            }
            .lexisync-toolbar-button:hover,
            .lexisync-menu-button:hover,
            .lexisync-dropdown-item:hover {
                background: var(--hover-bg) !important;
                box-shadow: inset 0 0 0 1px var(--inner-border);
            }
            .lexisync-toolbar-button:focus-visible,
            .lexisync-menu-button:focus-visible,
            .lexisync-result-button:focus-visible {
                outline: 3px solid color-mix(in srgb, var(--primary) 30%, transparent) !important;
                outline-offset: 1px !important;
            }
            .lexisync-toolbar-divider {
                background: var(--inner-border) !important;
            }
            .lexisync-dropdown {
                background: var(--bg-elevated) !important;
                border-color: var(--border-color) !important;
                box-shadow: 0 18px 42px rgba(37, 39, 68, 0.22), inset 0 1px 0 rgba(255,255,255,.4) !important;
                backdrop-filter: blur(32px) saturate(125%);
                -webkit-backdrop-filter: blur(32px) saturate(125%);
            }

            #lexisync-extension-ui[data-surface="menu"] {
                background: var(--bg-primary) !important;
                border-radius: 18px;
            }
            .lexisync-menu-label {
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 7px 10px 8px;
                color: var(--text-secondary);
                font: 650 10px/1 system-ui, sans-serif;
                letter-spacing: .08em;
                text-transform: uppercase;
                user-select: none;
            }
            .lexisync-menu-label::before {
                width: 7px;
                height: 7px;
                content: "";
                background: linear-gradient(135deg, var(--primary), #43c9d4);
                border-radius: 50%;
                box-shadow: 0 0 0 4px var(--primary-soft);
            }
            .lexisync-menu-button {
                min-height: 43px !important;
                margin-top: 3px !important;
                padding: 7px 10px !important;
                border: 1px solid transparent !important;
                border-radius: 12px !important;
                font-family: system-ui, -apple-system, sans-serif !important;
                text-align: left !important;
            }
            .lexisync-menu-icon {
                width: 30px !important;
                height: 30px !important;
                margin-right: 10px !important;
                color: var(--primary) !important;
                background: var(--primary-soft);
                border-radius: 9px;
            }
            .lexisync-menu-button:nth-of-type(3) .lexisync-menu-icon { color: #19a5b6 !important; background: var(--cyan-soft); }
            .lexisync-shortcut {
                padding: 4px 6px;
                color: var(--text-secondary) !important;
                background: var(--bg-secondary);
                border: 1px solid var(--inner-border);
                border-radius: 6px;
                box-shadow: inset 0 -1px 0 var(--inner-border);
                font: 600 10px/1 ui-monospace, Consolas, monospace !important;
            }

            #lexisync-extension-ui[data-surface="result"] {
                overflow: visible;
                background: var(--bg-primary) !important;
                border-radius: 20px;
            }
            #lexisync-extension-ui[data-ui-style="material-3"][data-surface="result"],
            #lexisync-extension-ui[data-ui-style="material-3"][data-surface="menu"] { border-radius: 28px; }
            #lexisync-extension-ui[data-ui-style="flutter"][data-surface="result"],
            #lexisync-extension-ui[data-ui-style="flutter"][data-surface="menu"] { border-radius: 14px; }
            #lexisync-extension-ui[data-ui-style="bento"][data-surface="result"],
            #lexisync-extension-ui[data-ui-style="bento"][data-surface="menu"] { border-radius: 22px; }
            .lexisync-header {
                min-height: 50px;
                padding: 11px 14px !important;
                background: linear-gradient(135deg, var(--primary-soft), transparent 62%) !important;
                border-bottom-color: var(--inner-border) !important;
                border-radius: 20px 20px 0 0 !important;
            }
            #lexisync-extension-ui[data-ui-style="material-3"] .lexisync-header {
                background: var(--primary-soft) !important;
                border-radius: 27px 27px 0 0 !important;
            }
            #lexisync-extension-ui[data-ui-style="flutter"] .lexisync-header {
                background: var(--bg-secondary) !important;
                border-radius: 13px 13px 0 0 !important;
            }
            #lexisync-extension-ui[data-ui-style="bento"] .lexisync-header {
                background: linear-gradient(135deg, var(--primary-soft), var(--cyan-soft)) !important;
                border-radius: 20px 20px 0 0 !important;
            }
            .lexisync-header-title {
                color: var(--text-primary);
                letter-spacing: -0.01em;
            }
            .lexisync-content-pane {
                padding: 17px 18px !important;
                line-height: 1.65 !important;
            }
            .lexisync-actions {
                padding: 4px 14px 14px !important;
                border-radius: 0 0 20px 20px;
            }
            .lexisync-result-tools {
                display: none;
                flex-wrap: wrap;
                gap: 5px;
                padding: 0 14px 10px;
            }
            .lexisync-tool-chip {
                padding: 6px 8px;
                color: var(--text-secondary);
                background: var(--bg-secondary);
                border: 1px solid var(--inner-border);
                border-radius: 8px;
                cursor: pointer;
                font: 600 10px/1 system-ui, sans-serif;
            }
            .lexisync-tool-chip:hover { color: var(--primary); background: var(--hover-bg); }
            .lexisync-content-pane[contenteditable="true"] {
                margin: 7px 10px 12px;
                padding: 12px !important;
                background: var(--bg-secondary);
                border: 1px solid transparent;
                border-radius: 11px;
                outline: none;
            }
            .lexisync-content-pane[contenteditable="true"]:focus {
                border-color: var(--primary);
                box-shadow: 0 0 0 3px var(--primary-soft);
            }
            .lexisync-corrections { padding: 0 14px 12px !important; }
            .lexisync-compact-correction-details {
                position: relative;
                display: flex;
                align-items: center;
                gap: 8px;
                margin: -3px 12px 10px;
                padding: 8px 34px 8px 10px;
                color: var(--text-primary);
                background: var(--bg-secondary);
                border: 1px solid var(--inner-border);
                border-radius: 10px;
                font: 600 11px/1.35 system-ui, sans-serif;
            }
            .lexisync-compact-correction-details[hidden] { display: none !important; }
            .lexisync-compact-correction-copy {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                flex: 1 1 auto !important;
            }
            .lexisync-compact-correction-close {
                position: absolute;
                top: 50%;
                right: 8px;
                width: 22px;
                height: 22px;
                padding: 0;
                border: 0;
                border-radius: 6px;
                transform: translateY(-50%);
                color: var(--text-secondary);
                background: transparent;
                cursor: pointer;
            }
            .lexisync-action-status {
                margin: -7px 14px 12px;
                color: #166534;
                font: 600 11px/1.35 system-ui, sans-serif;
            }
            .lexisync-action-status[data-error="true"] { color: #b42318; }
            .lexisync-action-status[hidden] { display: none !important; }
            #lexisync-extension-ui mark[role="button"] { cursor: pointer; }
            #lexisync-extension-ui mark[role="button"]:focus-visible {
                outline: 3px solid color-mix(in srgb, var(--primary) 35%, transparent);
                outline-offset: 2px;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-corrections,
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-result-tools {
                display: none !important;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-content-pane {
                margin: 10px 12px !important;
                padding: 12px !important;
                background: var(--bg-secondary) !important;
                border: 1px solid var(--inner-border) !important;
                border-radius: 11px !important;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-actions {
                padding: 0 14px 14px !important;
            }
            .lexisync-correction-row {
                background: var(--bg-secondary);
                border-color: var(--inner-border) !important;
                border-radius: 10px !important;
            }
            .lexisync-result-button {
                border: 1px solid var(--inner-border) !important;
                border-radius: 11px !important;
                background: var(--bg-secondary) !important;
                box-shadow: 0 4px 12px rgba(38, 40, 72, 0.06);
            }
            .lexisync-result-button--primary {
                color: #fff !important;
                background: linear-gradient(135deg, var(--primary), var(--primary-strong)) !important;
                border-color: transparent !important;
                box-shadow: 0 8px 18px color-mix(in srgb, var(--primary) 25%, transparent) !important;
            }
            #lexisync-extension-ui[data-ui-style="material-3"] .lexisync-result-button {
                border-radius: 999px !important;
                box-shadow: none;
            }
            #lexisync-extension-ui[data-ui-style="flutter"] .lexisync-result-button,
            #lexisync-extension-ui[data-ui-style="flutter"] .lexisync-correction-row {
                border-radius: 8px !important;
            }
            #lexisync-extension-ui[data-ui-style="flutter"] .lexisync-result-button--primary {
                background: var(--primary) !important;
                box-shadow: 0 4px 10px color-mix(in srgb, var(--primary) 28%, transparent) !important;
            }
            #lexisync-extension-ui[data-ui-style="bento"] .lexisync-result-button {
                border: 2px solid var(--border-color) !important;
                border-radius: 12px !important;
                box-shadow: 3px 3px 0 var(--shadow-color);
            }
            #lexisync-extension-ui[data-ui-style="bento"] .lexisync-result-button--primary {
                border-color: var(--border-color) !important;
                background: var(--primary) !important;
            }
            .lexisync-result-button--primary:hover {
                filter: brightness(1.06);
                transform: translateY(-1px);
            }
            .lexisync-result-button--success {
                color: #166534 !important;
                background: #dcfce7 !important;
                border-color: rgba(22, 101, 52, .14) !important;
                box-shadow: 0 7px 16px rgba(22, 101, 52, .12) !important;
            }
            #lexisync-extension-ui[data-theme="dark"] .lexisync-result-button--success {
                color: #b9f6ce !important;
                background: #173f2b !important;
            }
            .lexisync-close-button:hover,
            .lexisync-cancel-button:hover { background: var(--hover-bg) !important; }

            .lexisync-skeleton {
                display: grid;
                gap: 9px;
                padding: 4px 0;
            }
            .lexisync-skeleton-line {
                height: 9px;
                overflow: hidden;
                background: var(--primary-soft);
                border-radius: 999px;
            }
            .lexisync-skeleton-line::after {
                display: block;
                width: 46%;
                height: 100%;
                content: "";
                background: linear-gradient(90deg, transparent, rgba(255,255,255,.62), transparent);
                animation: lexisync-shimmer 1.2s ease-in-out infinite;
            }
            .lexisync-skeleton-line:nth-child(2) { width: 88%; }
            .lexisync-skeleton-line:nth-child(3) { width: 64%; }
            @keyframes lexisync-shimmer { from { transform: translateX(-110%); } to { transform: translateX(240%); } }

            @media (prefers-reduced-motion: reduce) {
                #lexisync-extension-ui { animation-duration: 0.01ms; }
                .lexisync-loader, .lexisync-hourglass, .lexisync-skeleton-line::after { animation: none; }
                .lexisync-btn-action, .lexisync-translate-btn { transition: none !important; }
            }
`;
