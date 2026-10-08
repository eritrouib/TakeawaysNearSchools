#!/usr/bin/env python3
"""
Download the Food Standards Agency's open food hygiene data for every local
authority in England and keep only takeaways ("Takeaway/sandwich shop",
BusinessTypeID 7844) that have a location.

Run from the repository folder (Python 3.8+, no extra packages):

    python scripts/build_takeaways.py             # all authorities in England (~10-20 minutes)
    python scripts/build_takeaways.py --only 521  # one authority by FSA code (521 = Kingston upon Thames)

Writes:
    data/takeaways/index.json     authorities with counts and file names
    data/takeaways/<code>.json    takeaways for each authority

Runs weekly on GitHub (.github/workflows/update.yml).
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

AUTHORITIES_URL = os.environ.get("FSA_AUTHORITIES_URL", "https://api1-ratings.food.gov.uk/authorities/xml")
TAKEAWAY_TYPE_ID = "7844"
NOT_ENGLAND = {"Wales", "Scotland", "Northern Ireland"}
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "takeaways"
UA = "TakeawaysNearSchools (github.com/eritrouib/TakeawaysNearSchools)"


def fetch(url, retries=3, timeout=120):
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            if attempt == retries:
                raise
            time.sleep(3 * (attempt + 1))


def local(tag):
    return tag.rsplit("}", 1)[-1]


def text(el, name):
    for child in el:
        if local(child.tag) == name:
            return (child.text or "").strip()
    return ""


def parse_authorities(xml_bytes):
    root = ET.fromstring(xml_bytes)
    out = []
    for el in root:
        if local(el.tag) != "WebLocalAuthorityAPI":
            continue
        a = {k: text(el, k) for k in ("LocalAuthorityId", "LocalAuthorityIdCode", "Name", "FriendlyName", "FileName", "RegionName")}
        if not a["FileName"] or not a["LocalAuthorityIdCode"]:
            continue  # summary rows (All, England, ...) have no file
        out.append(a)
    return out


def parse_takeaways(xml_bytes):
    """Takeaways with a location from one FHRS open data file."""
    root = ET.fromstring(xml_bytes)
    rows, extract = [], ""
    for el in root.iter():
        name = local(el.tag)
        if name == "ExtractDate" and not extract:
            extract = (el.text or "").strip()
        if name != "EstablishmentDetail" or text(el, "BusinessTypeID") != TAKEAWAY_TYPE_ID:
            continue
        lat = lon = None
        for child in el:
            if local(child.tag) == "Geocode":
                lat, lon = text(child, "Latitude"), text(child, "Longitude")
        try:
            lat, lon = round(float(lat), 6), round(float(lon), 6)
        except (TypeError, ValueError):
            continue
        address = ", ".join(x for x in (text(el, f"AddressLine{i}") for i in range(1, 5)) if x)
        rows.append([
            int(text(el, "FHRSID") or 0), text(el, "BusinessName"), address, text(el, "PostCode"),
            lat, lon, text(el, "RatingValue"), text(el, "RatingDate")[:10],
        ])
    rows.sort(key=lambda r: r[1].lower())
    return rows, extract


def build(authority):
    rows, extract = parse_takeaways(fetch(authority["FileName"]))
    code = authority["LocalAuthorityIdCode"]
    payload = {"code": code, "name": authority["Name"], "extract": extract,
               "fields": ["fhrsid", "name", "address", "postcode", "lat", "lon", "rating", "rating_date"], "rows": rows}
    (OUT / f"{code}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"code": code, "name": authority["Name"], "slug": authority["FriendlyName"], "region": authority["RegionName"],
            "count": len(rows), "extract": extract}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="FSA authority code(s), comma separated")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    print("Fetching the list of authorities ...")
    auths = [a for a in parse_authorities(fetch(AUTHORITIES_URL)) if a["RegionName"] not in NOT_ENGLAND]
    if args.only:
        keep = {c.strip() for c in args.only.split(",")}
        auths = [a for a in auths if a["LocalAuthorityIdCode"] in keep]
    print(f"{len(auths)} authorities in England")

    index_path = OUT / "index.json"
    previous = {}
    if index_path.exists() and args.only:
        previous = {a["code"]: a for a in json.loads(index_path.read_text(encoding="utf-8"))["authorities"]}

    results, failed = [], []

    def run(a):
        try:
            return build(a)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {a['Name']}: {e}", file=sys.stderr)
            failed.append(a["Name"])
            return None

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, r in enumerate(pool.map(run, auths), 1):
            if r:
                results.append(r)
            if i % 25 == 0 or i == len(auths):
                print(f"  {i}/{len(auths)}")

    merged = {**previous, **{r["code"]: r for r in results}}
    index = {"generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
             "business_type": "Takeaway/sandwich shop (FSA BusinessTypeID 7844)",
             "authorities": sorted(merged.values(), key=lambda a: a["name"])}
    index_path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total = sum(a["count"] for a in index["authorities"])
    print(f"Saved {len(results)} authorities, {total:,} takeaways." + (f" Failed: {', '.join(failed)}" if failed else ""))
    if not results:
        sys.exit("Nothing was downloaded.")


if __name__ == "__main__":
    main()
