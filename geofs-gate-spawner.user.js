// ==UserScript==
// @name         GeoFS Gate Spawner
// @namespace    https://github.com/machpoint82/geofs-gate-spawner
// @version      2.1.0
// @description  Spawn parked at a real gate/stand at supported airports, with aircraft-category filters and a custom toggle shortcut.
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
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // CONFIG
    // ------------------------------------------------------------------
    const GATES_URL = 'https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/refs/heads/main/gates.json';
    const DEFAULT_SHORTCUT = { alt: true, ctrl: false, shift: false, key: 'g' };

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
            transition: opacity 0.15s ease, transform 0.15s ease;
        }
        #gs-root.gs-hidden { display: none; }
        #gs-header {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 12px;
            background: linear-gradient(120deg, #0f172a, #1d4ed8 60%, #06b6d4);
            cursor: default;
        }
        #gs-header img { width: 20px; height: 20px; border-radius: 5px; }
        #gs-header .gs-title { font-weight: 600; font-size: 13px; flex: 1; letter-spacing: 0.2px; }
        #gs-header .gs-icon-btn { cursor: pointer; opacity: 0.85; font-size: 13px; padding: 2px 4px; }
        #gs-header .gs-icon-btn:hover { opacity: 1; }
        #gs-body { padding: 10px 12px 12px; }
        #gs-body label.gs-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.55; display: block; margin: 8px 0 4px; }
        #gs-body select, #gs-body input[type=text] {
            width: 100%; box-sizing: border-box; padding: 6px 8px;
            background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
            border-radius: 8px; color: #f1f5f9; font-size: 12.5px; outline: none;
        }
        #gs-body select:focus, #gs-body input[type=text]:focus { border-color: #38bdf8; }
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

    function openShortcutSetup(isReconfigure) {
        const overlay = document.createElement('div');
        overlay.id = 'gs-overlay';
        overlay.innerHTML = `
            <div id="gs-modal">
                <h3>🔑 Set your toggle shortcut</h3>
                <p>${isReconfigure ? 'Press a new key combination to show/hide the Gate Spawner panel.' :
                    'Press the key combination you want to use to show/hide the Gate Spawner panel (e.g. Alt+G). It stays out of the way until you press it.'}</p>
                <div id="gs-combo-display">Press a key…</div>
                <button id="gs-save-shortcut" disabled>Save</button>
                <button id="gs-skip-shortcut">Use default (Alt+G)</button>
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
            showPanel();
        });

        overlay.querySelector('#gs-skip-shortcut').addEventListener('click', () => {
            shortcut = DEFAULT_SHORTCUT;
            GM_setValue('gs_shortcut', JSON.stringify(DEFAULT_SHORTCUT));
            cleanup();
            updateShortcutHint();
            showPanel();
        });
    }

    function togglePanel() {
        const root = document.getElementById('gs-root');
        if (!root) return;
        root.classList.toggle('gs-hidden');
    }

    function showPanel() {
        const root = document.getElementById('gs-root');
        if (root) root.classList.remove('gs-hidden');
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
                <div class="gs-icon-btn" id="gs-reconfigure" title="Change toggle shortcut">⚙</div>
                <div class="gs-icon-btn" id="gs-close" title="Hide panel">✕</div>
            </div>
            <div id="gs-body">
                <label class="gs-label">Airport</label>
                <select id="gs-airport"><option>Loading…</option></select>

                <label class="gs-label">Search</label>
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

        document.getElementById('gs-airport').addEventListener('change', populateGateList);
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
        document.getElementById('gs-close').addEventListener('click', togglePanel);
        document.getElementById('gs-reconfigure').addEventListener('click', () => openShortcutSetup(true));
    }

    function populateAirportList() {
        const sel = document.getElementById('gs-airport');
        sel.innerHTML = '';
        const icaos = Object.keys(gatesDB).sort();
        if (icaos.length === 0) {
            sel.innerHTML = '<option>No airports loaded</option>';
            return;
        }
        icaos.forEach(icao => {
            const opt = document.createElement('option');
            opt.value = icao;
            opt.textContent = `${icao} (${gatesDB[icao].length} spots)`;
            sel.appendChild(opt);
        });
        populateGateList();
    }

    function populateGateList() {
        const icao = document.getElementById('gs-airport').value;
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
        const icao = document.getElementById('gs-airport').value;
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

        const stored = GM_getValue('gs_shortcut', null);
        if (stored) {
            try {
                shortcut = JSON.parse(stored);
            } catch (e) {
                shortcut = DEFAULT_SHORTCUT;
            }
            // Panel starts hidden after the first run is already configured —
            // press your shortcut to bring it up.
            document.getElementById('gs-root').classList.add('gs-hidden');
        } else {
            // First run ever: ask the user to pick their shortcut.
            openShortcutSetup(false);
            document.getElementById('gs-root').classList.add('gs-hidden');
        }

        document.getElementById('gs-shortcut-hint').textContent =
            shortcut ? `Toggle: ${formatShortcut(shortcut)}` : '';

        window.addEventListener('keydown', (e) => {
            if (matchesShortcut(e, shortcut)) {
                e.preventDefault();
                togglePanel();
            }
        });
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 1500);
    } else {
        window.addEventListener('load', () => setTimeout(init, 1500));
    }
})();
