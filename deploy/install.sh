#!/usr/bin/env bash
# Installs the deletion guard as a systemd service on Debian/Ubuntu.
# Run as root from the cloned repo (e.g. /opt/get-task-delete-server): sudo ./deploy/install.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_USER="${SERVICE_USER:-deleteguard}"
SERVICE_NAME="delete-guard"
BUN_VERSION="1.2.18"

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo $0" >&2; exit 1; }
command -v apt-get >/dev/null || { echo "This script supports Debian/Ubuntu (apt) only." >&2; exit 1; }

echo "==> System packages (Xvfb virtual display, x11vnc for the one-time login)"
apt-get update
apt-get install -y --no-install-recommends xvfb xauth x11vnc tzdata ca-certificates curl unzip fonts-liberation

if ! command -v bun >/dev/null; then
  echo "==> Installing Bun $BUN_VERSION to /usr/local/bin"
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v$BUN_VERSION"
fi
BUN="$(command -v bun)"

if ! id "$SERVICE_USER" &>/dev/null; then
  echo "==> Creating system user $SERVICE_USER"
  # Chrome needs a writable home directory.
  useradd --system --create-home --home-dir "/var/lib/$SERVICE_USER" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> App dependencies and Google Chrome"
cd "$APP_DIR"
"$BUN" install --frozen-lockfile --production
"$BUN" x playwright install --with-deps chrome

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 700 "$APP_DIR/data"
if [ -f "$APP_DIR/.env" ]; then
  chown "root:$SERVICE_USER" "$APP_DIR/.env"
  chmod 640 "$APP_DIR/.env"
fi

if ! runuser -u "$SERVICE_USER" -- test -r "$APP_DIR/src/main.ts"; then
  echo "User $SERVICE_USER cannot read $APP_DIR. Move the repo somewhere like /opt and re-run." >&2
  exit 1
fi

echo "==> systemd unit /etc/systemd/system/$SERVICE_NAME.service"
cat >"/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=YottaSrc server deletion guard (Telegram cancel button + weekly schedule)
Wants=network-online.target
After=network-online.target

[Service]
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
# Headed Chrome on a virtual display: Cloudflare Turnstile rejects headless Chrome.
ExecStart=/usr/bin/xvfb-run --auto-servernum --server-args="-screen 0 1366x900x24" $BUN src/main.ts
Restart=always
RestartSec=10
TimeoutStopSec=60
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

cat <<EOF

Installed. Next steps (see README):
  1. Fill in $APP_DIR/.env, then: sudo chown root:$SERVICE_USER $APP_DIR/.env && sudo chmod 640 $APP_DIR/.env
  2. One-time login:  cd $APP_DIR && sudo -u $SERVICE_USER ./deploy/login.sh
  3. Dry run:         cd $APP_DIR && sudo -u $SERVICE_USER xvfb-run -a bun src/cli.ts dry-run <server>
  4. Start:           sudo systemctl start $SERVICE_NAME && journalctl -u $SERVICE_NAME -f
EOF
