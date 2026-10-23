#!/usr/bin/env bash
# One-time manual YottaSrc login, shown over VNC (localhost only; reach it through an SSH tunnel).
# Run from the repo as the service user: sudo -u deleteguard ./deploy/login.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PASS="$(grep -E '^VNC_PASSWORD=' .env | head -1 | cut -d= -f2- | sed -e 's/[[:space:]]*#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//')"
[ -n "$PASS" ] || { echo "Set VNC_PASSWORD in .env first." >&2; exit 1; }

DISPLAY_NUM=":${LOGIN_DISPLAY:-98}"
WORK="$(mktemp -d)"
cleanup() {
  kill "${VNC_PID:-}" "${XVFB_PID:-}" 2>/dev/null || true
  rm -f "$WORK/passwd" && rmdir "$WORK"
}
trap cleanup EXIT

Xvfb "$DISPLAY_NUM" -screen 0 1366x900x24 -nolisten tcp >/dev/null 2>&1 &
XVFB_PID=$!
sleep 1

# Password goes through a file so it isn't visible in `ps` while the VNC server runs.
x11vnc -storepasswd "$PASS" "$WORK/passwd" >/dev/null 2>&1
x11vnc -display "$DISPLAY_NUM" -localhost -rfbport 5900 -rfbauth "$WORK/passwd" -forever -shared -quiet >/dev/null 2>&1 &
VNC_PID=$!

echo "VNC listening on 127.0.0.1:5900."
echo "On your computer: ssh -L 5900:127.0.0.1:5900 <user>@<server>, then open a VNC viewer at localhost:5900."
DISPLAY="$DISPLAY_NUM" bun src/cli.ts login
