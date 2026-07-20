// ==UserScript==
// @name         GeoFS Gate Spawner
// @namespace    https://github.com/machpoint82/geofs-gate-spawner
// @version      1.1.0
// @description  Pick an airport and gate (or just type the gate number), spawn parked right there.
// @author       machpoint82
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // Your gate database, hosted on GitHub.
    // ------------------------------------------------------------------
    const GATES_URL = 'https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/refs/heads/main/gates.json';

    // Used only if the fetch above fails for some reason (offline, repo
    // down, typo in URL, etc) so the panel doesn't just break.
    const EMBEDDED_SAMPLE = {
        "TEST": [
            { "name": "A1 (demo)", "lat": 51.4706123, "lon": -0.4548210, "heading": 273, "type": "gate" },
            { "name": "A2 (demo)", "lat": 51.4701456, "lon": -0.4552310, "heading": 273, "type": "gate" }
        ]
    };

    let gatesDB = {};

    function loadGates() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: GATES_URL,
            onload: function (res) {
                try {
                    gatesDB = JSON.parse(res.responseText);
                } catch (e) {
                    console.error('[Gate Spawner] Could not parse gates.json, falling back to sample data.', e);
                    gatesDB = EMBEDDED_SAMPLE;
                }
                populateAirportList();
            },
            onerror: function (e) {
                console.error('[Gate Spawner] Could not fetch gates.json, falling back to sample data.', e);
                gatesDB = EMBEDDED_SAMPLE;
                populateAirportList();
            }
        });
    }

    function buildUI() {
        const panel = document.createElement('div');
        panel.id = 'gate-spawner-panel';
        panel.style.cssText = `
            position: fixed; top: 60px; right: 10px; z-index: 999999;
            background: rgba(20,20,20,0.92); color: #fff; padding: 10px;
            border-radius: 8px; font-family: sans-serif; font-size: 13px;
            width: 240px; box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        `;
        panel.innerHTML = `
            <div style="font-weight:bold; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                <span>✈ Gate Spawner</span>
                <span id="gs-collapse" style="cursor:pointer; opacity:0.7;">–</span>
            </div>
            <div id="gs-body">
                <select id="gs-airport" style="width:100%; margin-bottom:6px;"><option>Loading…</option></select>
                <input id="gs-search" type="text" placeholder="Type gate number, e.g. 209R"
                       style="width:100%; margin-bottom:6px; box-sizing:border-box; padding:4px;" />
                <select id="gs-gate" size="6" style="width:100%; margin-bottom:6px;"></select>
                <button id="gs-spawn" style="width:100%; padding:5px; cursor:pointer;">Spawn at gate</button>
                <div id="gs-status" style="margin-top:6px; opacity:0.7; font-size:11px;"></div>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('gs-airport').addEventListener('change', () => populateGateList());
        document.getElementById('gs-spawn').addEventListener('click', spawnAtSelectedGate);
        document.getElementById('gs-search').addEventListener('input', () => populateGateList());
        document.getElementById('gs-search').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // Jump straight to the first match and spawn — fast path for event day.
                const gateSel = document.getElementById('gs-gate');
                if (gateSel.options.length > 0) {
                    gateSel.selectedIndex = 0;
                    spawnAtSelectedGate();
                }
            }
        });
        document.getElementById('gs-collapse').addEventListener('click', () => {
            const body = document.getElementById('gs-body');
            const collapsed = body.style.display === 'none';
            body.style.display = collapsed ? 'block' : 'none';
            document.getElementById('gs-collapse').textContent = collapsed ? '–' : '+';
        });
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
        const filtered = query
            ? gates.filter(g => g.name.toLowerCase().includes(query))
            : gates;

        filtered.forEach((gate) => {
            const opt = document.createElement('option');
            // store the gate's real index in the unfiltered array so
            // spawnAtSelectedGate() always looks up the right object
            opt.value = gates.indexOf(gate);
            opt.textContent = `${gate.name} (${gate.type})`;
            gateSel.appendChild(opt);
        });

        if (filtered.length > 0) {
            gateSel.selectedIndex = 0;
        }
    }

    function getCurrentAircraft() {
        // Prefer the live sim's current aircraft id so we don't change planes;
        // fall back to whatever is already in the URL, then a safe default.
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
        url.searchParams.set('alt', 0); // GeoFS snaps to ground if below terrain height

        status.textContent = `Spawning at ${icao} ${gate.name}…`;
        window.location.href = url.toString();
    }

    function init() {
        buildUI();
        loadGates();
    }

    // GeoFS takes a moment to finish booting; give the page a beat before
    // we touch the DOM / read geofs.aircraft.instance.
    if (document.readyState === 'complete') {
        setTimeout(init, 1500);
    } else {
        window.addEventListener('load', () => setTimeout(init, 1500));
    }
})();
