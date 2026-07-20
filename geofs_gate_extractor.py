#!/usr/bin/env python3
"""
GeoFS Gate Extractor
=====================
Parses X-Plane apt.dat file(s) and extracts gate / parking positions
(row code 1300) into a JSON structure the GeoFS Gate Spawner userscript
can use.

Where to get apt.dat files:
    https://gateway.x-plane.com/
    -> search your airport (e.g. EGLL)
    -> download the "Recommended" scenery pack (a zip)
    -> unzip it, find the file called "apt.dat" inside
    -> that's your --input file

You can also point --input at a full "default.apt.dat" (the master file
X-Plane ships with, which contains every airport in the world) and just
pull out the ICAO codes you want with --icao.

Usage:
    python geofs_gate_extractor.py --input EGLL/apt.dat --icao EGLL --out gates.json
    python geofs_gate_extractor.py --input default.apt.dat --icao EGLL,KJFK,LFPG --out gates.json --gates-only

Row 1300 format (apt.dat spec):
    1300 <lat> <lon> <heading> <type> <airline_codes> <name...>
    type is one of: gate | hangar | tie-down
"""
import argparse
import json
from pathlib import Path

ROW_CODE_PARKING = "1300"
ROW_CODE_RAMP_METADATA = "1301"
ROW_CODE_AIRPORT_HEADER = {"1", "16", "17"}  # land airport, seaplane base, heliport


def parse_apt_dat(path, wanted_icaos=None):
    """
    Parses apt.dat text and returns {icao: [ {name, lat, lon, heading, type,
    airplane_types, width_code, operation_type}, ... ]}.

    Row 1300 gives position + coarse airplane category (heavy/jets/turboprops/
    props/helos/all). It is very often immediately followed by an optional
    row 1301 giving the precise ICAO width code (A-F) and operation type
    (none/general_aviation/airline/cargo/military) for that same stand —
    this function attaches 1301 data to the most recently seen 1300 gate.
    """
    wanted = {x.upper() for x in wanted_icaos} if wanted_icaos else None
    result = {}
    current_icao = None
    last_gate = None  # reference to the most recently appended gate dict

    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            code = parts[0]

            if code in ROW_CODE_AIRPORT_HEADER:
                # 1 <elevation> <deprecated> <deprecated> <icao> <name...>
                if len(parts) >= 5:
                    current_icao = parts[4].upper()
                last_gate = None
                continue

            if code == ROW_CODE_PARKING:
                last_gate = None
                if current_icao is None:
                    continue
                if wanted and current_icao not in wanted:
                    continue
                if len(parts) < 5:
                    continue

                try:
                    lat = float(parts[1])
                    lon = float(parts[2])
                    heading = float(parts[3])
                except ValueError:
                    continue

                ptype = parts[4]
                airplane_types_raw = parts[5] if len(parts) > 5 else "all"
                name = " ".join(parts[6:]) if len(parts) > 6 else ""

                gate = {
                    "name": name.strip() or f"{ptype}-{len(result.get(current_icao, [])) + 1}",
                    "lat": round(lat, 7),
                    "lon": round(lon, 7),
                    "heading": round(heading % 360, 2),
                    "type": ptype,
                    "airplane_types": [t for t in airplane_types_raw.split("|") if t],
                    "width_code": None,       # filled in by a following 1301 row, if present
                    "operation_type": None,   # filled in by a following 1301 row, if present
                }
                result.setdefault(current_icao, []).append(gate)
                last_gate = gate
                continue

            if code == ROW_CODE_RAMP_METADATA:
                if last_gate is not None and len(parts) >= 3:
                    last_gate["width_code"] = parts[1].upper()
                    last_gate["operation_type"] = parts[2].lower()
                # 1301 does not reset last_gate — some files have no 1301
                # at all, which is fine, width_code/operation_type just stay None
                continue

    return result


def main():
    ap = argparse.ArgumentParser(description="Extract GeoFS gate positions from an X-Plane apt.dat file")
    ap.add_argument("--input", required=True, help="Path to an apt.dat file")
    ap.add_argument("--icao", required=True, help="Comma-separated ICAO codes to extract, e.g. EGLL,KJFK,LFPG")
    ap.add_argument("--out", default="gates.json", help="Output JSON path (default: gates.json)")
    ap.add_argument("--gates-only", action="store_true", help="Drop hangar/tie-down spots, keep only type=gate")
    ap.add_argument("--merge", action="store_true", help="Merge into an existing --out file instead of overwriting it")
    args = ap.parse_args()

    icaos = [x.strip() for x in args.icao.split(",") if x.strip()]
    data = parse_apt_dat(args.input, icaos)

    if args.gates_only:
        for icao in list(data.keys()):
            data[icao] = [g for g in data[icao] if g["type"] == "gate"]

    out_path = Path(args.out)
    if args.merge and out_path.exists():
        existing = json.loads(out_path.read_text())
        existing.update(data)
        data = existing

    for icao in icaos:
        count = len(data.get(icao, []))
        print(f"{icao}: {count} parking position(s) found")
        if count == 0:
            print(f"  -> not found in this file. Check the ICAO code exists in this apt.dat, "
                  f"or that you downloaded the right airport's scenery pack.")

    out_path.write_text(json.dumps(data, indent=2))
    print(f"\nSaved {sum(len(v) for v in data.values())} total gates across {len(data)} airport(s) to {out_path}")


if __name__ == "__main__":
    main()
