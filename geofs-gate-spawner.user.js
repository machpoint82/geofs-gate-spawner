// ==UserScript==
// @name         GeoFS Gate Spawner
// @namespace    https://github.com/machpoint82/geofs-gate-spawner
// @version      2.4.1
// @description  Spawn parked at a real gate/stand at supported airports, with aircraft-category filters. Panel opens from a small always-visible tab; a keyboard shortcut is optional.
// @author       machpoint82
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @icon         https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/main/icon.png
// @updateURL    https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/main/geofs-gate-spawner.user.js
// @downloadURL  https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/main/geofs-gate-spawner.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      goatcounter.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // CONFIG
    // ------------------------------------------------------------------
    const GATES_URL = 'https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/refs/heads/main/gates.json';

    const ANALYTICS_SITE_CODE = '<script data-goatcounter="https://machpoint82.goatcounter.com/count"
        async src="//gc.zgo.at/count.js"></script>';

    function pingCounter(path) {
        if (!ANALYTICS_SITE_CODE) return;
        try {
            const img = new Image();
            img.referrerPolicy = 'no-referrer';
            img.src = `https://${ANALYTICS_SITE_CODE}.goatcounter.com/count?p=${encodeURIComponent(path)}`;
        } catch (e) { /* ignore, this should never break the actual script */ }
    }
    // No default shortcut is shipped or forced on anyone. The panel is
    // always reachable via the small tab in the corner; a keyboard
    // shortcut is entirely optional and only exists if the user sets
    // one themselves via the gear icon.

    // Used only if the fetch fails (offline, repo down, typo in URL, etc).
    const EMBEDDED_SAMPLE = {
        "TEST": [
            { "name": "A1 (demo)", "lat": 51.4706123, "lon": -0.4548210, "heading": 273, "type": "gate", "airplane_types": ["heavy", "jets"], "width_code": "F", "operation_type": "airline" }
        ]
    };

    // Aircraft-category / operation filters, built from the width_code and
    // operation_type fields the extractor now pulls from apt.dat rows 1300/1301.
    const FILTERS = [
        { key: 'codeF', label: 'A380 / 747 (Code F)', test: g => g.width_code === 'F' },
        { key: 'codeE', label: '777 / 787 (Code E)', test: g => g.width_code === 'E' },
        { key: 'heavy', label: 'Heavy-capable', test: g => Array.isArray(g.airplane_types) && g.airplane_types.includes('heavy') },
        { key: 'cargo', label: 'Cargo', test: g => g.operation_type === 'cargo' },
        { key: 'ga', label: 'General aviation', test: g => g.operation_type === 'general_aviation' },
    ];

    let gatesDB = {};
    let activeFilters = new Set();
    let shortcut = null;
    let currentAirport = null;

    // ------------------------------------------------------------------
    // STYLES
    // ------------------------------------------------------------------
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
        #gs-root {
            position: fixed; top: 64px; right: 14px; z-index: 999999;
            width: 260px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #e5e7eb;
            background: linear-gradient(160deg, rgba(15,23,42,0.92), rgba(30,41,59,0.92));
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px;
            backdrop-filter: blur(10px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.45);
            overflow: hidden;
        }
        #gs-header {
            display: flex; align-items: center; gap: 8px;
            padding: 9px 10px;
            background: linear-gradient(120deg, #0f172a, #1d4ed8 60%, #06b6d4);
            cursor: pointer;
        }
        #gs-header img { width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0; }
        #gs-header .gs-title { font-weight: 600; font-size: 13px; flex: 1; letter-spacing: 0.2px; }
        #gs-header .gs-icon-btn { cursor: pointer; opacity: 0.85; font-size: 13px; padding: 2px 4px; }
        #gs-header .gs-icon-btn:hover { opacity: 1; }
        #gs-chevron { font-size: 11px; opacity: 0.8; transition: transform 0.15s ease; }
        #gs-root.gs-collapsed #gs-chevron { transform: rotate(-90deg); }
        #gs-body { padding: 10px 12px 12px; }
        #gs-root.gs-collapsed #gs-body { display: none; }
        #gs-body label.gs-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.55; display: block; margin: 8px 0 4px; }
        #gs-body select, #gs-body input[type=text] {
            width: 100%; box-sizing: border-box; padding: 6px 8px;
            background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
            border-radius: 8px; color: #f1f5f9; font-size: 12.5px; outline: none;
        }
        #gs-body select:focus, #gs-body input[type=text]:focus { border-color: #38bdf8; }
        #gs-airport-combo { position: relative; }
        #gs-airport-list {
            display: none; position: absolute; top: calc(100% + 4px); left: 0; right: 0;
            max-height: 160px; overflow-y: auto; z-index: 10;
            background: #0f172a; border: 1px solid rgba(255,255,255,0.15);
            border-radius: 8px; box-shadow: 0 8px 20px rgba(0,0,0,0.5);
        }
        #gs-airport-list.gs-open { display: block; }
        #gs-airport-list .gs-airport-item {
            padding: 7px 9px; font-size: 12.5px; color: #e5e7eb; cursor: pointer;
        }
        #gs-airport-list .gs-airport-item:hover,
        #gs-airport-list .gs-airport-item.gs-highlighted { background: #1d4ed8; }
        #gs-airport-list .gs-airport-empty { padding: 7px 9px; font-size: 12px; color: #94a3b8; }
        #gs-gate { height: 130px; }
        #gs-gate option { padding: 3px 4px; }
        #gs-filters { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
        .gs-chip {
            font-size: 10.5px; padding: 4px 8px; border-radius: 999px; cursor: pointer;
            background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
            color: #cbd5e1; transition: all 0.12s ease; user-select: none;
        }
        .gs-chip:hover { background: rgba(255,255,255,0.12); }
        .gs-chip.gs-active { background: linear-gradient(120deg, #1d4ed8, #06b6d4); color: white; border-color: transparent; }
        #gs-spawn {
            width: 100%; margin-top: 10px; padding: 9px; border: none; border-radius: 9px;
            background: linear-gradient(120deg, #1d4ed8, #06b6d4); color: white;
            font-weight: 600; font-size: 12.5px; cursor: pointer; letter-spacing: 0.2px;
        }
        #gs-spawn:hover { filter: brightness(1.08); }
        #gs-spawn:active { transform: scale(0.98); }
        #gs-status { margin-top: 7px; font-size: 11px; opacity: 0.65; min-height: 14px; }
        #gs-shortcut-hint { margin-top: 6px; font-size: 10.5px; opacity: 0.4; text-align: center; }

        #gs-overlay {
            position: fixed; inset: 0; z-index: 9999999;
            background: rgba(2,6,23,0.72); backdrop-filter: blur(3px);
            display: flex; align-items: center; justify-content: center;
        }
        #gs-modal {
            width: 320px; background: linear-gradient(160deg, #0f172a, #1e293b);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e5e7eb;
            text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.6);
        }
        #gs-modal h3 { margin: 6px 0 8px; font-size: 15px; }
        #gs-modal p { font-size: 12.5px; opacity: 0.75; line-height: 1.5; margin: 0 0 14px; }
        #gs-combo-display {
            font-size: 18px; font-weight: 700; letter-spacing: 0.5px;
            background: rgba(255,255,255,0.06); border: 1px dashed rgba(255,255,255,0.25);
            border-radius: 10px; padding: 12px; margin-bottom: 14px; color: #38bdf8;
        }
        #gs-modal button {
            border: none; border-radius: 8px; padding: 9px 14px; font-size: 12.5px; font-weight: 600;
            cursor: pointer; margin: 0 4px;
        }
        #gs-save-shortcut { background: linear-gradient(120deg, #1d4ed8, #06b6d4); color: white; }
        #gs-save-shortcut:disabled { opacity: 0.4; cursor: not-allowed; }
        #gs-skip-shortcut { background: rgba(255,255,255,0.08); color: #cbd5e1; }
        `;
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // SHORTCUT (custom toggle keybind)
    // ------------------------------------------------------------------
    function formatShortcut(sc) {
        const parts = [];
        if (sc.ctrl) parts.push('Ctrl');
        if (sc.alt) parts.push('Alt');
        if (sc.shift) parts.push('Shift');
        parts.push(sc.key.toUpperCase());
        return parts.join(' + ');
    }

    function matchesShortcut(e, sc) {
        if (!sc) return false;
        return !!e.ctrlKey === !!sc.ctrl &&
               !!e.altKey === !!sc.alt &&
               !!e.shiftKey === !!sc.shift &&
               e.key.toLowerCase() === sc.key.toLowerCase();
    }

    function openShortcutSetup() {
        const overlay = document.createElement('div');
        overlay.id = 'gs-overlay';
        overlay.innerHTML = `
            <div id="gs-modal">
                <h3>🔑 Optional: set a toggle shortcut</h3>
                <p>Press a key combination to use as a shortcut for opening/closing this panel (e.g. Ctrl+Shift+K). Pick something not already used by your browser or extensions. You can always open the panel from its tab instead, so this is entirely optional.</p>
                <div id="gs-combo-display">Press a key…</div>
                <button id="gs-save-shortcut" disabled>Save</button>
                <button id="gs-skip-shortcut">Cancel</button>
            </div>
        `;
        document.body.appendChild(overlay);

        let captured = null;
        const display = overlay.querySelector('#gs-combo-display');
        const saveBtn = overlay.querySelector('#gs-save-shortcut');

        function captureHandler(e) {
            const nonModifierKeys = ['Control', 'Alt', 'Shift', 'Meta'];
            if (nonModifierKeys.includes(e.key)) return;
            e.preventDefault();
            captured = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, key: e.key.toLowerCase() };
            display.textContent = formatShortcut(captured);
            saveBtn.disabled = false;
        }

        window.addEventListener('keydown', captureHandler, true);

        function cleanup() {
            window.removeEventListener('keydown', captureHandler, true);
            overlay.remove();
        }

        saveBtn.addEventListener('click', () => {
            if (!captured) return;
            shortcut = captured;
            GM_setValue('gs_shortcut', JSON.stringify(captured));
            cleanup();
            updateShortcutHint();
        });

        overlay.querySelector('#gs-skip-shortcut').addEventListener('click', () => {
            cleanup();
        });
    }

    function updateShortcutHint() {
        const hint = document.getElementById('gs-shortcut-hint');
        if (!hint) return;
        hint.textContent = shortcut ? `Shortcut: ${formatShortcut(shortcut)}` : 'No shortcut set — click ⚙ to add one';
    }

    // ------------------------------------------------------------------
    // DRAGGING
    // ------------------------------------------------------------------
    function makeDraggable(root, header) {
        let dragging = false;
        let moved = false;
        let startX = 0, startY = 0, startRight = 0, startTop = 0;

        try {
            const savedPos = GM_getValue('gs_position', null);
            if (savedPos) {
                const pos = JSON.parse(savedPos);
                root.style.top = pos.top + 'px';
                root.style.right = pos.right + 'px';
            }
        } catch (e) { /* ignore, use CSS defaults */ }

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('#gs-reconfigure')) return;
            dragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = root.getBoundingClientRect();
            startRight = window.innerWidth - rect.right;
            startTop = rect.top;
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
            const newTop = Math.max(0, startTop + dy);
            const newRight = Math.max(0, startRight - dx);
            root.style.top = newTop + 'px';
            root.style.right = newRight + 'px';
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            header.style.cursor = 'pointer';
            if (moved) {
                const rect = root.getBoundingClientRect();
                const pos = { top: rect.top, right: window.innerWidth - rect.right };
                GM_setValue('gs_position', JSON.stringify(pos));
            }
        });

        // Suppress the toggle click that immediately follows a real drag,
        // but let a plain click through untouched.
        header.addEventListener('click', (e) => {
            if (moved) {
                e.stopImmediatePropagation();
                moved = false;
            }
        }, true);
    }

    function togglePanel() {
        const root = document.getElementById('gs-root');
        if (!root) return;
        root.classList.toggle('gs-collapsed');
    }

    function showPanel() {
        const root = document.getElementById('gs-root');
        if (root) root.classList.remove('gs-collapsed');
    }

    // ------------------------------------------------------------------
    // DATA LOADING
    // ------------------------------------------------------------------
    function loadGates() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: GATES_URL,
            onload: function (res) {
                try {
                    gatesDB = JSON.parse(res.responseText);
                } catch (e) {
                    console.error('[Gate Spawner] Could not parse gates.json, using sample data.', e);
                    gatesDB = EMBEDDED_SAMPLE;
                }
                populateAirportList();
            },
            onerror: function (e) {
                console.error('[Gate Spawner] Could not fetch gates.json, using sample data.', e);
                gatesDB = EMBEDDED_SAMPLE;
                populateAirportList();
            }
        });
    }

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------
    function buildUI() {
        const root = document.createElement('div');
        root.id = 'gs-root';
        const iconUrl = 'https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/main/icon.png';
        root.innerHTML = `
            <div id="gs-header">
                <img src="${iconUrl}" onerror="this.style.display='none'"/>
                <div class="gs-title">Gate Spawner</div>
                <div class="gs-icon-btn" id="gs-reconfigure" title="Set/change optional keyboard shortcut">⚙</div>
                <div id="gs-chevron">▾</div>
            </div>
            <div id="gs-body">
                <label class="gs-label">Airport</label>
                <div id="gs-airport-combo">
                    <input id="gs-airport-input" type="text" placeholder="Search ICAO, e.g. EGLL" autocomplete="off" />
                    <div id="gs-airport-list"></div>
                </div>

                <label class="gs-label">Search gate</label>
                <input id="gs-search" type="text" placeholder="e.g. 209R" />

                <label class="gs-label">Filters</label>
                <div id="gs-filters"></div>

                <label class="gs-label">Gate</label>
                <select id="gs-gate" size="6"></select>

                <button id="gs-spawn">Spawn at gate</button>
                <div id="gs-status"></div>
                <div id="gs-shortcut-hint"></div>
            </div>
        `;
        document.body.appendChild(root);
        root.classList.add('gs-collapsed');

        FILTERS.forEach(f => {
            const chip = document.createElement('div');
            chip.className = 'gs-chip';
            chip.textContent = f.label;
            chip.dataset.key = f.key;
            chip.addEventListener('click', () => {
                if (activeFilters.has(f.key)) {
                    activeFilters.delete(f.key);
                    chip.classList.remove('gs-active');
                } else {
                    activeFilters.add(f.key);
                    chip.classList.add('gs-active');
                }
                populateGateList();
            });
            document.getElementById('gs-filters').appendChild(chip);
        });

        document.getElementById('gs-search').addEventListener('input', populateGateList);
        document.getElementById('gs-search').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const gateSel = document.getElementById('gs-gate');
                if (gateSel.options.length > 0) {
                    gateSel.selectedIndex = 0;
                    spawnAtSelectedGate();
                }
            }
        });
        document.getElementById('gs-spawn').addEventListener('click', spawnAtSelectedGate);
        document.getElementById('gs-header').addEventListener('click', togglePanel);
        document.getElementById('gs-reconfigure').addEventListener('click', (e) => {
            e.stopPropagation(); // don't also toggle the header when clicking the gear
            openShortcutSetup();
        });
        makeDraggable(root, document.getElementById('gs-header'));
        wireAirportCombo();
    }

    // ------------------------------------------------------------------
    // AIRPORT COMBOBOX (custom-built so it isn't limited by native <select>
    // dropdown styling, and doubles as an ICAO search box)
    // ------------------------------------------------------------------
    function wireAirportCombo() {
        const input = document.getElementById('gs-airport-input');
        const list = document.getElementById('gs-airport-list');

        function renderList(filterText) {
            const q = (filterText || '').trim().toLowerCase();
            const icaos = Object.keys(gatesDB).sort();
            const matches = q ? icaos.filter(icao => icao.toLowerCase().includes(q)) : icaos;

            list.innerHTML = '';
            if (matches.length === 0) {
                list.innerHTML = '<div class="gs-airport-empty">No airports match</div>';
            } else {
                matches.forEach((icao, i) => {
                    const item = document.createElement('div');
                    item.className = 'gs-airport-item';
                    if (i === 0) item.classList.add('gs-highlighted');
                    item.textContent = `${icao} (${gatesDB[icao].length} spots)`;
                    item.dataset.icao = icao;
                    item.addEventListener('mousedown', (e) => {
                        // mousedown (not click) so it fires before the input's blur closes the list
                        e.preventDefault();
                        selectAirport(icao);
                    });
                    list.appendChild(item);
                });
            }
            list.classList.add('gs-open');
        }

        function selectAirport(icao) {
            currentAirport = icao;
            input.value = `${icao} (${(gatesDB[icao] || []).length} spots)`;
            list.classList.remove('gs-open');
            populateGateList();
        }

        input.addEventListener('focus', () => {
            input.select();
            renderList('');
        });
        input.addEventListener('input', () => renderList(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = list.querySelector('.gs-airport-item');
                if (first) selectAirport(first.dataset.icao);
            } else if (e.key === 'Escape') {
                list.classList.remove('gs-open');
            }
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#gs-airport-combo')) {
                list.classList.remove('gs-open');
            }
        });

        // expose selectAirport for populateAirportList() to pick a default
        wireAirportCombo._select = selectAirport;
    }

    function populateAirportList() {
        const icaos = Object.keys(gatesDB).sort();
        const input = document.getElementById('gs-airport-input');
        if (icaos.length === 0) {
            input.value = '';
            input.placeholder = 'No airports loaded';
            return;
        }
        if (!currentAirport || !gatesDB[currentAirport]) {
            currentAirport = icaos[0];
        }
        input.value = `${currentAirport} (${gatesDB[currentAirport].length} spots)`;
        populateGateList();
    }

    function populateGateList() {
        const icao = currentAirport;
        const query = document.getElementById('gs-search').value.trim().toLowerCase();
        const gateSel = document.getElementById('gs-gate');
        gateSel.innerHTML = '';

        const gates = gatesDB[icao] || [];
        let filtered = gates;

        if (query) {
            filtered = filtered.filter(g => g.name.toLowerCase().includes(query));
        }
        if (activeFilters.size > 0) {
            const activeTests = FILTERS.filter(f => activeFilters.has(f.key));
            filtered = filtered.filter(g => activeTests.every(f => f.test(g)));
        }

        filtered.forEach((gate) => {
            const opt = document.createElement('option');
            opt.value = gates.indexOf(gate);
            const tag = gate.width_code ? ` · ${gate.width_code}` : '';
            opt.textContent = `${gate.name} (${gate.type}${tag})`;
            gateSel.appendChild(opt);
        });

        if (filtered.length > 0) {
            gateSel.selectedIndex = 0;
        }

        const status = document.getElementById('gs-status');
        status.textContent = `${filtered.length} of ${gates.length} spots match`;
    }

    // ------------------------------------------------------------------
    // ANTI-CREEP: hold the parking brake for a few seconds right after a
    // fresh gate spawn. GeoFS can spawn an aircraft slightly above the
    // pavement or with idle thrust already applied, so it can roll/creep
    // forward before physics settles. Holding Space (the parking brake
    // key) the same way a player would stops that. Best-effort — GeoFS's
    // internal physics aren't something we control directly, so this
    // helps in most cases but isn't guaranteed for every aircraft/gate.
    // ------------------------------------------------------------------
    function holdParkingBrakeOnSpawn() {
        let justSpawned = false;
        try { justSpawned = sessionStorage.getItem('gs_just_spawned') === '1'; } catch (e) { /* ignore */ }
        if (!justSpawned) return;
        try { sessionStorage.removeItem('gs_just_spawned'); } catch (e) { /* ignore */ }

        const HOLD_MS = 4000;
        const target = window; // GeoFS listens for key events on window/document

        function dispatch(type) {
            target.dispatchEvent(new KeyboardEvent(type, {
                key: ' ', code: 'Space', keyCode: 32, which: 32,
                bubbles: true, cancelable: true
            }));
        }

        dispatch('keydown');
        setTimeout(() => dispatch('keyup'), HOLD_MS);
    }

    function getCurrentAircraft() {
        try {
            if (unsafeWindow.geofs && unsafeWindow.geofs.aircraft && unsafeWindow.geofs.aircraft.instance) {
                const id = unsafeWindow.geofs.aircraft.instance.id;
                if (id) return id;
            }
        } catch (e) { /* ignore, fall through */ }
        const params = new URLSearchParams(window.location.search);
        return params.get('aircraft') || 'c172';
    }

    function spawnAtSelectedGate() {
        const icao = currentAirport;
        const idx = document.getElementById('gs-gate').value;
        const gate = (gatesDB[icao] || [])[idx];
        const status = document.getElementById('gs-status');
        if (!gate) {
            status.textContent = 'No gate selected.';
            return;
        }

        const aircraft = getCurrentAircraft();
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('aircraft', aircraft);
        url.searchParams.set('lat', gate.lat);
        url.searchParams.set('lon', gate.lon);
        url.searchParams.set('heading', gate.heading);
        url.searchParams.set('alt', 0);

        status.textContent = `Spawning at ${icao} ${gate.name}…`;
        pingCounter('/spawn');
        try { sessionStorage.setItem('gs_just_spawned', '1'); } catch (e) { /* ignore */ }
        window.location.href = url.toString();
    }

    // ------------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------------
    function init() {
        injectStyles();
        buildUI();
        loadGates();
        holdParkingBrakeOnSpawn();
        pingCounter('/loaded');

        const stored = GM_getValue('gs_shortcut', null);
        if (stored) {
            try {
                shortcut = JSON.parse(stored);
            } catch (e) {
                shortcut = null;
            }
        }
        updateShortcutHint();

        // Capture phase, so we get first crack at the keydown before GeoFS's
        // own handlers (or the browser) can swallow it. Note: some key
        // combos (e.g. Alt+G) may already be claimed by your browser or an
        // extension before the page ever sees them — if your shortcut
        // doesn't seem to work, try a different combination.
        window.addEventListener('keydown', (e) => {
            if (shortcut && matchesShortcut(e, shortcut)) {
                e.preventDefault();
                togglePanel();
            }
        }, true);
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 1500);
    } else {
        window.addEventListener('load', () => setTimeout(init, 1500));
    }
})();
