#!/bin/sh
set -e

# Chrome needs an X display even when nobody looks at it.
Xvfb "$DISPLAY" -screen 0 1366x900x24 -nolisten tcp >/dev/null 2>&1 &
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break
  sleep 0.5
done

command="${1:-start}"
[ $# -gt 0 ] && shift

case "$command" in
  start)
    exec bun src/main.ts
    ;;
  login)
    if [ -z "$VNC_PASSWORD" ]; then
      echo "Set VNC_PASSWORD in .env to use the login command." >&2
      exit 1
    fi
    x11vnc -display "$DISPLAY" -rfbport 5900 -passwd "$VNC_PASSWORD" -forever -shared -bg -quiet -o /tmp/x11vnc.log
    echo "VNC is up on port 5900. From your machine: ssh -L 5900:127.0.0.1:5900 <server>, then open a VNC viewer on localhost:5900."
    exec bun src/cli.ts login
    ;;
  dry-run | schedule | jobs)
    exec bun src/cli.ts "$command" "$@"
    ;;
  *)
    exec "$command" "$@"
    ;;
esac
