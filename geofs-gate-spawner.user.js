// ==UserScript==
// @name         GeoFS Gate Spawner
// @namespace    https://github.com/machpoint82/geofs-gate-spawner
// @version      3.0.0
// @description  Spawn parked at a real gate/stand at supported airports, with aircraft-category filters. Docks a small button next to your other GeoFS addon pads.
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
    const ICON_URL = 'https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/main/icon.png';

    // Used only if the fetch fails (offline, repo down, typo in URL, etc).
    const EMBEDDED_SAMPLE = {
        "TEST": [
            { "name": "A1 (demo)", "lat": 51.4706123, "lon": -0.4548210, "heading": 273, "type": "gate", "airplane_types": ["heavy", "jets"], "width_code": "F", "operation_type": "airline" }
        ]
    };

    // Aircraft-category / operation filters, built from the width_code and
    // operation_type fields the extractor pulls from apt.dat rows 1300/1301.
    const FILTERS = [
        { key: 'codeF', label: 'A380 / 747 (Code F)', test: g => g.width_code === 'F' },
        { key: 'codeE', label: '777 / 787 (Code E)', test: g => g.width_code === 'E' },
        { key: 'heavy', label: 'Heavy-capable', test: g => Array.isArray(g.airplane_types) && g.airplane_types.includes('heavy') },
        { key: 'cargo', label: 'Cargo', test: g => g.operation_type === 'cargo' },
        { key: 'ga', label: 'General aviation', test: g => g.operation_type === 'general_aviation' },
    ];

    let gatesDB = {};
    let activeFilters = new Set();
    let currentAirport = null;

    // ------------------------------------------------------------------
    // STYLES
    // ------------------------------------------------------------------
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
        /* --- Dock button: sits alongside other addons' pads (Radio, Random Jobs, etc) --- */
        .gs-pad {
            width: 46px !important; height: 46px !important;
            min-width: 46px; min-height: 46px;
            border-radius: 12px !important;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; overflow: hidden;
            background: linear-gradient(135deg, #0f172a, #1d4ed8 60%, #06b6d4);
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }
        .gs-pad img { width: 30px; height: 30px; border-radius: 6px; pointer-events: none; }

        /* --- Fallback dock, only used if GeoFS's own pad row can't be found --- */
        .gs-pad.gs-fallback-pad {
            position: fixed; top: 64px; right: 14px; z-index: 999999;
        }

        #gs-root {
            position: fixed; top: 64px; right: 70px; z-index: 999999;
            width: 260px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #e5e7eb;
            background: linear-gradient(160deg, rgba(15,23,42,0.92), rgba(30,41,59,0.92));
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px;
            backdrop-filter: blur(10px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.45);
            overflow: hidden;
            display: none;
        }
        #gs-root.gs-open { display: block; }
        #gs-header {
            display: flex; align-items: center; gap: 8px;
            padding: 9px 10px;
            background: linear-gradient(120deg, #0f172a, #1d4ed8 60%, #06b6d4);
            cursor: grab;
        }
        #gs-header img { width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0; pointer-events: none; }
        #gs-header .gs-title { font-weight: 600; font-size: 13px; flex: 1; letter-spacing: 0.2px; pointer-events: none; }
        #gs-header .gs-close { cursor: pointer; opacity: 0.85; font-size: 14px; padding: 2px 4px; }
        #gs-header .gs-close:hover { opacity: 1; }
        #gs-body { padding: 10px 12px 12px; }
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
        `;
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // DOCK BUTTON: try to sit inside GeoFS's own .geofs-ui-right control-pad
    // row (same place Radio/Random Jobs/etc live). Falls back to a fixed
    // floating button if that row can't be found, so the script is never
    // silently invisible on a GeoFS version/layout that differs.
    // ------------------------------------------------------------------
    function createPadButton() {
        const pad = document.createElement('div');
        pad.id = 'gs-pad';
        pad.className = 'control-pad gs-pad';
        pad.setAttribute('tabindex', '0');
        pad.title = 'Gate Spawner';
        pad.innerHTML = `<img src="${ICON_URL}" onerror="this.style.display='none'"/>`;
        pad.addEventListener('click', togglePanel);
        pad.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); }
        });
        return pad;
    }

    function dockPadButton(attempt = 0) {
        const uiRight = document.querySelector('.geofs-ui-right');
        if (uiRight) {
            uiRight.appendChild(createPadButton());
            return;
        }
        if (attempt < 20) {
            setTimeout(() => dockPadButton(attempt + 1), 500);
        } else {
            // Never found GeoFS's own pad row -- fall back to a floating
            // button so the script is still reachable rather than invisible.
            const pad = createPadButton();
            pad.classList.add('gs-fallback-pad');
            document.body.appendChild(pad);
        }
    }

    // ------------------------------------------------------------------
    // PANEL OPEN/CLOSE + DRAGGING
    // ------------------------------------------------------------------
    function togglePanel() {
        const root = document.getElementById('gs-root');
        if (!root) return;
        root.classList.toggle('gs-open');
    }

    function closePanel() {
        const root = document.getElementById('gs-root');
        if (root) root.classList.remove('gs-open');
    }

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
            if (e.target.closest('.gs-close')) return;
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
            header.style.cursor = 'grab';
            if (moved) {
                const rect = root.getBoundingClientRect();
                const pos = { top: rect.top, right: window.innerWidth - rect.right };
                GM_setValue('gs_position', JSON.stringify(pos));
            }
        });
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
        root.innerHTML = `
            <div id="gs-header">
                <img src="${ICON_URL}" onerror="this.style.display='none'"/>
                <div class="gs-title">Gate Spawner</div>
                <div class="gs-close" title="Close">✕</div>
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
        document.querySelector('#gs-header .gs-close').addEventListener('click', closePanel);
        makeDraggable(root, document.getElementById('gs-header'));
        wireAirportCombo();
    }

    // ------------------------------------------------------------------
    // AIRPORT COMBOBOX (custom-built, doubles as an ICAO search box)
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
    // fresh gate spawn. Best-effort -- GeoFS's internal physics aren't
    // something we control directly, so this helps in most cases but
    // isn't guaranteed for every aircraft/gate.
    // ------------------------------------------------------------------
    function holdParkingBrakeOnSpawn() {
        let justSpawned = false;
        try { justSpawned = sessionStorage.getItem('gs_just_spawned') === '1'; } catch (e) { /* ignore */ }
        if (!justSpawned) return;
        try { sessionStorage.removeItem('gs_just_spawned'); } catch (e) { /* ignore */ }

        const HOLD_MS = 4000;

        function dispatch(type) {
            window.dispatchEvent(new KeyboardEvent(type, {
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
        dockPadButton();
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 1500);
    } else {
        window.addEventListener('load', () => setTimeout(init, 1500));
    }
})();
