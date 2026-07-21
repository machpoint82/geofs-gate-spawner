#!/usr/bin/env python3
"""
GeoFS Bulk Airport Fetcher
==========================
Downloads airports directly from the X-Plane Scenery Gateway by ICAO code
-- no browser, no manual zip downloads, no unzipping. Just give it a list
of ICAO codes and it fetches, extracts, and merges them straight into
gates.json.

Usage:
    python geofs_bulk_fetch.py --icao EGLL,KJFK,LFPG,EDDF --out gates.json --gates-only

    # or from a text file with one ICAO code per line:
    python geofs_bulk_fetch.py --file airports.txt --out gates.json --gates-only

Be considerate of the Gateway's servers -- this waits a second between
requests by default (see --delay).
"""
import argparse
import base64
import io
import json
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

import importlib.util

# Reuse the exact same, already-tested parser from geofs_gate_extractor.py,
# which must sit in the same folder as this script.
_extractor_path = Path(__file__).parent / "geofs_gate_extractor.py"
_spec = importlib.util.spec_from_file_location("geofs_gate_extractor", _extractor_path)
extractor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(extractor)

GATEWAY = "https://gateway.x-plane.com"


def fetch_json(url, retries=2):
    req = urllib.request.Request(url, headers={"User-Agent": "geofs-gate-spawner-bulk-fetch/1.0"})
    last_err = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))  # brief backoff before retrying
    raise last_err


def get_recommended_scenery_id(icao, debug=False):
    """GET /apiv1/airport/{icao} -> pick the recommended scenery pack id."""
    raw = fetch_json(f"{GATEWAY}/apiv1/airport/{icao}")
    data = raw.get("airport", raw) if isinstance(raw, dict) else raw  # tolerate either response shape
    rec_id = data.get("recommendedSceneryId")
    if rec_id:
        return rec_id, None
    # Fallback: no explicit recommendation, so take the first approved pack,
    # or an accepted one, or just the first pack listed as a last resort.
    packs = data.get("scenery", [])
    for p in packs:
        if p.get("dateApproved"):
            return p.get("sceneryId"), None
    for p in packs:
        if p.get("dateAccepted"):
            return p.get("sceneryId"), None
    if packs:
        return packs[0].get("sceneryId"), None
    # Truly nothing usable in the response -- surface why, instead of just
    # silently saying "not found".
    diagnostic = f"response keys: {list(data.keys())}" if isinstance(data, dict) else f"unexpected response: {data!r}"
    return None, diagnostic


def download_apt_dat_text(scenery_id):
    """GET /apiv1/scenery/{id} -> base64 zip -> raw apt.dat text."""
    data = fetch_json(f"{GATEWAY}/apiv1/scenery/{scenery_id}")
    pack = data.get("scenery", data)  # tolerate either response shape
    blob = base64.b64decode(pack["masterZipBlob"])
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        names = z.namelist()
        candidates = [n for n in names if n.lower().endswith("apt.dat")]
        if not candidates:
            # Widen the net: some packs name the file after the ICAO code
            # itself (e.g. "LEMD.dat") instead of the generic "apt.dat".
            candidates = [n for n in names if n.lower().endswith(".dat") and "nav data" in n.lower()]
        if not candidates:
            print(f"    (zip contents were: {names[:15]}{'...' if len(names) > 15 else ''})")
            return None
        return z.read(candidates[0]).decode("utf-8", errors="ignore")


def main():
    ap = argparse.ArgumentParser(description="Bulk-fetch airports from the X-Plane Scenery Gateway into gates.json")
    ap.add_argument("--icao", help="Comma-separated ICAO codes, e.g. EGLL,KJFK,LFPG")
    ap.add_argument("--file", help="Path to a text file with one ICAO code per line")
    ap.add_argument("--out", default="gates.json", help="Output JSON path (default: gates.json)")
    ap.add_argument("--gates-only", action="store_true", help="Drop hangar/tie-down spots, keep only type=gate")
    ap.add_argument("--delay", type=float, default=1.0, help="Seconds to wait between requests (default: 1.0)")
    args = ap.parse_args()

    icaos = []
    if args.icao:
        icaos += [x.strip().upper() for x in args.icao.split(",") if x.strip()]
    if args.file:
        icaos += [l.strip().upper() for l in Path(args.file).read_text().splitlines() if l.strip()]
    if not icaos:
        ap.error("provide --icao or --file")

    out_path = Path(args.out)
    data = json.loads(out_path.read_text()) if out_path.exists() else {}

    for icao in icaos:
        print(f"Fetching {icao}...")
        try:
            sid, diagnostic = get_recommended_scenery_id(icao)
            if not sid:
                print(f"  -> no usable scenery pack for {icao} ({diagnostic}) -- try again, or double check the ICAO code")
                continue

            text = download_apt_dat_text(sid)
            if not text:
                print(f"  -> apt.dat not found inside the scenery pack for {icao}, skipping")
                continue

            tmp = Path(f"_tmp_{icao}.dat")
            tmp.write_text(text, encoding="utf-8")
            parsed = extractor.parse_apt_dat(tmp, wanted_icaos=[icao])
            tmp.unlink(missing_ok=True)

            gates = parsed.get(icao, [])
            if args.gates_only:
                gates = [g for g in gates if g["type"] == "gate"]

            data[icao] = gates
            print(f"  -> {len(gates)} spot(s) found")

        except urllib.error.HTTPError as e:
            print(f"  -> HTTP error fetching {icao}: {e}")
        except Exception as e:
            print(f"  -> failed to process {icao}: {e}")

        time.sleep(args.delay)

    out_path.write_text(json.dumps(data, indent=2))
    print(f"\nSaved {sum(len(v) for v in data.values())} total gates across {len(data)} airport(s) to {out_path}")


if __name__ == "__main__":
    main()
