#!/usr/bin/env python3
"""Package the extension for store submission.

Both the Chrome Web Store and Firefox Add-ons take a plain ZIP of the unpacked
extension with manifest.json at its root. A .crx is only for self-hosted
distribution and neither store accepts one, so ZIP is all this produces.

The file list is derived from the manifest plus the <script>/<link> tags of any
HTML the manifest points at. Nothing is hard-coded, so adding a file to the
extension automatically includes it in the package -- which is what the old
pack_*.bat scripts got wrong: they still listed popup.js and button_popup.*
long after those were deleted, and omitted content.js entirely.

Usage:
    python3 scripts/package.py --check                 # validate only
    python3 scripts/package.py --out dist              # build both ZIPs
"""

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Skip absolute URLs, protocol-relative URLs, data URIs and bare fragments.
REMOTE = re.compile(r'^(?:[a-z][a-z0-9+.-]*:|//|#)', re.I)
ASSET_TAG = re.compile(
    r"""<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']""", re.I)

# Fixed timestamp so repeated builds of the same commit are byte-identical.
ZIP_DATE = (2000, 1, 1, 0, 0, 0)


def html_assets(rel_path):
    """Local files referenced by <script src> / <link href> in an HTML file."""
    out = []
    for url in ASSET_TAG.findall((ROOT / rel_path).read_text(encoding="utf-8")):
        url = url.strip()
        if REMOTE.match(url):
            continue
        out.append(url.split("?")[0].split("#")[0])
    return out


def collect(manifest_name):
    """Every file the extension needs, resolved from the manifest outward."""
    manifest = json.loads((ROOT / manifest_name).read_text(encoding="utf-8"))
    files, html = set(), []

    def add(path, is_html=False):
        if not path or REMOTE.match(path):
            return
        files.add(path)
        if is_html:
            html.append(path)

    for icon in (manifest.get("icons") or {}).values():
        add(icon)

    action = manifest.get("action") or manifest.get("browser_action") or {}
    for icon in (action.get("default_icon") or {}).values():
        add(icon)
    add(action.get("default_popup"), is_html=True)

    add(manifest.get("options_page"), is_html=True)
    add(((manifest.get("options_ui") or {}).get("page")), is_html=True)

    background = manifest.get("background") or {}
    add(background.get("service_worker"))
    for script in background.get("scripts") or []:
        add(script)
    add(background.get("page"), is_html=True)

    for entry in manifest.get("content_scripts") or []:
        for path in (entry.get("js") or []) + (entry.get("css") or []):
            add(path)

    for entry in manifest.get("web_accessible_resources") or []:
        if isinstance(entry, str):
            add(entry)
        else:
            for path in entry.get("resources") or []:
                if "*" not in path:
                    add(path)

    # Follow HTML files to the scripts and stylesheets they load. Loop until
    # stable so an HTML page pulling in another page is still covered.
    seen = set()
    while html:
        page = html.pop()
        if page in seen:
            continue
        seen.add(page)
        for asset in html_assets(page):
            add(asset, is_html=asset.lower().endswith(".html"))

    return manifest, files


def validate():
    """Check both manifests parse, agree on version, and reference real files."""
    problems, version = [], None
    for name in ("manifest.json", "manifest_firefox.json"):
        if not (ROOT / name).exists():
            problems.append(f"{name}: missing")
            continue
        try:
            manifest, files = collect(name)
        except json.JSONDecodeError as exc:
            problems.append(f"{name}: invalid JSON - {exc}")
            continue

        this_version = manifest.get("version")
        if not re.fullmatch(r"\d+(\.\d+){0,3}", str(this_version or "")):
            problems.append(f"{name}: version {this_version!r} is not 1-4 dot-separated integers")
        if version is None:
            version = this_version
        elif this_version != version:
            problems.append(f"{name}: version {this_version} != manifest.json version {version}")

        for path in sorted(files):
            if not (ROOT / path).exists():
                problems.append(f"{name}: references missing file {path}")
        print(f"  {name}: version {this_version}, {len(files)} files")

    return version, problems


def build(manifest_name, out_path):
    """Write a store-ready ZIP. The manifest is always stored as manifest.json."""
    _, files = collect(manifest_name)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for arcname, source in sorted(
            [("manifest.json", manifest_name)] + [(f, f) for f in files]
        ):
            info = zipfile.ZipInfo(arcname, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, (ROOT / source).read_bytes())
    return out_path, len(files) + 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without building")
    parser.add_argument("--out", default="dist", help="output directory (default: dist)")
    args = parser.parse_args()

    print("Validating:")
    version, problems = validate()
    if problems:
        print("\nFAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"  OK - version {version}")

    if args.check:
        return 0

    print("\nBuilding:")
    out_dir = ROOT / args.out
    for target, manifest_name in (("chrome", "manifest.json"),
                                  ("firefox", "manifest_firefox.json")):
        path, count = build(manifest_name, out_dir / f"lookupchatgpt-{target}-{version}.zip")
        print(f"  {path.relative_to(ROOT)}  ({count} files, {path.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
