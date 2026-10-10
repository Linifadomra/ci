#!/usr/bin/env python3
import argparse
import json
import os
import plistlib
import shutil
import zipfile
from datetime import datetime, timezone

CHANNELS = {
    "dev": {"assets": "ci", "keep": 5},
    "public": {"assets": "releases", "keep": 0},
}


def plist_name(ipa):
    return next(
        n for n in ipa.namelist() if n.startswith("Payload/") and n.endswith(".app/Info.plist") and n.count("/") == 2
    )


def rewrite_version(src, dest, version):
    with zipfile.ZipFile(src) as zin:
        target = plist_name(zin)
        raw = zin.read(target)
        fmt = plistlib.FMT_BINARY if raw.startswith(b"bplist00") else plistlib.FMT_XML
        info = plistlib.loads(raw)
        info["CFBundleShortVersionString"] = version
        patched = plistlib.dumps(info, fmt=fmt)
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                zout.writestr(item, patched if item.filename == target else zin.read(item.filename))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--repo-dir", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--channel", default="dev", choices=CHANNELS)
    parser.add_argument("--version")
    parser.add_argument("ipa")
    parser.add_argument("scope")
    parser.add_argument("sha")
    args = parser.parse_args()

    channel = CHANNELS[args.channel]
    prefix = f"{args.base.rstrip('/')}/{channel['assets']}/"
    assets = os.path.join(args.repo_dir, channel["assets"])
    manifest = os.path.join(args.repo_dir, "apps.json")

    with zipfile.ZipFile(args.ipa) as ipa:
        info = plistlib.loads(ipa.read(plist_name(ipa)))
    built = info["CFBundleShortVersionString"]
    version = args.version or built

    os.makedirs(assets, exist_ok=True)
    filename = f"{args.name}-{version}-unsigned.ipa"
    dest = os.path.join(assets, filename)
    if version == built:
        shutil.copyfile(args.ipa, dest)
    else:
        rewrite_version(args.ipa, dest, version)

    if args.channel == "public":
        note = f"Release {version} (unsigned)."
    else:
        note = f"CI build of {args.scope} @ {args.sha[:9]} (unsigned)."
    entry = {
        "version": version,
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "localizedDescription": note,
        "downloadURL": prefix + filename,
        "size": os.path.getsize(dest),
        "minOSVersion": info.get("MinimumOSVersion", "15.0"),
    }

    with open(manifest) as f:
        source = json.load(f)
    app = source["apps"][0]
    versions = [entry] + [v for v in app["versions"] if v["version"] != version]
    if channel["keep"]:
        dropped = [v for v in versions if v["downloadURL"].startswith(prefix)][channel["keep"] :]
        versions = [v for v in versions if v not in dropped]
    app["versions"] = versions

    with open(manifest, "w") as f:
        json.dump(source, f, indent="\t", ensure_ascii=False)
        f.write("\n")
    print(f"altstore[{args.channel}]: published {version} ({entry['size']} bytes) -> {entry['downloadURL']}")


if __name__ == "__main__":
    main()
