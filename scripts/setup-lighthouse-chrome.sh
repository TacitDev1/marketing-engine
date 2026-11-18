#!/bin/bash
# Sets up the self-contained headless Chrome that server/tools/lighthouse.js
# uses for local site audits. No sudo, no system Chrome install:
#   1. Downloads chrome-headless-shell (stable) from Chrome for Testing.
#   2. Extracts with python3 (no `unzip` on this box).
#   3. Fetches the 4 shared libs it needs (libnspr4/libnss3/libasound2) via
#      `apt-get download` + `dpkg -x` — both work WITHOUT root.
# lighthouse.js injects the libs via LD_LIBRARY_PATH when launching Chrome.
# Re-run any time to update Chrome to the current stable.
set -e

CACHE="$HOME/.cache/mkt-chrome"
mkdir -p "$CACHE"

echo "== 1/2 chrome-headless-shell (stable) =="
python3 - "$CACHE" <<'PYEOF'
import json, os, stat, sys, urllib.request, zipfile
cache = sys.argv[1]
manifest = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"
with urllib.request.urlopen(manifest, timeout=30) as r:
    d = json.load(r)
ch = d["channels"]["Stable"]
url = [x["url"] for x in ch["downloads"]["chrome-headless-shell"] if x["platform"] == "linux64"][0]
print("version:", ch["version"])
zpath = os.path.join(cache, "chs.zip")
urllib.request.urlretrieve(url, zpath)
with zipfile.ZipFile(zpath) as z:
    z.extractall(cache)  # python zipfile drops the exec bit; restored below
os.remove(zpath)
bindir = os.path.join(cache, "chrome-headless-shell-linux64")
for f in os.listdir(bindir):
    p = os.path.join(bindir, f)
    os.chmod(p, os.stat(p).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
print("bin:", os.path.join(bindir, "chrome-headless-shell"))
PYEOF

echo "== 2/2 shared libs (no sudo) =="
LIBDIR="$CACHE/libs"
mkdir -p "$LIBDIR"
cd "$LIBDIR"
rm -f ./*.deb
apt-get download libnspr4 libnss3 libasound2t64 >/dev/null
for deb in ./*.deb; do dpkg -x "$deb" .; done
rm -f ./*.deb

echo "== smoke test =="
export LD_LIBRARY_PATH="$LIBDIR/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
BIN="$CACHE/chrome-headless-shell-linux64/chrome-headless-shell"
"$BIN" --version
"$BIN" --headless --no-sandbox --disable-gpu --dump-dom "data:text/html,<h1>ok</h1>" >/dev/null && echo "renders: OK"
