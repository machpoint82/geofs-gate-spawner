<p align="center">
  <img src="icon.png" width="150" alt="GeoFS Gate Spawner icon" />
</p>

<h1 align="center">GeoFS Gate Spawner</h1>

<p align="center">Spawn parked at a real gate or stand at supported airports — no more taxiing 20 minutes from a random runway threshold.</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tampermonkey-Userscript-00485B?logo=tampermonkey&logoColor=white" alt="Tampermonkey userscript" />
  <img src="https://img.shields.io/badge/GeoFS-v3.9%20%7C%20v4.0-1d4ed8" alt="GeoFS v3.9 and v4.0" />
  <img src="https://img.shields.io/badge/version-2.4.0-06b6d4" alt="Version 2.4.0" />
  <img src="https://img.shields.io/badge/license-Free%20to%20use%20%2F%20non--commercial-lightgrey" alt="License" />
</p>

---

## What it does

Adds a small in-game panel to GeoFS where you can pick an airport and gate/stand, optionally filter by aircraft category (A380/747-capable, cargo, GA, etc.), and spawn parked at the exact real-world coordinates and heading — pulled straight from official airport data, not guessed.

## Features

- Real gate/stand coordinates and headings sourced from X-Plane's open airport database
- Search box — type a gate number and hit **Enter** to jump straight there
- Filters for Code F (A380/747), Code E (777/787), heavy-capable, cargo, and general aviation stands
- The panel lives as a small always-visible header bar in the corner — click it to expand/collapse. No setup required.
- Optional keyboard shortcut — click the ⚙ if you'd like to assign your own key combo to toggle the panel instead of clicking it. Nothing is set by default, so pick a combo your browser/extensions aren't already using.
- Auto-updates through Tampermonkey once installed
- Best-effort anti-creep fix: automatically holds the parking brake for a few seconds after spawning, since some gates can have the aircraft roll forward slightly before physics settles

## Current airport coverage

**Right now this only covers [18 airports](airports.txt)** More airports will be added over time — check back on this repo for updates, and the script will auto-update itself once new airports are added to [`gates.json`](gates.json).

A couple of honesty notes while we're at it:
- Gate coordinates come from open, community-maintained airport data, not an official survey — the vast majority line up correctly, but a small number of stands may be positioned slightly off, or the aircraft may creep forward a little after spawning before settling. If you spot one that's clearly wrong, please open an issue with the gate name so it can be fixed.
- Some parking spots in the source data don't include aircraft-category info, so they won't show up under any filter chip — that doesn't mean they're unusable, just unclassified.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Click on `geofs-gate-spawner.user.js` in this repo, then click **Raw** — Tampermonkey will prompt you to install it.
3. Open GeoFS. A small "Gate Spawner" bar appears in the top-right corner — click it to expand the panel.

## How to use it

1. Click the "Gate Spawner" header bar to expand the panel.
2. Pick an airport.
3. (Optional) Click a filter chip, e.g. **A380 / 747 (Code F)**, to only show stands that size aircraft can use.
4. Type part of a gate number in the search box, or scroll the list.
5. Click **Spawn at gate** (or press **Enter** in the search box to jump straight to the top match).
6. (Optional) Click the ⚙ if you'd like to set your own keyboard shortcut to toggle the panel instead of clicking it.

## Contributing / reporting a bad gate

If you find a gate that spawns you in the wrong spot, open an issue on this repo with the airport ICAO and gate name — it helps keep the data accurate for everyone using it at events.

## License

See [LICENSE.md](LICENSE.md) — free to use and share, non-commercial, and not to be modified/redistributed as a modified version.
