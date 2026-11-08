#!/bin/sh
# Serve the UML Class Modeler on http://localhost:8123.
# ES modules need http://, not file://. Every response carries
# Cache-Control: no-store, so an edited stylesheet or module shows on the
# next reload instead of the browser's heuristically cached copy.
#
#   ./serve.sh [port]          serve the app
#   ./serve.sh --screenshot F  serve, take a headless screenshot into F, exit
#
# Everything is local: fonts, styles, modules and the stereotype profile are
# files next to this script, so the app works with the network unplugged.
#
# The screenshot path lives in Build/uml-modeler: one implementation that
# tries every headless browser on the machine and checks the PNG really
# landed. This script only forwards, so the two entry points cannot drift.
set -u
cd "$(dirname "$0")" || exit 1

if [ "${1:-}" = "--screenshot" ]; then
  exec python3 ./Build/uml-modeler --screenshot "${2:-shot.png}"
fi

PORT="${1:-8123}"
exec python3 - "$PORT" <<'PY'
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoStore(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

# The asked-for port first, then the next free ones: a leftover server on 8123
# is not a reason to fail, and the line printed below says where to look.
start = int(sys.argv[1])
for port in range(start, start + 20):
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), NoStore)
    except OSError:
        continue
    print(f"UML Class Modeler → http://localhost:{port}", flush=True)
    srv.serve_forever()
print(f"no free port in {start}..{start + 19}", file=sys.stderr)
raise SystemExit(1)
PY
