# get-task-delete-server

Schedules deletion of a YottaSrc server with a cancel window. When a deletion is scheduled, a Telegram
message with a **🛑 Cancel deletion** button is sent. If nobody presses it before the grace period ends,
a real Chrome browser logs in to `console.yottasrc.com` and deletes the server.

## Deploy on a server (systemd, Debian/Ubuntu)

Every week at `WEEKLY_DAY WEEKLY_TIME` (in `TZ`) the bot sends a Cancel message for each server in
`WEEKLY_SERVERS`; each one is deleted `GRACE_MINUTES` later unless you press Cancel.

```bash
# on the server
sudo git clone <this-repo> /opt/get-task-delete-server   # or copy the folder there (without node_modules/ and data/)
cd /opt/get-task-delete-server
sudo ./deploy/install.sh        # apt packages, Bun, Google Chrome, user `deleteguard`, systemd unit `delete-guard`

sudo cp .env.example .env && sudo nano .env               # credentials, WEEKLY_*, TZ, VNC_PASSWORD
sudo chown root:deleteguard .env && sudo chmod 640 .env

# one-time login over VNC (bound to the server's localhost only)
sudo -u deleteguard ./deploy/login.sh
#   on your computer: ssh -L 5900:127.0.0.1:5900 user@server, then a VNC viewer at localhost:5900
#   solve the captcha / email code in the browser; the script exits when you're logged in

sudo -u deleteguard xvfb-run -a bun src/cli.ts dry-run <server>   # stops before the final confirm
sudo systemctl start delete-guard
journalctl -u delete-guard -f
```

Telegram `/next` shows the schedule and the next run. Set `DRY_RUN=false` in `.env` and
`sudo systemctl restart delete-guard` only after a dry run looks right.

Run every CLI command as `deleteguard` from the app folder, so it uses the same `data/` (DB + browser session).
If the saved session expires, the bot logs in again with your credentials and asks for any email code in Telegram;
if that fails it reports the error and you repeat `deploy/login.sh`.

## Local setup

```bash
bun install
cp .env.example .env      # fill in YottaSrc + Telegram values
bun run login             # one-time: headed Chrome, solve the captcha/email code, session is saved
bun run dry-run <server>  # walks the delete flow, stops before the final confirm, screenshots in data/debug/
```

`<server>` is the server's console URL (most reliable) or its exact name/hostname as shown in the server list.
If the dry run can't find the buttons, set `YOTTA_DELETE_SELECTOR` / `YOTTA_CONFIRM_SELECTOR` in `.env`.

Only after the dry run looks right, set `DRY_RUN=false`.

## Run

```bash
bun run start             # Telegram bot + scheduler (on a box without a display: xvfb-run bun run start)
```

From Telegram: `/delete <server> [minutes]`, `/jobs`, `/cancel <id>`.
From the shell (picked up by the running service): `bun run schedule <server> [minutes]`, `bun run jobs`.

## Safety behaviour

- Cancel and the scheduler both use atomic `pending → cancelled/running` updates, so a cancel can't race a deletion.
- A job never runs before its Cancel button has been sent; late or post-restart jobs get `RESTART_GRACE_MINUTES` extra.
- Jobs interrupted mid-run by a crash are marked failed and never retried automatically.
- Ambiguous matches (zero or several servers / delete buttons) abort instead of guessing.
- If YottaSrc asks for an email verification code, the bot asks you for it in Telegram.

## Notes

- Cloudflare Turnstile protects the login page and rejects headless Chrome, so `HEADLESS=false` is the default.
- `data/` holds the SQLite DB, the Chrome profile (logged-in session) and screenshots. It is gitignored. Keep it private.
