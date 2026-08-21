export const POPUP_STYLE_TEXT = `
            #lexisync-extension-ui {
                --bg-primary: rgba(248, 250, 255, 0.94); --bg-solid: #f8faff; --bg-elevated: rgba(255, 255, 255, 0.98); --bg-secondary: rgba(240, 244, 255, 0.92);
                --text-primary: #1c2438; --text-secondary: #69738d; --primary: #6d5ce7; --primary-strong: #5947d2;
                --primary-soft: rgba(109, 92, 231, 0.12); --cyan-soft: rgba(31, 174, 190, 0.12);
                --border-color: rgba(255,255,255,0.85); --inner-border: rgba(83, 91, 126, 0.12);
                --hover-bg: rgba(255,255,255,0.95); --shadow-color: rgba(41, 43, 77, 0.22);
                --error-color: #d32f2f; --success-color: #166534; --warning-bg: #fff8f0; --warning-border: #ffe8cc; --warning-text: #b06000;
                transition: opacity 0.15s ease; border-radius: 18px;
                border: 1px solid var(--border-color);
                animation: lexiSyncFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                box-shadow: 0 20px 52px var(--shadow-color), 0 3px 10px rgba(38, 40, 72, 0.08), inset 0 1px 0 rgba(255,255,255,0.6);
                backdrop-filter: blur(28px) saturate(160%);
                -webkit-backdrop-filter: blur(28px) saturate(160%);
            }
            #lexisync-extension-ui[data-theme="dark"] {
                --bg-primary: rgba(23, 26, 42, 0.95); --bg-solid: #1b1e31; --bg-elevated: rgba(30, 34, 56, 0.98); --bg-secondary: rgba(42, 47, 74, 0.92);
                --text-primary: #f5f6fc; --text-secondary: #abb4ce; --primary: #b7a8ff; --primary-strong: #9c89ff;
                --primary-soft: rgba(183, 168, 255, 0.15); --cyan-soft: rgba(102, 215, 228, 0.14);
                --border-color: rgba(255,255,255,0.18); --inner-border: rgba(255,255,255,0.1);
                --hover-bg: rgba(64, 70, 104, 0.9); --shadow-color: rgba(0,0,0,0.55);
                --error-color: #ff8a80; --success-color: #81c784; --warning-bg: rgba(176, 96, 0, 0.2); --warning-border: rgba(255, 183, 77, 0.3); --warning-text: #ffb74d;
            }
            #lexisync-extension-ui[data-ui-style="magicos-11"] {
                --bg-primary: rgba(246,250,255,.94); --bg-solid: #f4f8ff; --bg-elevated: rgba(255,255,255,.98); --bg-secondary: rgba(235,242,255,.92);
                --text-primary: #19233b; --text-secondary: #5b6881; --primary: #4267f5; --primary-strong: #624fe5;
                --primary-soft: rgba(72,108,246,.16); --cyan-soft: rgba(49,194,219,.18);
                --border-color: rgba(255,255,255,.92); --inner-border: rgba(78,103,161,.14);
                --hover-bg: rgba(255,255,255,.9); --shadow-color: rgba(31,56,118,.26);
                --error-color: #c92f46; --success-color: #176b48; --warning-bg: rgba(255,244,220,.72); --warning-border: rgba(215,153,45,.24); --warning-text: #99600a;
                border-radius: 28px;
                box-shadow: 0 26px 68px var(--shadow-color), 0 4px 14px rgba(38,54,96,.12), inset 0 1px 0 rgba(255,255,255,.9);
                backdrop-filter: blur(36px) saturate(180%);
                -webkit-backdrop-filter: blur(36px) saturate(180%);
            }
            #lexisync-extension-ui[data-ui-style="magicos-11"][data-theme="dark"] {
                --bg-primary: rgba(22,29,48,.95); --bg-solid: #192239; --bg-elevated: rgba(36,46,74,.98); --bg-secondary: rgba(46,58,90,.92);
                --text-primary: #f6f8ff; --text-secondary: #bac5dc; --primary: #a6baff; --primary-strong: #b29cff;
                --primary-soft: rgba(145,171,255,.2); --cyan-soft: rgba(72,198,219,.18);
                --border-color: rgba(255,255,255,.22); --inner-border: rgba(255,255,255,.12);
                --hover-bg: rgba(80,96,140,.8); --shadow-color: rgba(0,0,0,.58);
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
            #lexisync-extension-ui[data-ui-style="aurora-glass"] {
                --bg-primary: rgba(247, 255, 253, .94); --bg-solid: #f4fffb; --bg-elevated: rgba(255, 255, 255, .98); --bg-secondary: rgba(233, 250, 245, .92);
                --text-primary: #183d39; --text-secondary: #58746f; --primary: #0d9d8a; --primary-strong: #087466;
                --primary-soft: rgba(41, 190, 161, .15); --cyan-soft: rgba(111, 204, 255, .17); --border-color: rgba(255, 255, 255, .9); --inner-border: rgba(42, 129, 117, .16);
                --hover-bg: rgba(255, 255, 255, .92); --shadow-color: rgba(23, 108, 98, .22);
                border-radius: 24px;
                box-shadow: 0 20px 48px var(--shadow-color), inset 0 1px 0 rgba(255, 255, 255, .85);
                backdrop-filter: blur(30px) saturate(155%);
                -webkit-backdrop-filter: blur(30px) saturate(155%);
            }
            #lexisync-extension-ui[data-ui-style="aurora-glass"][data-theme="dark"] {
                --bg-primary: rgba(16, 38, 42, .95); --bg-solid: #123034; --bg-elevated: rgba(25, 54, 58, .98); --bg-secondary: rgba(34, 68, 70, .92);
                --text-primary: #e9fffa; --text-secondary: #b5d2cc; --primary: #65dfc8; --primary-strong: #43c5b1;
                --primary-soft: rgba(101, 223, 200, .18); --cyan-soft: rgba(108, 184, 255, .16); --border-color: rgba(196, 255, 245, .22); --inner-border: rgba(209, 255, 245, .12);
                --hover-bg: rgba(63, 115, 113, .8); --shadow-color: rgba(0, 0, 0, .55);
            }
            #lexisync-extension-ui[data-ui-style="vision-aurora"] {
                --bg-primary: rgba(246, 250, 255, 0.94); --bg-solid: #f4f8ff; --bg-elevated: rgba(255, 255, 255, 0.98); --bg-secondary: rgba(230, 240, 255, 0.92);
                --text-primary: #0f172a; --text-secondary: #475569; --primary: #0d9488; --primary-strong: #4f46e5;
                --primary-soft: rgba(13, 148, 136, 0.14); --cyan-soft: rgba(79, 70, 229, 0.12); --border-color: rgba(255, 255, 255, 0.94); --inner-border: rgba(79, 70, 229, 0.12);
                --hover-bg: rgba(255, 255, 255, 0.92); --shadow-color: rgba(15, 23, 42, 0.22);
                border-radius: 24px;
                box-shadow: 0 24px 60px var(--shadow-color), inset 0 1px 2px rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(32px) saturate(190%);
                -webkit-backdrop-filter: blur(32px) saturate(190%);
            }
            #lexisync-extension-ui[data-ui-style="vision-aurora"][data-theme="dark"] {
                --bg-primary: rgba(13, 17, 26, 0.95); --bg-solid: #0f141e; --bg-elevated: rgba(20, 27, 40, 0.98); --bg-secondary: rgba(28, 38, 56, 0.92);
                --text-primary: #f8fafc; --text-secondary: #94a3b8; --primary: #2dd4bf; --primary-strong: #6366f1;
                --primary-soft: rgba(45, 212, 191, 0.16); --cyan-soft: rgba(99, 102, 241, 0.15); --border-color: rgba(255, 255, 255, 0.2); --inner-border: rgba(255, 255, 255, 0.1);
                --hover-bg: rgba(45, 212, 191, 0.15); --shadow-color: rgba(0, 0, 0, 0.65);
                border-radius: 24px;
                box-shadow: 0 24px 64px var(--shadow-color), inset 0 1px 1.5px rgba(255, 255, 255, 0.3);
                backdrop-filter: blur(32px) saturate(190%);
                -webkit-backdrop-filter: blur(32px) saturate(190%);
            }
            #lexisync-extension-ui[data-ui-style="silk-obsidian"] {
                --bg-primary: #ffffff; --bg-solid: #ffffff; --bg-elevated: #f8fafc; --bg-secondary: #f1f5f9;
                --text-primary: #0f172a; --text-secondary: #64748b; --primary: #4f46e5; --primary-strong: #4338ca;
                --primary-soft: rgba(79, 70, 229, 0.1); --cyan-soft: rgba(14, 165, 233, 0.1); --border-color: #e2e8f0; --inner-border: #edf2f7;
                --hover-bg: #f1f5f9; --shadow-color: rgba(15, 23, 42, 0.18);
                border-radius: 22px;
                box-shadow: 0 20px 44px var(--shadow-color), 0 4px 12px rgba(15, 23, 42, 0.06);
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }
            #lexisync-extension-ui[data-ui-style="silk-obsidian"][data-theme="dark"] {
                --bg-primary: #0c0e14; --bg-solid: #0c0e14; --bg-elevated: #151821; --bg-secondary: #1c202c;
                --text-primary: #f8fafc; --text-secondary: #8a96a8; --primary: #6366f1; --primary-strong: #4f46e5;
                --primary-soft: rgba(99, 102, 241, 0.15); --cyan-soft: rgba(45, 212, 191, 0.14); --border-color: rgba(255, 255, 255, 0.12); --inner-border: rgba(255, 255, 255, 0.08);
                --hover-bg: #232837; --shadow-color: rgba(0, 0, 0, 0.55);
                border-radius: 22px;
                box-shadow: 0 20px 48px var(--shadow-color), 0 4px 12px rgba(0, 0, 0, 0.3);
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }
            #lexisync-extension-ui span { flex-shrink: 0 !important; }
            #lexisync-extension-ui svg { width: 16px !important; height: 16px !important; min-width: 16px !important; min-height: 16px !important; max-width: 16px !important; max-height: 16px !important; flex-shrink: 0 !important; display: block !important; }
            @keyframes lexisync-spin { to { transform: rotate(360deg); } }
            @keyframes lexiSyncFadeIn { 0% { opacity: 0; transform: translateY(4px) scale(0.98); } 100% { opacity: 1; transform: translateY(0) scale(1); }}
            @keyframes lexiSyncDropdownIn { 0% { opacity: 0; transform: translateY(-4px) scale(0.97); } 100% { opacity: 1; transform: translateY(0) scale(1); }}
            .lexisync-dropdown { animation: lexiSyncDropdownIn 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
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
            .lexisync-dropdown,
            #lexisync-more-dropdown {
                background: var(--bg-elevated, #ffffff) !important;
                border: 1px solid var(--border-color) !important;
                box-shadow: 0 20px 48px rgba(0, 0, 0, 0.22), 0 4px 14px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255,255,255,.6) !important;
                backdrop-filter: blur(36px) saturate(160%) !important;
                -webkit-backdrop-filter: blur(36px) saturate(160%) !important;
            }
            #lexisync-extension-ui[data-theme="dark"] .lexisync-dropdown,
            #lexisync-extension-ui[data-theme="dark"] #lexisync-more-dropdown {
                background: var(--bg-elevated, #1b1e31) !important;
                border-color: var(--border-color) !important;
                box-shadow: 0 22px 52px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,.1) !important;
            }

            #lexisync-extension-ui[data-surface="menu"] {
                background: var(--bg-elevated) !important;
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
            .lexisync-menu-button-main {
                display: flex;
                flex: 1 1 auto;
                width: 0;
                min-width: 0;
                align-items: center;
                overflow: hidden;
            }
            .lexisync-menu-button-text {
                flex: 1 1 0;
                width: 0;
                min-width: 0;
                font-weight: 600;
                line-height: 1.25;
                overflow: hidden;
                overflow-wrap: anywhere;
                white-space: normal;
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
                flex: 0 0 auto;
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
                border-radius: 22px;
                box-shadow: 0 22px 52px var(--shadow-color), inset 0 1px 0 rgba(255,255,255,.34);
            }
            #lexisync-extension-ui[data-ui-style="magicos-11"][data-surface="result"],
            #lexisync-extension-ui[data-ui-style="magicos-11"][data-surface="menu"] { border-radius: 28px; }
            #lexisync-extension-ui[data-ui-style="material-3"][data-surface="result"],
            #lexisync-extension-ui[data-ui-style="material-3"][data-surface="menu"] { border-radius: 28px; }
            #lexisync-extension-ui[data-ui-style="flutter"][data-surface="result"],
            #lexisync-extension-ui[data-ui-style="flutter"][data-surface="menu"] { border-radius: 14px; }
            #lexisync-extension-ui[data-ui-style="aurora-glass"][data-surface="result"],
            #lexisync-extension-ui[data-ui-style="aurora-glass"][data-surface="menu"] { border-radius: 24px; }
            .lexisync-header {
                display: flex;
                min-height: 52px;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px !important;
                color: var(--text-primary);
                background: linear-gradient(180deg, var(--bg-elevated), var(--bg-secondary)) !important;
                border-bottom-color: var(--inner-border) !important;
                border-radius: 22px 22px 0 0 !important;
                font: 600 14px/1.35 system-ui, sans-serif;
                cursor: grab;
                user-select: none;
            }
            #lexisync-extension-ui[data-ui-style="magicos-11"] .lexisync-header {
                background: linear-gradient(120deg, rgba(255,255,255,.62), rgba(121,156,255,.17), rgba(102,218,231,.12)) !important;
                border-radius: 27px 27px 0 0 !important;
            }
            #lexisync-extension-ui[data-ui-style="magicos-11"][data-theme="dark"] .lexisync-header {
                background: linear-gradient(120deg, rgba(255,255,255,.1), rgba(125,151,235,.18), rgba(58,170,192,.12)) !important;
            }
            #lexisync-extension-ui[data-ui-style="material-3"] .lexisync-header {
                background: var(--primary-soft) !important;
                border-radius: 27px 27px 0 0 !important;
            }
            #lexisync-extension-ui[data-ui-style="flutter"] .lexisync-header {
                background: var(--bg-secondary) !important;
                border-radius: 13px 13px 0 0 !important;
            }
            #lexisync-extension-ui[data-ui-style="aurora-glass"] .lexisync-header {
                background: linear-gradient(120deg, rgba(255,255,255,.62), var(--primary-soft), var(--cyan-soft)) !important;
                border-radius: 23px 23px 0 0 !important;
            }
            .lexisync-header-title {
                display: flex;
                align-items: center;
                gap: 8px;
                color: var(--text-primary);
                font-weight: 600;
                letter-spacing: -0.01em;
                pointer-events: none;
            }
            .lexisync-header-control { display: flex; align-items: center; }
            .lexisync-content-pane {
                margin: 10px 10px 12px;
                padding: 16px 17px !important;
                min-height: 50px;
                max-height: min(30vh, 150px) !important;
                overflow-x: hidden;
                overflow-y: auto;
                background: var(--bg-elevated);
                border: 1px solid var(--inner-border);
                border-radius: 14px;
                box-shadow: 0 7px 18px rgba(33,48,84,.08), inset 0 1px 0 rgba(255,255,255,.28);
                color: var(--text-primary);
                font: 400 14px/1.65 system-ui, sans-serif;
                line-height: 1.65 !important;
                overflow-wrap: anywhere;
                white-space: pre-wrap;
            }
            .lexisync-actions {
                display: none;
                flex-wrap: wrap !important;
                align-items: center;
                justify-content: flex-start;
                gap: 8px;
                padding: 4px 14px 14px !important;
                box-sizing: border-box !important;
                max-width: 100% !important;
                border-radius: 0 0 20px 20px;
            }
            .lexisync-undo-button {
                padding: 0 10px !important;
                font-size: 12px !important;
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
            .lexisync-corrections {
                display: none;
                flex-direction: column;
                gap: 6px;
                max-height: 150px;
                padding: 0 14px 12px !important;
                overflow-y: auto;
            }
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
                color: var(--success-color);
                font: 600 11px/1.35 system-ui, sans-serif;
            }
            .lexisync-action-status[data-error="true"] { color: var(--error-color); }
            .lexisync-action-status[hidden] { display: none !important; }
            .lexisync-action-status[data-compact-announcement="true"] {
                position: absolute !important;
                width: 1px !important;
                height: 1px !important;
                padding: 0 !important;
                margin: -1px !important;
                overflow: hidden !important;
                clip: rect(0, 0, 0, 0) !important;
                white-space: nowrap !important;
                border: 0 !important;
            }
            .lexisync-preview-close { cursor: default !important; }
            #lexisync-extension-ui mark[role="button"] { cursor: pointer; }
            #lexisync-extension-ui mark[role="button"]:focus-visible {
                outline: 3px solid color-mix(in srgb, var(--primary) 35%, transparent);
                outline-offset: 2px;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-corrections,
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-result-tools {
                display: none !important;
            }
            #lexisync-extension-ui[data-compact-result="true"][data-surface="result"] {
                border-radius: 22px;
                background: var(--bg-primary) !important;
                box-shadow: 0 12px 30px var(--shadow-color), inset 0 1px 0 rgba(255, 255, 255, 0.68);
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-header {
                min-height: 32px;
                padding: 8px 16px !important;
                background: linear-gradient(180deg, var(--bg-elevated), var(--bg-primary)) !important;
                border-bottom: 1px solid var(--inner-border) !important;
                border-radius: 21px 21px 0 0 !important;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-header-title {
                font-size: 16px;
                font-weight: 700 !important;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-close-button {
                display: grid !important;
                width: 28px;
                height: 28px;
                min-width: 28px;
                place-items: center;
                margin-right: -4px !important;
                padding: 0 !important;
                border: 0 !important;
                border-radius: 8px !important;
                background: transparent !important;
                box-shadow: none !important;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-close-button svg {
                transform: scale(1.12);
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-close-button:focus-visible {
                outline: 2px solid var(--primary);
                outline-offset: 2px;
            }
            #lexisync-extension-ui[data-compact-result="true"][data-surface="result"] .lexisync-content-pane {
                margin: 0 !important;
                padding: 13px 18px 10px !important;
                min-height: 28px !important;
                line-height: 1.5 !important;
                background: transparent !important;
                border: 0 !important;
                border-radius: 0 !important;
                box-shadow: none !important;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-actions {
                flex-wrap: wrap !important;
                gap: 8px !important;
                padding: 0 14px 14px !important;
                box-sizing: border-box !important;
                max-width: 100% !important;
            }
            #lexisync-extension-ui[data-compact-result="true"][data-surface="result"] .lexisync-result-button {
                min-height: 36px;
                padding: 0 12px !important;
                border: 0 !important;
                border-radius: 10px !important;
                background: var(--hover-bg) !important;
                box-shadow: none !important;
                box-sizing: border-box !important;
                max-width: 100% !important;
            }
            #lexisync-extension-ui[data-compact-result="true"][data-surface="result"] .lexisync-result-button--primary {
                color: var(--text-primary) !important;
                background: var(--hover-bg) !important;
            }
            #lexisync-extension-ui[data-compact-result="true"]:not([data-theme="dark"]) .lexisync-result-button,
            #lexisync-extension-ui[data-compact-result="true"]:not([data-theme="dark"]) .lexisync-result-button--primary {
                color: #151515 !important;
                background: #f1f1f2 !important;
            }
            #lexisync-extension-ui[data-compact-result="true"] .lexisync-result-button:hover {
                background: var(--primary-soft) !important;
                transform: none;
            }
            .lexisync-correction-row {
                background: var(--bg-elevated);
                border-color: var(--inner-border) !important;
                border-radius: 12px !important;
                box-shadow: 0 5px 14px rgba(33,48,84,.06);
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
            #lexisync-extension-ui[data-ui-style="magicos-11"] .lexisync-content-pane,
            #lexisync-extension-ui[data-ui-style="magicos-11"] .lexisync-correction-row {
                border-color: rgba(255,255,255,.72) !important;
                border-radius: 18px !important;
                box-shadow: 0 10px 26px rgba(36,61,124,.12), inset 0 1px 0 rgba(255,255,255,.62);
                backdrop-filter: blur(20px) saturate(165%);
                -webkit-backdrop-filter: blur(20px) saturate(165%);
            }
            #lexisync-extension-ui[data-ui-style="magicos-11"] .lexisync-result-button,
            #lexisync-extension-ui[data-ui-style="magicos-11"] .lexisync-tool-chip {
                border-radius: 999px !important;
                box-shadow: inset 0 1px 0 rgba(255,255,255,.48), 0 6px 16px rgba(42,65,124,.1);
            }
            #lexisync-extension-ui[data-ui-style="flutter"] .lexisync-result-button,
            #lexisync-extension-ui[data-ui-style="flutter"] .lexisync-correction-row {
                border-radius: 8px !important;
            }
            #lexisync-extension-ui[data-ui-style="flutter"] .lexisync-result-button--primary {
                background: var(--primary) !important;
                box-shadow: 0 4px 10px color-mix(in srgb, var(--primary) 28%, transparent) !important;
            }
            #lexisync-extension-ui[data-ui-style="aurora-glass"] .lexisync-content-pane,
            #lexisync-extension-ui[data-ui-style="aurora-glass"] .lexisync-correction-row {
                border-color: rgba(255,255,255,.6) !important;
                box-shadow: 0 9px 22px rgba(21, 106, 96, .11), inset 0 1px 0 rgba(255,255,255,.52);
                backdrop-filter: blur(16px) saturate(135%);
                -webkit-backdrop-filter: blur(16px) saturate(135%);
            }
            .lexisync-result-button--primary:hover {
                filter: brightness(1.06);
                transform: translateY(-1px);
            }
            .lexisync-result-button--success {
                color: #166534 !important;
                background: #dcfce7 !important;
                font-weight: 600 !important;
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
