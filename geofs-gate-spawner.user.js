// ==UserScript==
// @name         GeoFS Gate Spawner
// @namespace    https://github.com/yourname/geofs-gate-spawner
// @version      1.0.0
// @description  Pick an airport and gate, spawn parked right there with GeoFS's own URL spawn params.
// @author       you
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
    // CONFIG — point this at wherever you host the gates.json produced
    // by geofs_gate_extractor.py (a GitHub raw link is the easiest way).
    // If you'd rather not host it anywhere yet, leave GATES_URL empty
    // and use the EMBEDDED_SAMPLE below to test the UI.
    // ------------------------------------------------------------------
    const GATES_URL = ''; // e.g. 'https://raw.githubusercontent.com/you/repo/main/gates.json'

    // Placeholder/demo data so the panel works out of the box.
    // Replace by running geofs_gate_extractor.py on real apt.dat files —
    // these coordinates are NOT verified real-world gate positions.
    const EMBEDDED_SAMPLE = {
        "TEST": [
            { "name": "A1 (demo)", "lat": 51.4706123, "lon": -0.4548210, "heading": 273, "type": "gate" },
            { "name": "A2 (demo)", "lat": 51.4701456, "lon": -0.4552310, "heading": 273, "type": "gate" }
        ]
    };

    let gatesDB = {};

    function loadGates() {
        if (!GATES_URL) {
            gatesDB = EMBEDDED_SAMPLE;
            populateAirportList();
            return;
        }
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
            width: 230px; box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        `;
        panel.innerHTML = `
            <div style="font-weight:bold; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                <span>✈ Gate Spawner</span>
                <span id="gs-collapse" style="cursor:pointer; opacity:0.7;">–</span>
            </div>
            <div id="gs-body">
                <select id="gs-airport" style="width:100%; margin-bottom:6px;"><option>Loading…</option></select>
                <select id="gs-gate" style="width:100%; margin-bottom:6px;"><option>--</option></select>
                <button id="gs-spawn" style="width:100%; padding:5px; cursor:pointer;">Spawn at gate</button>
                <div id="gs-status" style="margin-top:6px; opacity:0.7; font-size:11px;"></div>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('gs-airport').addEventListener('change', populateGateList);
        document.getElementById('gs-spawn').addEventListener('click', spawnAtSelectedGate);
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
        const gateSel = document.getElementById('gs-gate');
        gateSel.innerHTML = '';
        (gatesDB[icao] || []).forEach((gate, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${gate.name} (${gate.type})`;
            gateSel.appendChild(opt);
        });
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
