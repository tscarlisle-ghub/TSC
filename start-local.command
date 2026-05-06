#!/usr/bin/env bash
# ============================================================
# CMA Folder Reorganizer — local launcher
# Double-click this file in Finder. A Terminal window will open,
# a tiny local web server will start, and your browser will open
# the app at http://localhost:8765/.
# Press Ctrl-C in this Terminal window to stop the server.
# ============================================================

cd "$(dirname "$0")"

PORT=8765
URL="http://localhost:$PORT/"

echo "──────────────────────────────────────────────────────────"
echo "  CMA Folder Reorganizer  ·  local server"
echo "──────────────────────────────────────────────────────────"
echo "  Serving:  $(pwd)"
echo "  URL:      $URL"
echo
echo "  Leave this window open while using the tool."
echo "  Close it (or press Ctrl-C) to stop the server."
echo "──────────────────────────────────────────────────────────"
echo

# Open Chrome at the local URL after a brief delay so the
# server has time to start. Fall back to the default browser
# if Chrome is not installed.
(
  sleep 1
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" "$URL"
  elif [ -d "/Applications/Microsoft Edge.app" ]; then
    open -a "Microsoft Edge" "$URL"
  else
    open "$URL"
  fi
) &

# python3 ships with macOS's developer tools. If unavailable, fall back to python.
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python  -m SimpleHTTPServer "$PORT"
else
  echo "Error: neither python3 nor python is installed."
  echo "Install Xcode Command Line Tools with: xcode-select --install"
  echo
  read -p "Press Return to close…"
fi
